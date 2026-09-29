import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { loadConfig, type Json } from 'testrail-ai';
import { buildServer, SERVER_INFO } from './server';
import { textOf } from './tool-text';

/**
 * A read-only smoke test against a real TestRail instance, driven through the
 * actual MCP protocol rather than by calling the handlers directly — an
 * in-memory transport pair, so what runs here is exactly what a client runs.
 *
 * READ ONLY BY CONSTRUCTION. It forces `TESTRAIL_ALLOW_WRITES=false` regardless
 * of the environment, so the client's write gate rejects every mutating
 * endpoint before a request is ever built. Pointing this at a production
 * instance cannot change anything in it.
 *
 *   pnpm smoke              # against the project in TESTRAIL_SMOKE_PROJECT, or the first one
 */

const config = { ...loadConfig(), allowWrites: false };

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

const server = buildServer(config);

await server.connect(serverTransport);

const client = new Client({ name: 'smoke', version: '1.0.0' });

await client.connect(clientTransport);

let failures = 0;

async function check(label: string, run: () => Promise<string>): Promise<void> {
  const started = Date.now();

  try {
    const summary = await run();
    console.log(`  ✓ ${label} — ${summary} (${Date.now() - started}ms)`);
  } catch (error) {
    failures++;
    console.log(`  ✗ ${label} — ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Tool results carry `isError` rather than throwing, so a passing call must assert on it. */
async function callTool(name: string, args: Record<string, Json>): Promise<string> {
  const result = await client.callTool({ name, arguments: args });

  const text = textOf(result);

  if (result.isError) throw new Error(`tool reported an error: ${text.slice(0, 300)}`);

  return text;
}

console.log(`\ntestrail-mcp smoke test → ${config.url}`);

console.log('writes forced OFF for this run\n');

console.log('protocol surface');

let toolNames: string[] = [];

await check('tools/list', async () => {
  const { tools } = await client.listTools();
  toolNames = tools.map((tool) => tool.name).toSorted();

  if (tools.length === 0) throw new Error('no tools registered');

  for (const tool of tools) {
    if (!tool.description) throw new Error(`${tool.name} has no description`);

    if (!tool.inputSchema) throw new Error(`${tool.name} has no input schema`);
  }

  return `${tools.length} tools: ${toolNames.join(', ')}`;
});

await check('resources/list', async () => {
  const { resources } = await client.listResources();

  return `${resources.length}: ${resources.map((resource) => resource.uri).join(', ')}`;
});

await check('prompts/list', async () => {
  const { prompts } = await client.listPrompts();

  if (prompts.length === 0) throw new Error('no prompts registered');

  return `${prompts.length}: ${prompts.map((prompt) => prompt.name).join(', ')}`;
});

console.log('\nresources (live reads)');

await check('testrail://meta', async () => {
  const result = await client.readResource({ uri: 'testrail://meta' });
  const text = textOf(result);

  if (!text.includes('Statuses')) throw new Error('no status table in the response');

  return `${text.length} chars`;
});

let projectId = Number(process.env.TESTRAIL_SMOKE_PROJECT ?? 0);

await check('testrail://projects', async () => {
  const result = await client.readResource({ uri: 'testrail://projects' });
  const text = textOf(result);
  const ids = [...text.matchAll(/^\| (\d+) \|/gm)].map((match) => Number(match[1]));

  if (ids.length === 0) throw new Error('no projects listed');

  if (!projectId) projectId = ids[0]!;

  return `${ids.length} projects, using project ${projectId}`;
});

await check(`testrail://project/${projectId}`, async () => {
  const result = await client.readResource({ uri: `testrail://project/${projectId}` });

  return `${textOf(result).length} chars`;
});

console.log('\ntools (live reads)');

await check('testrail_search projects', async () => {
  const text = await callTool('testrail_search', { entity: 'projects', limit: 10 });

  return firstLine(text);
});

let runId = 0;

await check('testrail_search runs', async () => {
  const text = await callTool('testrail_search', { entity: 'runs', project_id: projectId, limit: 5 });
  const ids = [...text.matchAll(/^\| (\d+) \|/gm)].map((match) => Number(match[1]));
  runId = ids[0] ?? 0;

  return `${firstLine(text)}, newest run ${runId || 'none'}`;
});

await check('testrail_search cases', async () => {
  const text = await callTool('testrail_search', { entity: 'cases', project_id: projectId, limit: 5 });

  return firstLine(text);
});

if (runId) {
  await check(`testrail_run_report run ${runId}`, async () => {
    const text = await callTool('testrail_run_report', { run_id: runId });

    if (!text.includes('% passing')) throw new Error('no pass rate in the report');

    return `${text.length} chars, ${text.split('\n').length} lines`;
  });

  await check(`testrail_failures run ${runId}`, async () => {
    const text = await callTool('testrail_failures', { run_id: runId, limit: 10 });

    return firstLine(text);
  });

  await check(`testrail_search tests in run ${runId}`, async () => {
    const text = await callTool('testrail_search', { entity: 'tests', run_id: runId, limit: 5 });

    return firstLine(text);
  });
} else {
  console.log('  – run-scoped checks skipped: the project has no runs');
}

await check('testrail_flaky', async () => {
  const text = await callTool('testrail_flaky', { project_id: projectId, runs: 5, min_flips: 2 });

  return firstLine(text);
});

await check('testrail_flaky rejects min_flips below 2', async () => {
  // One transition is a regression or a fix, never flakiness. The schema must
  // refuse it rather than quietly reporting every regression as flaky.
  try {
    await callTool('testrail_flaky', { project_id: projectId, runs: 5, min_flips: 1 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (!message.includes('min_flips')) {
      throw new Error(`rejected for the wrong reason: ${message}`, { cause: error });
    }

    return 'rejected by the input schema';
  }

  throw new Error('min_flips 1 was accepted — the floor is not being enforced');
});

await check('testrail_coverage', async () => {
  const text = await callTool('testrail_coverage', {
    project_id: projectId,
    limit: 100,
    recent_runs: 2,
  });

  if (!text.includes('Distribution')) throw new Error('no distribution section');

  return `${text.length} chars`;
});

await check('testrail_raw get_case_fields', async () => {
  const text = await callTool('testrail_raw', { endpoint: 'get_case_fields', max_chars: 2000 });

  return `${text.length} chars`;
});

console.log('\nwrite gate (must refuse — no request reaches TestRail)');

await check('testrail_report_result is refused', async () => {
  const result = await client.callTool({
    name: 'testrail_report_result',
    arguments: { run_id: runId || 1, results: [{ case_id: 1, status: 'passed' }] },
  });

  const text = textOf(result);

  if (!result.isError) throw new Error('WRITE WAS NOT BLOCKED — this is a bug');

  if (!text.includes('Writes are disabled')) throw new Error(`refused, but for the wrong reason: ${text}`);

  return 'refused at the client gate';
});

await check('testrail_case_write update is refused', async () => {
  const result = await client.callTool({
    name: 'testrail_case_write',
    arguments: { action: 'update', case_id: 1, title: 'smoke' },
  });

  const text = textOf(result);

  if (!result.isError) throw new Error('WRITE WAS NOT BLOCKED — this is a bug');

  if (!text.includes('Writes are disabled')) throw new Error(`refused, but for the wrong reason: ${text}`);

  return 'refused at the client gate';
});

await check('testrail_run close is refused', async () => {
  const result = await client.callTool({
    name: 'testrail_run',
    arguments: { action: 'close', run_id: runId || 1 },
  });

  if (!result.isError) throw new Error('WRITE WAS NOT BLOCKED — this is a bug');

  return 'refused at the client gate';
});

await check('testrail_raw cannot smuggle a write', async () => {
  const result = await client.callTool({
    name: 'testrail_raw',
    arguments: { endpoint: 'add_result_for_case/1/1', body: { status_id: 1 } },
  });

  if (!result.isError) throw new Error('WRITE WAS NOT BLOCKED — this is a bug');

  return 'refused at the client gate';
});

console.log(
  failures === 0
    ? `\nAll checks passed against ${SERVER_INFO.name} ${SERVER_INFO.version}.\n`
    : `\n${failures} of the checks failed.\n`,
);

await client.close();

await server.close();

process.exit(failures === 0 ? 0 : 1);

function firstLine(text: string): string {
  return text.split('\n')[0]?.replace(/^#+\s*/, '') ?? '';
}
