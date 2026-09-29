import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { loadConfig, sharedClient, type Json } from 'testrail-ai';
import { z } from 'zod';
import { buildServer } from './server';
import { textOf } from './tool-text';

/**
 * The write tools, run for real against one project set aside for it.
 *
 * Opt-in and guarded twice: it needs both TESTRAIL_SMOKE_WRITE_PROJECT (an id)
 * and TESTRAIL_SMOKE_WRITE_PROJECT_NAME, and it reads the project and refuses
 * unless the name matches before it writes anything. A shared TestRail account
 * holds other people's records; a typo in the id must not reach them.
 *
 * It creates a section, a case, a run and a result, closes the run, and deletes
 * the section (which deletes the case). The closed run stays, as TestRail keeps
 * closed runs.
 *
 *   TESTRAIL_SMOKE_WRITE_PROJECT=11 TESTRAIL_SMOKE_WRITE_PROJECT_NAME=Jag pnpm test:smoke:write
 */

const projectId = z.coerce.number().int().positive().parse(process.env.TESTRAIL_SMOKE_WRITE_PROJECT);

const projectName = z.string().min(1).parse(process.env.TESTRAIL_SMOKE_WRITE_PROJECT_NAME);

const config = { ...loadConfig(), allowWrites: true };

const testrail = sharedClient(config);

const project = await testrail.request<{ name: string }>(`get_project/${projectId}`);

if (project.name !== projectName) {
  console.error(
    `Refusing: project ${projectId} is '${project.name}', not '${projectName}'. Nothing was written.`,
  );
  process.exit(1);
}

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

const server = buildServer(config);

await server.connect(serverTransport);

const client = new Client({ name: 'smoke-write', version: '1.0.0' });

await client.connect(clientTransport);

const Id = z.object({ id: z.number() });

const stamp = new Date().toISOString();

let failures = 0;

async function call(name: string, args: Record<string, Json>): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  const text = textOf(result);

  if (result.isError) throw new Error(text.slice(0, 300));

  return text;
}

async function step(label: string, run: () => Promise<string>): Promise<void> {
  try {
    console.log(`  ✓ ${label} — ${await run()}`);
  } catch (error) {
    failures++;
    console.log(`  ✗ ${label} — ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`\nwrite smoke → project ${projectId} (${project.name}) on ${config.url}\n`);

// The section is scaffolding, not what is under test, so it goes straight through the client.
const section = Id.parse(
  await testrail.request<Json>(`add_section/${projectId}`, { name: `smoke ${stamp}` }),
);

let caseId = 0;

let runId = 0;

await step('testrail_case_write create', async () => {
  const text = await call('testrail_case_write', {
    action: 'create',
    section_id: section.id,
    title: `Smoke ${stamp}`,
    refs: 'SMOKE-1',
  });

  caseId = Number(/Created case C(\d+)/.exec(text)?.[1]);

  return `C${caseId}`;
});

await step(
  'testrail_case_write update',
  async () =>
    (
      await call('testrail_case_write', {
        action: 'update',
        case_id: caseId,
        title: `Smoke ${stamp} (updated)`,
      })
    ).split('\n')[1] ?? '',
);

await step('testrail_case reads it back', async () => {
  const text = await call('testrail_case', { case_id: caseId, include_history: false });

  if (!text.includes('(updated)')) throw new Error('the update is not visible');

  return 'title updated';
});

await step('testrail_run create', async () => {
  const text = await call('testrail_run', {
    action: 'create',
    project_id: projectId,
    name: `Smoke ${stamp}`,
    case_ids: [caseId],
  });

  runId = Number(/Created run (\d+)/.exec(text)?.[1]);

  return `run ${runId}`;
});

await step(
  'testrail_report_result',
  async () =>
    (
      await call('testrail_report_result', {
        run_id: runId,
        results: [{ case_id: caseId, status: 'passed', comment: 'write smoke' }],
      })
    ).split('\n')[0] ?? '',
);

await step('testrail_run_report sees the result', async () => {
  const text = await call('testrail_run_report', { run_id: runId });

  if (!text.includes('100.0% passing')) throw new Error(text.split('\n').slice(0, 8).join(' '));

  return '100.0% passing';
});

await step(
  'testrail_run close',
  async () => (await call('testrail_run', { action: 'close', run_id: runId })).split('\n')[0] ?? '',
);

await step('clean up the section and its case', async () => {
  await testrail.request<Json>(`delete_section/${section.id}`, {});

  return `section ${section.id} deleted`;
});

await client.close();

await server.close();

console.log(failures === 0 ? '\nAll write checks passed.' : `\n${failures} of the write checks failed.`);

process.exitCode = failures === 0 ? 0 : 1;
