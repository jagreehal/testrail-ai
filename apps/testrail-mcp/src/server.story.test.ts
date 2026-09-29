import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { story } from 'executable-stories-vitest';
import { fakeTestRail, page, TEST_CONFIG } from 'testrail-ai/testing';
import { recordCapabilities } from 'mcp-authz/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from './server';
import { textOf } from './tool-text';

/**
 * The MCP surface, driven through the real protocol.
 *
 * An in-memory transport pair means these tests run exactly what a client runs —
 * schema validation, `isError` results, resource templates and all — against a
 * faked TestRail. Calling the handlers directly would skip the part most likely
 * to break.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const PROJECTS = page('projects', [
  { id: 5, name: 'Curve Core', suite_mode: 1, is_completed: false },
  { id: 6, name: 'Curve Pay', suite_mode: 1, is_completed: false },
]);

const REFERENCE_DATA = {
  get_statuses: [
    { id: 1, name: 'passed', label: 'Passed', is_final: true, is_untested: false },
    { id: 3, name: 'untested', label: 'Untested', is_final: false, is_untested: true },
    { id: 5, name: 'failed', label: 'Failed', is_final: true, is_untested: false },
  ],
  get_priorities: [{ id: 2, name: 'Medium', short_name: 'Medium' }],
  get_case_types: [{ id: 7, name: 'Other' }],
  get_users: page('users', []),
};

async function connect(allowWrites = false) {
  const fake = fakeTestRail(
    { ...REFERENCE_DATA, get_projects: PROJECTS, 'get_cases/5': page('cases', []) },
    { allowWrites },
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer({ ...TEST_CONFIG, allowWrites }, { client: fake.client });
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);

  return {
    client,
    fake,
    close: () => {
      fake.restore();
      void client.close();
      void server.close();
    },
  };
}

describe('The MCP tool surface', () => {
  it('exposes ten task-oriented tools, each fully described', async ({ task }) => {
    story.init(task, { tags: ['mcp'], covers: ['src/tools.ts'] });

    story.given('a connected MCP client');
    const session = await connect();
    cleanup = session.close;

    story.when('the tool list is requested');
    const { tools } = await session.client.listTools();
    story.table({
      label: 'Tools',
      columns: ['Name', 'Read-only', 'Destructive'],
      rows: tools.map((tool) => [
        tool.name,
        String(tool.annotations?.readOnlyHint ?? false),
        String(tool.annotations?.destructiveHint ?? false),
      ]),
    });

    story.then('there are ten, not one per REST endpoint');
    story.note('The two community TestRail MCP servers expose 42 and ~30 tools respectively.');
    expect(tools).toHaveLength(10);

    story.and('every tool carries a description and an input schema');

    for (const tool of tools) {
      expect(tool.description, `${tool.name} description`).toBeTruthy();
      expect(tool.inputSchema, `${tool.name} schema`).toBeTruthy();
    }
  });

  it('annotates honestly which tools mutate and which destroy', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'safety'], covers: ['src/tools.ts'] });

    story.given('a connected MCP client');
    const session = await connect();
    cleanup = session.close;

    story.when('the annotations are inspected');
    const { tools } = await session.client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool.annotations ?? {}]));

    story.then('the analysis tools and the case reader declare themselves read-only');

    for (const name of [
      'testrail_search',
      'testrail_run_report',
      'testrail_failures',
      'testrail_flaky',
      'testrail_coverage',
      'testrail_case',
    ]) {
      expect(byName.get(name)?.readOnlyHint, name).toBe(true);
    }

    story.and('the write tools do not');

    for (const name of ['testrail_case_write', 'testrail_run', 'testrail_report_result', 'testrail_raw']) {
      expect(byName.get(name)?.readOnlyHint, name).toBe(false);
    }

    story.and('closing a run is flagged destructive, because it cannot be undone');
    story.note(
      'A client that prompts on destructiveHint is the only thing between a model and an archived run.',
    );
    expect(byName.get('testrail_run')?.destructiveHint).toBe(true);

    story.but('posting a result is not — results append to a history rather than overwriting');
    expect(byName.get('testrail_report_result')?.destructiveHint).toBe(false);
  });

  it('offers browsable resources so ids cost no tool turn', async ({ task }) => {
    story.init(task, { tags: ['mcp'], covers: ['src/resources.ts'] });

    story.given('a connected MCP client');
    const session = await connect();
    cleanup = session.close;

    story.when('resources are listed');
    const { resources } = await session.client.listResources();
    story.json({ label: 'Resources', value: resources.map((r) => r.uri) });

    story.then('the fixed lookups are there');
    const uris = resources.map((resource) => resource.uri);
    expect(uris).toContain('testrail://projects');
    expect(uris).toContain('testrail://meta');

    story.and('each project is enumerated from the live instance');
    story.note('These can be attached by the client up front, before the conversation starts.');
    expect(uris).toContain('testrail://project/5');
    expect(uris).toContain('testrail://project/6');
  });

  it('offers the three QA workflows as human-chosen prompts', async ({ task }) => {
    story.init(task, { tags: ['mcp'], covers: ['src/prompts.ts'] });

    story.given('a connected MCP client');
    const session = await connect();
    cleanup = session.close;

    story.when('prompts are listed');
    const { prompts } = await session.client.listPrompts();

    story.then('triage, summary and coverage are offered');
    story.note('A tool is chosen by the model mid-reasoning; a prompt is chosen by a human from a menu.');
    expect(prompts.map((prompt) => prompt.name)).toEqual([
      'triage_run',
      'regression_summary',
      'coverage_gap',
    ]);
  });
});

describe('Refusing writes on a read-only server', () => {
  it('turns every write tool into an explained refusal', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'safety'], covers: ['src/tools.ts'] });

    story.given('a server started without TESTRAIL_ALLOW_WRITES');
    const session = await connect(false);
    cleanup = session.close;

    story.when('a result is posted');

    const result = await session.client.callTool({
      name: 'testrail_report_result',
      arguments: { run_id: 1, results: [{ case_id: 1, status: 'passed' }] },
    });

    story.code({ label: 'Response', content: textOf(result) });

    story.then('it comes back as a tool error the model can read and recover from');
    story.note('A tool-level isError reaches the conversation; a thrown protocol error never does.');
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Writes are disabled');

    story.and('no request reached TestRail');
    expect(session.fake.calls.filter((call) => call.startsWith('add_'))).toEqual([]);
  });

  it('cannot be bypassed through the raw escape hatch', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'safety'], covers: ['src/tools.ts'] });

    story.given('a read-only server and a caller reaching for the raw API tool');
    const session = await connect(false);
    cleanup = session.close;

    story.when('a write endpoint is called directly through testrail_raw');

    const result = await session.client.callTool({
      name: 'testrail_raw',
      arguments: { endpoint: 'add_result_for_case/1/1', body: { status_id: 1 } },
    });

    story.then('the same gate refuses it');
    story.note('The gate lives in the client, so every path through the server inherits it.');
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Writes are disabled');
  });

  it('says so in the server instructions, so the model does not keep trying', async ({ task }) => {
    story.init(task, { tags: ['mcp'] });

    story.given('a read-only server');
    const session = await connect(false);
    cleanup = session.close;

    story.when('the server instructions are read');
    const instructions = session.client.getInstructions();

    story.then('the read-only state is stated plainly');
    expect(instructions).toContain('Writes are DISABLED');

    story.and('the model is told not to retry');
    expect(instructions).toContain('Do not retry them');
  });
});

describe('Validating tool input at the protocol boundary', () => {
  it('rejects a flaky threshold below two before any work happens', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'validation'], covers: ['src/tools.ts'] });

    story.given('a caller asking for cases with a single pass/fail transition');
    story.note('One transition is a regression or a fix, never flakiness.');
    const session = await connect();
    cleanup = session.close;

    story.when('min_flips 1 is requested');

    // The SDK may surface a schema violation as a rejection or as an isError
    // result depending on where validation lands; either is a refusal.
    const outcome = await session.client
      .callTool({ name: 'testrail_flaky', arguments: { project_id: 5, min_flips: 1 } })
      .then((result) => ({ thrown: false as const, text: textOf(result), isError: result.isError }))
      .catch((cause: unknown) => ({
        thrown: true as const,
        text: cause instanceof Error ? cause.message : String(cause),
        isError: true,
      }));

    story.json({ label: 'Outcome', value: outcome });

    story.then('the call is refused rather than silently widening the definition of flaky');
    expect(outcome.isError).toBe(true);

    story.and('the message names the offending argument');
    expect(outcome.text).toMatch(/min_flips/);
  });

  it('explains which id a search is missing rather than guessing', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'validation'] });

    story.given('a search for cases with no project named');
    const session = await connect();
    cleanup = session.close;

    story.when('the search runs');

    const result = await session.client.callTool({
      name: 'testrail_search',
      arguments: { entity: 'cases' },
    });

    story.then('it fails with the missing argument and how to find it');
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('needs a project_id');
  });

  it('hands a remote deployment the server before its tools are registered', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'authorization'] });

    story.given('a connector that wants to gate these tools per person');
    story.note(
      "The SDK keeps a built server's tool list private, so a gate applied afterwards has " +
        'nothing left to intercept. This hook is the seam `gate()` from mcp-authz needs.',
    );

    story.when('its wrap function registers a tool of its own');
    const fake = fakeTestRail({ ...REFERENCE_DATA, get_projects: PROJECTS }, { allowWrites: false });

    const server = buildServer(TEST_CONFIG, {
      client: fake.client,
      wrap: (built) => {
        built.registerTool('wrap_sentinel', { description: 'Registered by the wrap' }, () => ({
          content: [{ type: 'text', text: 'sentinel' }],
        }));

        return built;
      },
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    await client.close();
    await server.close();
    fake.restore();

    story.then(
      'its tool is listed first, ahead of all ten, so the wrap saw the server before any registration',
    );
    expect(tools[0]?.name).toBe('wrap_sentinel');
    expect(tools).toHaveLength(11);
  });

  it('prices every capability the server lists, and fingerprints each one', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'authorization'], covers: ['src/permissions.ts'] });

    story.given('the exported GATE_PERMISSIONS map');
    const { GATE_PERMISSIONS } = await import('./permissions');
    const PRICES = new Map<string, string>(Object.entries(GATE_PERMISSIONS));

    story.when('mcp-authz lists the ungated server the way a client would');
    story.note(
      'Ungated on purpose: a gated server answers per principal, and its list would miss the ' +
        'capabilities that most need a price.',
    );
    story.note(
      'No projects, so the `project` template lists no instances. Each instance is TestRail data, ' +
        'not a capability, and the map prices the template itself.',
    );

    const fake = fakeTestRail(
      { ...REFERENCE_DATA, get_projects: page('projects', []) },
      { allowWrites: false },
    );

    const record = await recordCapabilities(() => buildServer(TEST_CONFIG, { client: fake.client }));
    fake.restore();
    story.table({
      label: 'Capabilities and their price',
      columns: ['Capability', 'Permission'],
      rows: record.names.map((name) => [name, PRICES.get(name) ?? '—']),
    });

    story.then('the map names exactly what the server serves');
    expect(record.names).toEqual(Object.keys(GATE_PERMISSIONS).toSorted());

    story.and('the escape hatch is admin, not write');
    expect(GATE_PERMISSIONS.testrail_raw).toBe('testrail:admin');

    story.and('each definition is fingerprinted, so a changed description or schema shows up in review');
    expect(record.fingerprints).toMatchSnapshot();
  });
});
