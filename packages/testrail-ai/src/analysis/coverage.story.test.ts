import { story } from 'executable-stories-vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { FAKE_META, fakeTestRail, page } from '../test-support';
import { formatCoverage, getCoverage } from './coverage';

/**
 * Three gaps kept apart: cases with no requirement, cases that never run, and
 * requirements with no case. The last is the one TestRail's UI will not show.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const testCase = (id: number, refs: string | null, priority_id = 2, type_id = 1) => ({
  id,
  title: `Case ${id}`,
  refs,
  priority_id,
  type_id,
  updated_on: 1_770_000_000,
});

const CASES = [
  testCase(1, 'JIRA-1, JIRA-2', 4),
  testCase(2, 'jira-3'),
  testCase(3, null),
  testCase(4, '  ', 2, 7),
];

describe('Finding coverage gaps', () => {
  it('separates unreferenced cases, uncovered requirements and never-executed cases', async ({ task }) => {
    story.init(task, { tags: ['coverage'], covers: ['src/analysis/coverage.ts'] });

    story.given('four cases, two with requirement refs, and two recent runs');

    const fake = fakeTestRail({
      'get_cases/5&suite_id=20': page('cases', CASES),
      'get_plans/5': page('plans', []),
      'get_runs/5&suite_id=20': page('runs', [{ id: 1 }, { id: 2 }]),
      // Case 2 is in a run but untested — that is not execution.
      'get_tests/1': page('tests', [
        { id: 11, case_id: 1, status_id: 1 },
        { id: 12, case_id: 2, status_id: 3 },
      ]),
      'get_tests/2': page('tests', [{ id: 21, case_id: 3, status_id: 5 }]),
    });

    cleanup = fake.restore;

    story.when('coverage is checked against three named requirements, matched case-insensitively');

    const report = await getCoverage(
      { project_id: 5, suite_id: 20, recent_runs: 2, refs: ['JIRA-2', 'JIRA-3', 'JIRA-9'], limit: 500 },
      { client: fake.client, meta: FAKE_META },
    );

    story.then('only JIRA-9 has no covering case');
    expect(report.uncoveredRefs).toEqual(['JIRA-9']);
    expect(report.namedRefCount).toBe(3);

    story.and('blank refs count as unreferenced');
    expect(report.unreferenced.map((row) => row.caseId)).toEqual([3, 4]);

    story.and('an untested result is not execution');
    expect(report.neverExecuted).toEqual({
      runsChecked: 2,
      cases: [
        { caseId: 2, title: 'Case 2', priority: 'Medium', updated: '2026-02-02' },
        { caseId: 4, title: 'Case 4', priority: 'Medium', updated: '2026-02-02' },
      ],
    });

    story.and('distribution is sorted by count');
    expect(report.byPriority).toEqual([
      { name: 'Medium', count: 3 },
      { name: 'Critical', count: 1 },
    ]);
    expect(report.byType).toEqual([
      { name: 'type:1', count: 3 },
      { name: 'type:7', count: 1 },
    ]);
    expect(report.runGaps).toBeNull();
    expect(report.warnings).toEqual([]);

    const markdown = formatCoverage(report);
    story.code({ label: 'Rendered', content: markdown, lang: 'markdown' });
    expect(markdown).toContain('## Requirements with no covering case (1 of 3)');
    expect(markdown).toContain('- JIRA-9');
    expect(markdown).toContain('## Never executed in the last 2 runs (2 of 4)');
    expect(markdown).not.toContain('gaps');
  });

  it('reports what a run skipped, and skips the recent-runs walk when asked', async ({ task }) => {
    story.init(task, { tags: ['coverage', 'run-gaps'], covers: ['src/analysis/coverage.ts'] });

    story.given('a run containing cases 1 and 2, with 2 still untested');

    const fake = fakeTestRail({
      'get_cases/5': page('cases', CASES),
      'get_run/40': { id: 40, project_id: 5, suite_id: 1 },
      'get_tests/40': page('tests', [
        { id: 1, case_id: 1, title: 'Case 1', status_id: 1 },
        { id: 2, case_id: 2, title: 'Case 2', status_id: 3 },
      ]),
    });

    cleanup = fake.restore;

    story.when('coverage is compared to that run with recent_runs 0');

    const report = await getCoverage(
      { project_id: 5, run_id: 40, recent_runs: 0, limit: 500 },
      { client: fake.client, meta: FAKE_META },
    );

    story.then('cases 3 and 4 are missing from the run and case 2 is untested in it');
    expect(report.runGaps).toEqual({
      runId: 40,
      notInRun: [
        { caseId: 3, title: 'Case 3', priority: 'Medium', updated: '2026-02-02' },
        { caseId: 4, title: 'Case 4', priority: 'Medium', updated: '2026-02-02' },
      ],
      untestedInRun: [{ caseId: 2, title: 'Case 2', priority: '' }],
    });

    story.and('no recent runs were fetched, and no requirement section is rendered');
    expect(report.neverExecuted).toBeNull();
    expect(fake.calls.some((call) => call.startsWith('get_runs'))).toBe(false);
    const markdown = formatCoverage(report);
    expect(markdown).toContain('## Run 40 gaps');
    expect(markdown).toContain('2 suite cases are not in the run; 1 is in it but untested.');
    expect(markdown).toContain('| not in run |');
    expect(markdown).toContain('| untested |');
    expect(markdown).not.toContain('Requirements with no covering case');
    expect(markdown).not.toContain('Never executed');
  });

  it('warns instead of claiming completeness when cases or tests were capped', async ({ task }) => {
    story.init(task, {
      tags: ['coverage', 'pagination', 'regression'],
      covers: ['src/analysis/coverage.ts'],
    });

    story.given('more cases than the limit, and a run and a recent run with more than 2000 tests');

    const bigPage = page(
      'tests',
      Array.from({ length: 2000 }, (_, index) => ({ id: index + 1, case_id: 1, status_id: 1 })),
      '/api/v2/get_tests/9&limit=250&offset=2000',
    );

    const fake = fakeTestRail({
      'get_cases/5': page('cases', CASES, '/api/v2/get_cases/5&limit=2&offset=2'),
      'get_plans/5': page('plans', []),
      'get_runs/5': page('runs', [{ id: 9 }]),
      'get_run/9': { id: 9, project_id: 5, suite_id: null },
      'get_tests/9': bigPage,
    });

    cleanup = fake.restore;

    const report = await getCoverage(
      { project_id: 5, run_id: 9, recent_runs: 1, limit: 2 },
      { client: fake.client, meta: FAKE_META },
    );

    story.then('each cap is named');
    expect(report.complete).toBe(false);
    expect(report.caseCount).toBe(2);
    expect(report.warnings).toEqual([
      'Case list was capped at 2; raise `limit` for the full picture.',
      '1 recent run exceeded 2000 tests; execution coverage may be incomplete.',
      'Run 9 exceeded 2000 tests; run-gap coverage is incomplete.',
    ]);
    const markdown = formatCoverage(report);
    expect(markdown).toContain('> ⚠ 1 recent run exceeded 2000 tests');
    expect(markdown).toContain('> ⚠ Case list was capped at 2');
  });

  it.each([
    {
      run: { id: 70, project_id: 6, suite_id: 1 },
      args: { project_id: 5, run_id: 70 },
      error: 'Run 70 belongs to project 6, not project 5.',
    },
    {
      run: { id: 70, project_id: 5, suite_id: 2 },
      args: { project_id: 5, suite_id: 1, run_id: 70 },
      error: 'Run 70 ran suite 2, not suite 1.',
    },
  ])('refuses a run from elsewhere: $error', async ({ run, args, error }) => {
    const fake = fakeTestRail({
      'get_cases/5': page('cases', CASES),
      'get_run/70': run,
    });

    cleanup = fake.restore;

    await expect(
      getCoverage({ ...args, recent_runs: 0 }, { client: fake.client, meta: FAKE_META }),
    ).rejects.toThrow(error);
    expect(fake.calls.some((call) => call.startsWith('get_tests'))).toBe(false);
  });

  it('says so plainly when there is no gap', async ({ task }) => {
    story.init(task, { tags: ['coverage'], covers: ['src/analysis/coverage.ts'] });

    const fake = fakeTestRail({
      'get_cases/5': page('cases', [testCase(1, 'JIRA-1')]),
      'get_plans/5': page('plans', []),
      'get_runs/5': page('runs', [{ id: 1 }]),
      'get_tests/1': page('tests', [{ id: 1, case_id: 1, status_id: 1 }]),
    });

    cleanup = fake.restore;

    const markdown = formatCoverage(
      await getCoverage(
        { project_id: 5, recent_runs: 5, refs: ['jira-1'], limit: 500 },
        { client: fake.client, meta: FAKE_META },
      ),
    );

    expect(markdown).toContain('_Every case is traceable to a requirement._');
    expect(markdown).toContain('_All named requirements have at least one case._');
    expect(markdown).toContain('_Every case has been executed recently._');
  });

  it('caps long tables and says how many rows it left out', async ({ task }) => {
    story.init(task, { tags: ['coverage', 'format'], covers: ['src/analysis/coverage.ts'] });
    const many = Array.from({ length: 55 }, (_, index) => testCase(index + 1, null));

    const fake = fakeTestRail({
      'get_cases/5': page('cases', many),
      'get_plans/5': page('plans', []),
      'get_runs/5': page('runs', []),
    });

    cleanup = fake.restore;

    const markdown = formatCoverage(
      await getCoverage(
        { project_id: 5, recent_runs: 5, limit: 500 },
        { client: fake.client, meta: FAKE_META },
      ),
    );

    story.then('both the unreferenced and never-executed tables stop at 50');
    expect(markdown.match(/_…and 5 more\._/g)).toHaveLength(2);
  });

  it('refuses a project with no cases, and invalid input before any request', async ({ task }) => {
    story.init(task, { tags: ['coverage', 'validation'], covers: ['src/analysis/coverage.ts'] });
    const empty = fakeTestRail({ 'get_cases/5': page('cases', []) });
    cleanup = empty.restore;

    await expect(
      getCoverage({ project_id: 5, recent_runs: 5, limit: 500 }, { client: empty.client, meta: FAKE_META }),
    ).rejects.toThrow('No cases found in project 5.');

    const untouched = fakeTestRail({});
    await expect(
      getCoverage(
        { project_id: 5, recent_runs: 26, limit: 500 },
        { client: untouched.client, meta: FAKE_META },
      ),
    ).rejects.toThrow(/"recent_runs"/);
    expect(untouched.calls).toEqual([]);
  });
});
