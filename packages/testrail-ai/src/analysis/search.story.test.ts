import { story } from 'executable-stories-vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { FAKE_META, fakeTestRail, page } from '../test-support';
import type { Json } from '../types';
import { formatSearch, search } from './search';

/**
 * Search's whole value is pushing filters down to TestRail. A filter that gets
 * dropped on the way to the URL still returns plausible-looking rows — it just
 * returns the wrong ones — so the assertion here is on the request, not the result.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe('Searching cases', () => {
  it('asks TestRail to filter by requirement and label rather than fetching everything', async ({ task }) => {
    story.init(task, { tags: ['search'], covers: ['src/analysis/search.ts'] });

    story.given('a project whose cases are linked to Jira tickets and tagged with labels');
    const fake = fakeTestRail({ get_cases: page('cases', []) });
    cleanup = fake.restore;

    story.when('someone asks which cases cover JIRA-1234 under labels 3 or 7');
    await search(
      { entity: 'cases', project_id: 5, refs: 'JIRA-1234', label_id: [3, 7], limit: 50 },
      { client: fake.client, meta: FAKE_META },
    );

    story.then('both filters travel in the request, so TestRail does the narrowing');
    story.note(
      'Filtering client-side would mean paging through every case in the project to answer a question about one ticket.',
    );
    expect(fake.calls[0]).toContain('refs=JIRA-1234');
    expect(fake.calls[0]).toContain('label_id=3,7');
  });
});

describe('Search completeness and validation', () => {
  it('reports when a non-case search was capped', async ({ task }) => {
    story.init(task, { tags: ['search', 'pagination', 'regression'] });

    const fake = fakeTestRail({
      get_projects: page(
        'projects',
        [{ id: 1, name: 'One', suite_mode: 1, is_completed: false }],
        '/api/v2/get_projects&limit=1&offset=1',
      ),
    });

    cleanup = fake.restore;

    const result = await search({ entity: 'projects', limit: 1 }, { client: fake.client, meta: FAKE_META });

    expect(result.complete).toBe(false);
    expect(result.warnings.join(' ')).toMatch(/Capped/);
  });

  it('rejects an unknown entity before loading metadata or calling TestRail', async ({ task }) => {
    story.init(task, { tags: ['search', 'validation', 'regression'] });
    const fake = fakeTestRail({});
    cleanup = fake.restore;

    // SAFETY: an entity outside the schema, passed on purpose to show the schema rejects it.
    await expect(search({ entity: 'unknown', limit: 50 } as never, { client: fake.client })).rejects.toThrow(
      /"entity"/,
    );
    expect(fake.calls).toEqual([]);
  });
});

const DAY = 1_700_000_000; // 2023-11-14

const RUN_ROWS = [
  {
    id: 600,
    name: 'Core regression',
    plan_id: null,
    config: null,
    created_on: DAY,
    passed_count: 9,
    failed_count: 1,
    blocked_count: 0,
    untested_count: 2,
    is_completed: false,
  },
  {
    id: 601,
    name: 'Nightly',
    plan_id: null,
    config: null,
    created_on: DAY,
    passed_count: 0,
    failed_count: 0,
    blocked_count: 0,
    untested_count: 0,
    is_completed: true,
  },
  {
    id: 602,
    name: 'Core release',
    plan_id: 40,
    config: 'Chrome',
    created_on: DAY,
    passed_count: 4,
    failed_count: 0,
    blocked_count: 0,
    untested_count: 0,
    is_completed: false,
  },
];

const CASE_ROWS = [
  { id: 20, title: 'Core login works', priority_id: 4, type_id: 7, refs: 'JIRA-1', updated_on: DAY },
  { id: 21, title: 'Untitled', priority_id: null, type_id: null, refs: null, updated_on: 0 },
];

/** One project's worth of every entity, each with a row that should match "core" and one that should not. */
const SUITE_ROWS = [
  { id: 7, name: 'Core smoke', description: 'Fast checks' },
  { id: 8, name: 'Nightly', description: null },
];

const SECTION_ROWS = [
  { id: 30, name: 'Core login', parent_id: null },
  { id: 31, name: 'Core logout', parent_id: 30 },
  { id: 32, name: 'Billing', parent_id: null },
];

const PLAN_ROWS = [
  { id: 40, name: 'Core release', created_on: DAY, is_completed: true },
  { id: 41, name: 'Other', created_on: DAY, is_completed: false },
];

const MILESTONE_ROWS = [
  { id: 50, name: 'Core 1.0', due_on: null, is_completed: false },
  { id: 51, name: 'Core 2.0', due_on: DAY, is_completed: true },
  { id: 52, name: 'Beta', due_on: null, is_completed: false },
];

const TEST_ROWS = [
  { id: 900, case_id: 20, title: 'Core login works', status_id: 5, assignedto_id: 3 },
  { id: 901, case_id: 21, title: 'Logout', status_id: 1, assignedto_id: null },
];

/** The requests a search made, less the plan list a run search sends alongside its runs. */
const searchCalls = (entity: string, calls: string[]) =>
  entity === 'runs' ? calls.filter((call) => !call.startsWith('get_plans/')) : calls;

const ROUTES = {
  get_projects: page('projects', [
    { id: 1, name: 'Core', suite_mode: 1, is_completed: false },
    { id: 2, name: 'Legacy core', suite_mode: 2, is_completed: true },
    { id: 3, name: 'Mobile', suite_mode: 3, is_completed: false },
  ]),
  get_suites: page('suites', SUITE_ROWS),
  get_sections: page('sections', SECTION_ROWS),
  get_runs: page('runs', RUN_ROWS),
  get_plans: page('plans', PLAN_ROWS),
  get_milestones: page('milestones', MILESTONE_ROWS),
  get_tests: page('tests', TEST_ROWS),
  get_cases: page('cases', CASE_ROWS),
};

describe('Searching every entity', () => {
  const CASES = [
    {
      entity: 'projects',
      ids: {},
      endpoint: 'get_projects&limit=50',
      rows: [
        [1, 'Core', 'single', ''],
        [2, 'Legacy core', 'baselines', 'yes'],
      ],
    },
    {
      entity: 'suites',
      ids: { project_id: 5 },
      endpoint: 'get_suites/5&limit=50',
      rows: [[7, 'Core smoke', 'Fast checks']],
    },
    {
      entity: 'sections',
      ids: { project_id: 5, suite_id: 7 },
      endpoint: 'get_sections/5&suite_id=7&limit=50',
      rows: [
        [30, 'Core login', 'Core login'],
        [31, 'Core logout', 'Core login > Core logout'],
      ],
    },
    {
      entity: 'runs',
      ids: { project_id: 5 },
      endpoint: 'get_runs/5&include_plan_runs=1&limit=50',
      // 602 belongs to a test plan: search finds it as the reports do.
      rows: [
        [600, 'Core regression', '2023-11-14', 9, 1, 0, 2, 'open'],
        [602, 'Core release', '2023-11-14', 4, 0, 0, 0, 'open'],
      ],
    },
    {
      entity: 'plans',
      ids: { project_id: 5 },
      endpoint: 'get_plans/5&limit=50',
      rows: [[40, 'Core release', '2023-11-14', 'closed']],
    },
    {
      entity: 'milestones',
      ids: { project_id: 5 },
      endpoint: 'get_milestones/5&limit=50',
      rows: [
        [50, 'Core 1.0', '', 'open'],
        [51, 'Core 2.0', '2023-11-14', 'complete'],
      ],
    },
    {
      entity: 'tests',
      ids: { run_id: 600 },
      endpoint: 'get_tests/600&limit=50',
      rows: [[900, 20, 'Core login works', 'failed', 'user:3']],
    },
  ] as const;

  for (const { entity, ids, endpoint, rows } of CASES) {
    it(`finds ${entity} whose name contains the query, ignoring case`, async ({ task }) => {
      story.init(task, { tags: ['search', entity], covers: ['src/analysis/search.ts'] });

      story.given(`${entity} in TestRail, some matching "CORE" and some not`);
      const fake = fakeTestRail(ROUTES);
      cleanup = fake.restore;

      story.when(`searching ${entity} for "CORE"`);

      const result = await search(
        { entity, ...ids, query: 'CORE', limit: 50 },
        { client: fake.client, meta: FAKE_META },
      );

      story.code({ label: 'Rendered', content: formatSearch(result) });

      story.then('only matching rows come back, rendered as table cells');
      expect(searchCalls(entity, fake.calls)).toEqual([endpoint]);
      expect(result.rows).toEqual(rows);
      expect(result.count).toBe(rows.length);
      expect(result.raw).toHaveLength(rows.length);
      expect(result.complete).toBe(true);
    });
  }

  it('lists every row when there is no query', async ({ task }) => {
    story.init(task, { tags: ['search'] });
    const fake = fakeTestRail(ROUTES);
    cleanup = fake.restore;

    const result = await search({ entity: 'projects', limit: 50 }, { client: fake.client, meta: FAKE_META });

    expect(result.rows.map((row) => row[2])).toEqual(['single', 'baselines', 'multiple']);
    expect(result.note).toBeUndefined();
    expect(result).toMatchObject({ complete: true, warnings: [] });
  });

  it('points a run search at the run report, and says when it was capped', async ({ task }) => {
    story.init(task, { tags: ['search', 'runs', 'pagination'] });

    const fake = fakeTestRail({
      get_runs: page('runs', RUN_ROWS, '/api/v2/get_runs/5&limit=2&offset=2'),
      get_plans: page('plans', []),
    });

    cleanup = fake.restore;

    const result = await search(
      { entity: 'runs', project_id: 5, limit: 2 },
      { client: fake.client, meta: FAKE_META },
    );

    expect(result.warnings).toEqual(['Capped at 2 source rows — raise the limit to search the remainder.']);
    expect(result.note).toBe('Use the run report with a run id for the breakdown.');
    expect(result.rows[1]).toEqual([601, 'Nightly', '2023-11-14', 0, 0, 0, 0, 'closed']);
  });

  it('names cases by priority and type, and lets TestRail match their titles', async ({ task }) => {
    story.init(task, { tags: ['search', 'cases'] });
    const fake = fakeTestRail(ROUTES);
    cleanup = fake.restore;

    const result = await search(
      { entity: 'cases', project_id: 5, query: 'log in', limit: 50 },
      { client: fake.client, meta: FAKE_META },
    );

    story.then('the query becomes a server-side filter and nothing is dropped client-side');
    expect(fake.calls).toEqual(['get_cases/5&filter=log in&limit=50']);
    expect(result.rows).toEqual([
      [20, 'Core login works', 'Critical', 'type:7', 'JIRA-1', '2023-11-14'],
      [21, 'Untitled', '', '', '', ''],
    ]);
    expect(formatSearch(result)).toMatch(/^## Cases \(2\)/);
  });
});

describe('Pushing every filter down to TestRail', () => {
  it('sends each case filter as a query parameter', async ({ task }) => {
    story.init(task, { tags: ['search', 'cases', 'filters'], covers: ['src/analysis/search.ts'] });
    const fake = fakeTestRail(ROUTES);
    cleanup = fake.restore;

    story.when('every case filter is set, with ISO dates');
    await search(
      {
        entity: 'cases',
        project_id: 5,
        suite_id: 7,
        section_id: 30,
        priority_id: 4,
        type_id: 7,
        refs: 'JIRA 1',
        label_id: [3],
        created_after: '2026-05-01',
        updated_after: '2026-05-02T00:00:00Z',
        limit: 50,
      },
      { client: fake.client, meta: FAKE_META },
    );

    story.then('each one is in the URL, dates as unix seconds');
    expect(fake.calls).toEqual([
      'get_cases/5&suite_id=7&section_id=30&priority_id=4&type_id=7&refs=JIRA 1&label_id=3' +
        '&created_after=1777593600&updated_after=1777680000&limit=50',
    ]);
  });

  it('turns a relative offset into a timestamp that far back', async ({ task }) => {
    story.init(task, { tags: ['search', 'filters'] });
    const fake = fakeTestRail(ROUTES);
    cleanup = fake.restore;

    const before = Math.floor(Date.now() / 1000) - 7 * 86_400;
    await search(
      { entity: 'runs', project_id: 5, created_after: '7d', limit: 50 },
      { client: fake.client, meta: FAKE_META },
    );
    const after = Math.floor(Date.now() / 1000) - 7 * 86_400;

    const sent = Number(
      /created_after=(\d+)/.exec(fake.calls.find((call) => call.startsWith('get_runs')) ?? '')?.[1],
    );

    expect(sent).toBeGreaterThanOrEqual(before);
    expect(sent).toBeLessThanOrEqual(after);
  });

  it('refuses a date it cannot read instead of silently dropping the filter', async ({ task }) => {
    story.init(task, { tags: ['search', 'filters', 'validation'] });
    const fake = fakeTestRail(ROUTES);
    cleanup = fake.restore;

    await expect(
      search(
        { entity: 'cases', project_id: 5, created_after: 'last tuesday', limit: 50 },
        {
          client: fake.client,
          meta: FAKE_META,
        },
      ),
    ).rejects.toThrow("Could not read 'last tuesday' as a date.");
    expect(fake.calls).toEqual([]);
  });

  it.each([
    {
      entity: 'runs',
      filters: { suite_id: 7, milestone_id: 50, is_completed: true },
      query: 'get_runs/5&suite_id=7&milestone_id=50&is_completed=1&include_plan_runs=1',
    },
    {
      entity: 'runs',
      filters: { is_completed: false },
      query: 'get_runs/5&is_completed=0&include_plan_runs=1',
    },
    {
      entity: 'plans',
      filters: { milestone_id: 50, is_completed: false, created_after: '2026-05-01' },
      query: 'get_plans/5&milestone_id=50&is_completed=0&created_after=1777593600',
    },
    { entity: 'milestones', filters: { is_completed: true }, query: 'get_milestones/5&is_completed=1' },
    { entity: 'milestones', filters: { is_completed: false }, query: 'get_milestones/5&is_completed=0' },
  ] as const)('sends $entity filters $filters', async ({ entity, filters, query }) => {
    const fake = fakeTestRail(ROUTES);
    cleanup = fake.restore;

    await search({ entity, project_id: 5, ...filters, limit: 50 }, { client: fake.client, meta: FAKE_META });

    expect(searchCalls(entity, fake.calls)).toEqual([`${query}&limit=50`]);
  });

  it('filters tests by status in the request', async ({ task }) => {
    story.init(task, { tags: ['search', 'tests', 'filters'] });
    const fake = fakeTestRail(ROUTES);
    cleanup = fake.restore;

    await search(
      { entity: 'tests', run_id: 600, status_id: [4, 5], limit: 50 },
      { client: fake.client, meta: FAKE_META },
    );

    expect(fake.calls).toEqual(['get_tests/600&status_id=4,5&limit=50']);
  });
});

describe('Finding cases by section path', () => {
  const TREE = [
    { id: 1, name: 'Checkout', parent_id: null },
    { id: 2, name: 'Payments', parent_id: 1 },
    { id: 3, name: 'Cards', parent_id: 2 },
    { id: 4, name: 'Account', parent_id: null },
    { id: 5, name: 'Payments', parent_id: 4 },
  ];

  const routes = (suites: { id: number; name: string }[]) => ({
    'get_suites/5': page('suites', suites),
    'get_sections/5': page('sections', TREE),
    'get_cases/5': page('cases', CASE_ROWS),
  });

  it('lists a section by its path instead of its id', async ({ task }) => {
    story.init(task, { tags: ['search', 'cases', 'sections'], covers: ['src/analysis/search.ts'] });

    story.given('a single-suite project with Checkout > Payments > Cards');
    const fake = fakeTestRail(routes([{ id: 7, name: 'Master' }]));
    cleanup = fake.restore;

    story.when("cases are searched with section_path 'checkout > payments > cards'");
    await search(
      { entity: 'cases', project_id: 5, section_path: 'checkout > payments > cards' },
      { client: fake.client, meta: FAKE_META },
    );

    story.then('the path resolves to section 3, matched without case');
    expect(fake.calls).toContain('get_cases/5&section_id=3&limit=50');
  });

  it('accepts a trailing part of the path when it names one section', async () => {
    const fake = fakeTestRail(routes([{ id: 7, name: 'Master' }]));
    cleanup = fake.restore;

    await search(
      { entity: 'cases', project_id: 5, section_path: 'Cards' },
      { client: fake.client, meta: FAKE_META },
    );

    expect(fake.calls).toContain('get_cases/5&section_id=3&limit=50');
  });

  it('lists the candidates when a path is ambiguous or unknown', async () => {
    const fake = fakeTestRail(routes([{ id: 7, name: 'Master' }]));
    cleanup = fake.restore;

    await expect(
      search(
        { entity: 'cases', project_id: 5, section_path: 'Payments' },
        { client: fake.client, meta: FAKE_META },
      ),
    ).rejects.toThrow(
      "'Payments' matches 2 sections in project 5; give more of the path.\n  2: Checkout > Payments\n  5: Account > Payments",
    );

    await expect(
      search(
        { entity: 'cases', project_id: 5, section_path: 'Card' },
        { client: fake.client, meta: FAKE_META },
      ),
    ).rejects.toThrow("No section 'Card' in project 5.\nSimilar:\n  3: Checkout > Payments > Cards");
    expect(fake.calls.some((call) => call.startsWith('get_cases'))).toBe(false);
  });

  it('starts the path with the suite name when the project has several suites', async ({ task }) => {
    story.init(task, { tags: ['search', 'cases', 'sections'] });

    const suites = [
      { id: 7, name: 'Regression' },
      { id: 8, name: 'Smoke' },
    ];

    const fake = fakeTestRail({ ...routes(suites), 'get_sections/5&suite_id=8': page('sections', TREE) });
    cleanup = fake.restore;

    await search(
      { entity: 'cases', project_id: 5, section_path: 'Smoke > Checkout > Payments' },
      { client: fake.client, meta: FAKE_META },
    );

    story.then("the suite's own section tree is read, and the case search stays in that section");
    expect(fake.calls).toContain('get_sections/5&suite_id=8&limit=250');
    expect(fake.calls).toContain('get_cases/5&section_id=2&limit=50');

    await expect(
      search(
        { entity: 'cases', project_id: 5, section_path: 'Checkout > Payments' },
        { client: fake.client, meta: FAKE_META },
      ),
    ).rejects.toThrow('Project 5 has 2 suites; start section_path with one of them');
  });
});

describe('Search that needs an id it was not given', () => {
  it.each(['suites', 'sections', 'cases', 'runs', 'plans', 'milestones'] as const)(
    'refuses %s without a project_id, before any request',
    async (entity) => {
      const fake = fakeTestRail(ROUTES);
      cleanup = fake.restore;

      await expect(search({ entity, limit: 50 }, { client: fake.client })).rejects.toThrow(
        `entity '${entity}' needs a project_id. Search entity:'projects' first.`,
      );
      expect(fake.calls).toEqual([]);
    },
  );

  it('refuses tests without a run_id, before any request', async ({ task }) => {
    story.init(task, { tags: ['search', 'validation'] });
    const fake = fakeTestRail(ROUTES);
    cleanup = fake.restore;

    await expect(
      search({ entity: 'tests', project_id: 5, limit: 50 }, { client: fake.client }),
    ).rejects.toThrow("entity 'tests' needs a run_id. Search entity:'runs' first.");
    expect(fake.calls).toEqual([]);
  });
});

describe('Capped searches', () => {
  it.each([
    {
      entity: 'suites',
      ids: { project_id: 5 },
      route: 'get_suites',
      collection: 'suites',
      rows: SUITE_ROWS.slice(0, 1),
    },
    {
      entity: 'sections',
      ids: { project_id: 5 },
      route: 'get_sections',
      collection: 'sections',
      rows: SECTION_ROWS.slice(0, 1),
    },
    {
      entity: 'plans',
      ids: { project_id: 5 },
      route: 'get_plans',
      collection: 'plans',
      rows: PLAN_ROWS.slice(0, 1),
    },
    {
      entity: 'milestones',
      ids: { project_id: 5 },
      route: 'get_milestones',
      collection: 'milestones',
      rows: MILESTONE_ROWS.slice(0, 1),
    },
    {
      entity: 'tests',
      ids: { run_id: 600 },
      route: 'get_tests',
      collection: 'tests',
      rows: TEST_ROWS.slice(0, 1),
    },
  ] as const)('says when a $entity search was capped', async ({ entity, ids, route, collection, rows }) => {
    const fake = fakeTestRail({ [route]: page<Json>(collection, rows, `/api/v2/${route}/x&offset=1`) });
    cleanup = fake.restore;

    const result = await search({ entity, ...ids, limit: 1 }, { client: fake.client, meta: FAKE_META });

    expect(result.complete).toBe(false);
    expect(result.warnings).toEqual(['Capped at 1 source rows — raise the limit to search the remainder.']);
    expect(formatSearch(result)).toContain('> ⚠ Capped at 1 source rows');
  });

  it('tells a capped case search to narrow the filters', async ({ task }) => {
    story.init(task, { tags: ['search', 'cases', 'pagination'] });

    const fake = fakeTestRail({
      get_cases: page('cases', CASE_ROWS.slice(0, 1), '/api/v2/get_cases/5&offset=1'),
    });

    cleanup = fake.restore;

    const result = await search(
      { entity: 'cases', project_id: 5, limit: 1 },
      { client: fake.client, meta: FAKE_META },
    );

    expect(result.warnings).toEqual(['Capped at 1 rows — narrow the filters or raise the limit.']);
  });

  it('renders an empty result as none', async ({ task }) => {
    story.init(task, { tags: ['search'] });
    const fake = fakeTestRail({ get_plans: page('plans', []) });
    cleanup = fake.restore;

    const result = await search(
      { entity: 'plans', project_id: 5, limit: 50 },
      { client: fake.client, meta: FAKE_META },
    );

    expect(formatSearch(result)).toBe('## Test plans (0)\n\n_(none)_');
  });
});
