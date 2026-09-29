import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { story } from 'executable-stories-vitest';
import { fakeTestRail, page, TEST_CONFIG, type Route } from 'testrail-ai/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from './server';

/**
 * Resources are read by the client before the model spends a turn, so what they
 * say has to be right on its own: ids, names, and the lookup tables every tool
 * call depends on.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const CORE = { id: 5, name: 'Curve Core', suite_mode: 1, is_completed: false };

const LABS = { id: 7, name: 'Curve Labs', suite_mode: 2, is_completed: false };

const PROJECTS = [CORE, { id: 6, name: 'Curve Pay', suite_mode: 3, is_completed: true }, LABS];

const RUN = {
  id: 612,
  project_id: 5,
  name: 'Nightly regression',
  is_completed: false,
  created_on: 1_770_000_000,
  passed_count: 1,
  failed_count: 1,
  blocked_count: 0,
  retest_count: 0,
  untested_count: 0,
};

const REFERENCE = {
  get_statuses: [
    { id: 1, name: 'passed', label: 'Passed', is_final: true, is_untested: false },
    { id: 3, name: 'untested', label: 'Untested', is_final: false, is_untested: true },
    { id: 5, name: 'failed', label: 'Failed', is_final: true, is_untested: false },
  ],
  get_priorities: [{ id: 4, name: 'Critical', short_name: 'Critical' }],
  get_case_types: [{ id: 7, name: 'Functional' }],
  get_projects: page('projects', PROJECTS),
  'get_project/5': CORE,
  'get_project/7': LABS,
  'get_suites/5': page('suites', [{ id: 20, name: 'Master' }]),
  'get_sections/5': page('sections', [
    { id: 10, name: 'Payments', parent_id: null },
    { id: 11, name: 'Refunds', parent_id: 10 },
  ]),
  'get_milestones/5': page('milestones', [
    { id: 3, name: 'v2.4', due_on: 1_771_000_000, is_completed: false },
  ]),
  'get_runs/5': page('runs', [RUN]),
  'get_run/612': RUN,
  'get_tests/612': page('tests', [
    { id: 1, case_id: 101, title: 'Login succeeds', status_id: 1, assignedto_id: 16 },
    { id: 2, case_id: 102, title: 'Checkout totals', status_id: 5, assignedto_id: null },
  ]),
};

async function connect(routes: Record<string, Route>, allowWrites = false) {
  const fake = fakeTestRail(routes, { allowWrites });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer({ ...TEST_CONFIG, allowWrites }, { client: fake.client });
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  cleanup = () => {
    void client.close();
    void server.close();
  };

  const read = async (uri: string) => {
    const { contents } = await client.readResource({ uri });

    return contents.map((part) => ('text' in part ? part.text : '')).join('\n');
  };

  return { client, fake, read };
}

describe('Browsable resources', () => {
  it('lists every project with a human suite mode and status', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'resources'], covers: ['src/resources.ts'] });

    story.given('an instance with three projects in each suite mode');
    const { read } = await connect({ ...REFERENCE, get_users: page('users', []) });

    story.when('testrail://projects is read');
    const text = await read('testrail://projects');
    story.code({ label: 'testrail://projects', content: text, lang: 'markdown' });

    story.then('each row carries its id, suite mode and status in words');
    expect(text).toContain('# TestRail projects (3)');
    expect(text).toContain('| 5 | Curve Core | single suite | active |');
    expect(text).toContain('| 6 | Curve Pay | multiple suites | completed |');
    expect(text).toContain('| 7 | Curve Labs | baselines | active |');
  });

  it('gives the lookup tables, and says when users cannot be listed', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'resources'], covers: ['src/resources.ts'] });

    story.given('an API key without administrator rights, so get_users is refused');

    const { read } = await connect({
      ...REFERENCE,
      get_users: () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
    });

    story.when('testrail://meta is read');
    const text = await read('testrail://meta');
    story.code({ label: 'testrail://meta', content: text, lang: 'markdown' });

    story.then('statuses, priorities and types are tabled');
    expect(text).toContain('| 5 | failed | Failed | yes |  |');
    expect(text).toContain('| 3 | untested | Untested |  | yes |');
    expect(text).toContain('| 4 | Critical |');
    expect(text).toContain('| 7 | Functional |');

    story.and('the missing users are explained rather than silently empty');
    expect(text).toContain('The API key cannot list users');
    expect(text).toContain('Writes are **disabled** on this server.');
  });

  it('lists users when the key can see them, and says writes are on', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'resources'], covers: ['src/resources.ts'] });

    story.given('an administrator key on a server with writes enabled');

    const { read } = await connect(
      { ...REFERENCE, get_users: page('users', [{ id: 16, name: 'Dana', email: 'dana@acme.com' }]) },
      true,
    );

    story.when('testrail://meta is read');
    const text = await read('testrail://meta');

    story.then('the users table and the write switch are both there');
    expect(text).toContain('## Users (1)');
    expect(text).toContain('| 16 | Dana | dana@acme.com |');
    expect(text).toContain('Writes are **enabled** on this server.');
  });

  it('offers one overview per project through a listable template', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'resources'], covers: ['src/resources.ts'] });

    story.given('a connected client');
    const { client } = await connect({ ...REFERENCE, get_users: page('users', []) });

    story.when('resources are listed');
    const { resources } = await client.listResources();
    story.table({
      label: 'Resources',
      columns: ['URI', 'Name'],
      rows: resources.map((resource) => [resource.uri, resource.name]),
    });

    story.then('each project appears as its own testrail://project/{id}');
    expect(resources.map((resource) => resource.uri)).toEqual(
      expect.arrayContaining(['testrail://project/5', 'testrail://project/6', 'testrail://project/7']),
    );
  });

  it('summarises a project: suites, sections, milestones and recent runs', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'resources'], covers: ['src/resources.ts'] });

    story.given('project 5 with one of everything');
    const { read } = await connect({ ...REFERENCE, get_users: page('users', []) });

    story.when('testrail://project/5 is read');
    const text = await read('testrail://project/5');
    story.code({ label: 'testrail://project/5', content: text, lang: 'markdown' });

    story.then('every section of the overview is filled from TestRail');
    expect(text).toContain('# Curve Core');
    expect(text).toContain('Project 5 · single suite · active');
    expect(text).toContain('https://example.testrail.io/index.php?/projects/overview/5');
    expect(text).toContain('| 20 | Master |');
    expect(text).toContain('| 11 | Refunds | 10 |');
    expect(text).toContain('## Milestones (1)');
    expect(text).toContain('| 612 | Nightly regression |');
  });

  it('still renders a project whose sub-lists TestRail refuses', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'resources', 'errors'], covers: ['src/resources.ts'] });

    story.given('project 7, where suites, sections, milestones and runs all 404');
    const { read } = await connect({ ...REFERENCE, get_users: page('users', []) });

    story.when('testrail://project/7 is read');
    const text = await read('testrail://project/7');

    story.then('the overview is empty rather than an error');
    expect(text).toContain('Project 7 · baselines · active');
    expect(text).toContain('## Suites (0)');
    expect(text).toContain('## Recent runs (0)');
  });

  it('rejects a project id that is not a number', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'resources', 'validation'], covers: ['src/resources.ts'] });

    story.given('a connected client');
    const { read, fake } = await connect({ ...REFERENCE, get_users: page('users', []) });

    story.when('testrail://project/core is read');
    const attempt = read('testrail://project/core');

    story.then('it fails naming the bad id, before calling TestRail');
    await expect(attempt).rejects.toThrow('Not a project id: core');
    expect(fake.calls).toEqual([]);
  });

  it('snapshots a run with each test named by status and assignee', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'resources'], covers: ['src/resources.ts'] });

    story.given('run 612 with one pass and one failure');
    const { read } = await connect({ ...REFERENCE, get_users: page('users', []) });

    story.when('testrail://run/612 is read');
    const text = await read('testrail://run/612');
    story.code({ label: 'testrail://run/612', content: text, lang: 'markdown' });

    story.then('counts and per-test rows are there');
    expect(text).toContain('# Nightly regression');
    expect(text).toContain('Run 612 · open');
    expect(text).toContain('1 passed · 1 failed · 0 blocked · 0 retest · 0 untested');
    expect(text).toContain('| 101 | Login succeeds | passed | user:16 |');
    expect(text).toContain('| 102 | Checkout totals | failed | unassigned |');
  });

  it('rejects a run id that is not a number', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'resources', 'validation'], covers: ['src/resources.ts'] });

    story.given('a connected client');
    const { read } = await connect({ ...REFERENCE, get_users: page('users', []) });

    story.when('testrail://run/latest is read');
    const attempt = read('testrail://run/latest');

    story.then('it fails naming the bad id');
    await expect(attempt).rejects.toThrow('Not a run id: latest');
  });
});
