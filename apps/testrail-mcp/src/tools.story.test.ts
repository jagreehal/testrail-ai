import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { story } from 'executable-stories-vitest';
import type { Json } from 'testrail-ai';
import { fakeTestRail, page, TEST_CONFIG } from 'testrail-ai/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from './server';
import { textOf } from './tool-text';

/**
 * Every tool, driven through the protocol against one small fake instance:
 * project 5, a nightly run 612 with one pass and one failure, and the run
 * before it (611) where the failing case still passed.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const RUN = {
  id: 612,
  project_id: 5,
  suite_id: 20,
  name: 'Nightly regression',
  is_completed: false,
  created_on: 1_770_000_000,
  passed_count: 1,
  failed_count: 1,
  blocked_count: 0,
  retest_count: 0,
  untested_count: 0,
};

const EARLIER_RUN = { ...RUN, id: 611, name: 'Previous nightly', created_on: 1_769_900_000, failed_count: 0 };

const CHECKOUT = {
  id: 102,
  title: 'Checkout totals',
  section_id: 10,
  suite_id: 20,
  priority_id: 4,
  type_id: 7,
  refs: null,
};

const CASES = [
  {
    id: 101,
    title: 'Login succeeds',
    section_id: 10,
    suite_id: 20,
    priority_id: 2,
    type_id: 7,
    refs: 'RP-1',
  },
  CHECKOUT,
];

const WORLD = {
  get_statuses: [
    { id: 1, name: 'passed', label: 'Passed', is_final: true, is_untested: false },
    { id: 2, name: 'blocked', label: 'Blocked', is_final: true, is_untested: false },
    { id: 3, name: 'untested', label: 'Untested', is_final: false, is_untested: true },
    { id: 4, name: 'retest', label: 'Retest', is_final: false, is_untested: false },
    { id: 5, name: 'failed', label: 'Failed', is_final: true, is_untested: false },
  ],
  get_priorities: [
    { id: 2, name: 'Medium', short_name: 'Medium' },
    { id: 4, name: 'Critical', short_name: 'Critical' },
  ],
  get_case_types: [{ id: 7, name: 'Functional' }],
  get_users: page('users', []),
  get_projects: page('projects', [{ id: 5, name: 'Curve Core', suite_mode: 1, is_completed: false }]),
  'get_plans/5': page('plans', []),
  'get_runs/5': page('runs', [RUN, EARLIER_RUN]),
  'get_run/612': RUN,
  'get_run/611': EARLIER_RUN,
  'get_tests/612': page('tests', [
    { id: 1, case_id: 101, run_id: 612, title: 'Login succeeds', status_id: 1 },
    { id: 2, case_id: 102, run_id: 612, title: 'Checkout totals', status_id: 5 },
  ]),
  'get_tests/611': page('tests', [
    { id: 11, case_id: 101, run_id: 611, title: 'Login succeeds', status_id: 1 },
    { id: 12, case_id: 102, run_id: 611, title: 'Checkout totals', status_id: 1 },
  ]),
  'get_results_for_run/612': page('results', [
    {
      id: 900,
      test_id: 2,
      status_id: 5,
      comment: 'Total off by one cent',
      defects: 'PAY-7',
      created_on: 1_770_000_100,
    },
  ]),
  'get_results_for_run/611': page('results', []),
  'get_results/': page('results', [{ id: 901, test_id: 2, status_id: 5, created_on: 1_770_000_100 }]),
  'get_cases/5': page('cases', CASES),
  'get_case/102': CHECKOUT,
  'get_suite/20': { id: 20, project_id: 5 },
  'get_section/10': { id: 10, name: 'Payments' },
  'add_case/10': { id: 103, title: 'Refund succeeds' },
  'update_case/102': { id: 102, title: 'Checkout totals (GBP)' },
  'add_run/5': { ...RUN, id: 613, name: 'Release candidate' },
  'update_run/612': { ...RUN, name: 'Nightly regression (rerun)' },
  'close_run/612': RUN,
  'add_results_for_cases/612': [{ id: 950, test_id: 2, status_id: 1 }],
  get_shared_steps: page('shared_steps', [{ id: 3, title: 'Log in as admin' }]),
};

async function connect(allowWrites = false, defaultProjectId?: number) {
  const fake = fakeTestRail(WORLD, { allowWrites, defaultProjectId });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer({ ...TEST_CONFIG, allowWrites, defaultProjectId }, { client: fake.client });
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  cleanup = () => {
    void client.close();
    void server.close();
  };

  const call = async (name: string, args: Record<string, Json>) => {
    const result = await client.callTool({ name, arguments: args });
    const text = textOf(result);

    return { isError: result.isError === true, text };
  };

  return { call, fake, client };
}

describe('A configured default project', () => {
  it('fills in project_id wherever a call leaves it out, and says so', async ({ task }) => {
    story.init(task, { tags: ['tools', 'configuration'], covers: ['src/tools.ts'] });

    story.given('a server started with TESTRAIL_PROJECT_ID=5');
    const { call, fake, client } = await connect(true, 5);

    story.when('tools are called with no project_id');

    const results = await Promise.all([
      call('testrail_flaky', {}),
      call('testrail_coverage', {}),
      call('testrail_search', { entity: 'runs' }),
      call('testrail_run_report', {}),
      call('testrail_run', { action: 'create', name: 'Release candidate' }),
    ]);

    story.then('each works on project 5');
    expect(results.map((result) => result.isError)).toEqual([false, false, false, false, false]);
    expect(results[0].text).toContain('of project 5');
    expect(results[3].text).toContain('Nightly regression');
    expect(fake.calls).toContain('add_run/5');

    story.and('the tool schema and the server instructions name the default');
    const { tools } = await client.listTools();
    const flaky = tools.find((tool) => tool.name === 'testrail_flaky');
    expect(JSON.stringify(flaky?.inputSchema)).toContain('Defaults to project 5.');
    expect(client.getInstructions()).toContain('Default project: 5.');
  });

  it('asks for a project when none is configured', async ({ task }) => {
    story.init(task, { tags: ['tools', 'configuration'] });

    const { call } = await connect();
    const result = await call('testrail_flaky', {});

    expect(result.isError).toBe(true);
    expect(result.text).toContain('no default project is set (TESTRAIL_PROJECT_ID)');
  });
});

describe('The read tools', () => {
  it.for([
    ['testrail_search', { entity: 'projects', limit: 10 }, 'Curve Core'],
    ['testrail_search', { entity: 'cases', project_id: 5, limit: 10 }, 'Checkout totals'],
    ['testrail_search', { entity: 'runs', project_id: 5, limit: 10 }, 'Nightly regression'],
    ['testrail_search', { entity: 'tests', run_id: 612, limit: 10 }, 'Checkout totals'],
    ['testrail_run_report', { run_id: 612 }, 'Total off by one cent'],
    ['testrail_failures', { run_id: 612, include_last_good: true }, 'Checkout totals'],
    ['testrail_flaky', { project_id: 5 }, 'Checkout totals'],
    ['testrail_coverage', { project_id: 5 }, '| 102 | Checkout totals | Critical |'],
    ['testrail_case', { case_id: 102 }, 'Checkout totals'],
  ] as const)('%s answers %j with markdown', async ([name, args, expected], { task }) => {
    story.init(task, { tags: ['mcp', 'tools'], covers: ['src/tools.ts'] });

    story.given('a read-only server over a small TestRail instance');
    const { call } = await connect();

    story.when(`${name} is called`);
    story.json({ label: 'Arguments', value: args });
    const result = await call(name, args);
    story.code({ label: 'Response', content: result.text, lang: 'markdown' });

    story.then('it answers without error and names what it found');
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain(expected);
  });

  it.for([
    ['testrail_run_report', { run_id: 999 }, 'TestRail 404 on get_run/999'],
    ['testrail_failures', { run_id: 999 }, 'TestRail 404 on get_run/999'],
    ['testrail_flaky', { project_id: 999 }, 'TestRail 404 on get_runs/999'],
    ['testrail_coverage', { project_id: 999 }, 'TestRail 404 on get_cases/999'],
    ['testrail_case', {}, 'case_id'],
    ['testrail_search', { entity: 'cases', limit: 10 }, "entity 'cases' needs a project_id"],
  ] as const)('%s turns %j into a readable tool error', async ([name, args, expected], { task }) => {
    story.init(task, { tags: ['mcp', 'tools', 'errors'], covers: ['src/tools.ts'] });

    story.given('a read-only server');
    const { call } = await connect();

    story.when(`${name} is called with arguments TestRail cannot satisfy`);
    const result = await call(name, args);
    story.code({ label: 'Response', content: result.text });

    story.then('the failure is an isError result the model can read, not a protocol error');
    expect(result.isError).toBe(true);
    expect(result.text).toContain(expected);
  });
});

describe('The write tools', () => {
  it.for([
    ['testrail_case_write', { action: 'create', section_id: 10, title: 'Refund succeeds' }],
    ['testrail_case_write', { action: 'update', case_id: 102, title: 'Checkout totals (GBP)' }],
    ['testrail_run', { action: 'create', project_id: 5, name: 'Release candidate' }],
    ['testrail_run', { action: 'update', run_id: 612, name: 'Nightly regression (rerun)' }],
    ['testrail_run', { action: 'close', run_id: 612 }],
    ['testrail_report_result', { run_id: 612, results: [{ case_id: 102, status: 'passed' }] }],
  ] as const)('%s %j refuses while writes are disabled', async ([name, args], { task }) => {
    story.init(task, { tags: ['mcp', 'tools', 'safety'], covers: ['src/tools.ts'] });

    story.given('a server started without TESTRAIL_ALLOW_WRITES');
    const { call, fake } = await connect(false);

    story.when(`${name} is asked to write`);
    const result = await call(name, args);

    story.then('it refuses, and no write reached TestRail');
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Writes are disabled');
    expect(fake.calls.filter((endpoint) => /^(add|update|close)_/.test(endpoint))).toEqual([]);
  });

  it.for([
    [
      'testrail_case_write',
      { action: 'create', section_id: 10, title: 'Refund succeeds' },
      'Created case C103 — Refund succeeds',
    ],
    [
      'testrail_case_write',
      { action: 'update', case_id: 102, title: 'Checkout totals (GBP)' },
      'Updated case C102 — Checkout totals (GBP)\nChanged: title',
    ],
    [
      'testrail_run',
      { action: 'create', project_id: 5, name: 'Release candidate' },
      'Created run 613 — Release candidate',
    ],
    [
      'testrail_run',
      { action: 'update', run_id: 612, name: 'Nightly regression (rerun)' },
      'Updated run 612 — Nightly regression (rerun)\nChanged: name',
    ],
    ['testrail_run', { action: 'close', run_id: 612 }, 'This is permanent; the run is now archived.'],
    [
      'testrail_report_result',
      { run_id: 612, results: [{ case_id: 102, status: 'passed' }] },
      'Posted 1 result to run 612.',
    ],
  ] as const)('%s %j succeeds once writes are enabled', async ([name, args, expected], { task }) => {
    story.init(task, { tags: ['mcp', 'tools', 'writes'], covers: ['src/tools.ts'] });

    story.given('a server started with TESTRAIL_ALLOW_WRITES=true');
    const { call } = await connect(true);

    story.when(`${name} writes`);
    const result = await call(name, args);
    story.code({ label: 'Response', content: result.text });

    story.then('it reports what changed, with a link back to TestRail');
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain(expected);
    expect(result.text).toContain('https://example.testrail.io/');
  });

  it.for([
    ['testrail_case_write', { action: 'create', title: 'No section' }, 'action:"create" needs a section_id.'],
    ['testrail_case_write', { action: 'update', title: 'No id' }, 'action:"update" needs a case_id.'],
    [
      'testrail_run',
      { action: 'create', name: 'No project' },
      'no default project is set (TESTRAIL_PROJECT_ID)',
    ],
    ['testrail_run', { action: 'update', name: 'No id' }, 'action:"update" needs a run_id.'],
    ['testrail_run', { action: 'close' }, 'action:"close" needs a run_id.'],
    [
      'testrail_report_result',
      { run_id: 612, results: [{ case_id: 102, status: 'untested' }] },
      "TestRail does not accept 'untested' as a posted result (cases 102)",
    ],
  ] as const)('%s %j names the missing piece', async ([name, args, expected], { task }) => {
    story.init(task, { tags: ['mcp', 'tools', 'validation'], covers: ['src/tools.ts'] });

    story.given('a server with writes enabled');
    const { call, fake } = await connect(true);

    story.when('a write is missing what it needs');
    const result = await call(name, args);

    story.then('the error says which argument to add, and nothing was written');
    expect(result.isError).toBe(true);
    expect(result.text).toContain(expected);
    expect(fake.calls.filter((endpoint) => /^(add|update|close)_/.test(endpoint))).toEqual([]);
  });
});

describe('The raw escape hatch', () => {
  it('reads any endpoint, normalising a pasted URL', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'tools', 'raw'], covers: ['src/tools.ts'] });

    story.given('a read-only server');
    const { call, fake } = await connect();

    story.when('a full TestRail URL is passed as the endpoint');

    const result = await call('testrail_raw', {
      endpoint: 'https://example.testrail.io/index.php?/api/v2/get_shared_steps/5',
    });

    story.code({ label: 'Response', content: result.text });

    story.then('it calls the path after /api/v2/ and returns the JSON');
    expect(result.isError, result.text).toBe(false);
    expect(fake.calls).toContain('get_shared_steps/5');
    expect(result.text).toContain('`get_shared_steps/5`');
    expect(result.text).toContain('Log in as admin');
  });

  it('refuses a body on a read endpoint rather than letting TestRail ignore it', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'tools', 'raw', 'validation'], covers: ['src/tools.ts'] });

    story.given('a server with writes enabled');
    const { call, fake } = await connect(true);

    story.when('a body is sent to a get_ endpoint');
    const result = await call('testrail_raw', { endpoint: '/api/v2/get_case/102', body: { title: 'x' } });

    story.then('it is refused before any request');
    expect(result.isError).toBe(true);
    expect(result.text).toContain("'get_case/102' is a read endpoint but a body was supplied.");
    expect(fake.calls).toEqual([]);
  });

  it('refuses a raw write while writes are disabled', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'tools', 'raw', 'safety'], covers: ['src/tools.ts'] });

    story.given('a read-only server');
    const { call, fake } = await connect(false);

    story.when('a write endpoint is called through testrail_raw');
    const result = await call('testrail_raw', { endpoint: 'close_run/612', body: {} });

    story.then('the client write gate refuses it');
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Writes are disabled');
    expect(fake.calls).toEqual([]);
  });
});
