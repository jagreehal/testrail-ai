import { describe, expect, it } from 'vitest';
import { getCoverage } from './analysis/coverage';
import { getRunReport } from './analysis/run-report';
import { getStability } from './analysis/stability';
import { hasRun, isNotPassing, runCounts, statusKind, type StatusKind } from './status';
import { fakeTestRail, page } from './test-support';
import type { Run, Status } from './types';

const status = (id: number, name: string, flags: { is_final: boolean; is_untested: boolean }): Status => ({
  id,
  name,
  label: name,
  ...flags,
});

/** Built-ins as TestRail defines them, plus a final custom status and one flagged untested. */
const STATUSES: Status[] = [
  status(1, 'passed', { is_final: true, is_untested: false }),
  status(2, 'blocked', { is_final: true, is_untested: false }),
  status(3, 'untested', { is_final: false, is_untested: true }),
  status(4, 'retest', { is_final: false, is_untested: false }),
  status(5, 'failed', { is_final: true, is_untested: false }),
  status(6, 'known_issue', { is_final: true, is_untested: false }),
  status(7, 'queued', { is_final: false, is_untested: true }),
  status(8, 'in_review', { is_final: false, is_untested: false }),
];

const BY_ID = new Map(STATUSES.map((row) => [row.id, row]));

describe('statusKind', () => {
  it.each<[number | null, StatusKind]>([
    [1, 'passed'],
    [2, 'unsettled'],
    [3, 'untested'],
    [4, 'unsettled'],
    [5, 'failed'],
    [6, 'failed'],
    [7, 'untested'],
    [8, 'unsettled'],
    [99, 'unsettled'],
    [null, 'untested'],
  ])('status %s is %s', (id, kind) => {
    expect(statusKind(id, BY_ID)).toBe(kind);
  });

  it('keeps built-in meanings even when an instance relabels them', () => {
    const relabelled = new Map([[5, status(5, 'failed', { is_final: false, is_untested: true })]]);
    expect(statusKind(5, relabelled)).toBe('failed');
  });

  it('never calls anything both run and untested, or passed and not passing', () => {
    for (const id of [null, 1, 2, 3, 4, 5, 6, 7, 8, 99]) {
      const kind = statusKind(id, BY_ID);
      expect(hasRun(kind) || kind === 'untested').toBe(true);
      expect(kind === 'passed' && isNotPassing(kind)).toBe(false);
    }
  });
});

describe('runCounts', () => {
  // SAFETY: runCounts reads only the count fields, and this fixture sets every one of them.
  const RUN = {
    passed_count: 4,
    failed_count: 3,
    blocked_count: 2,
    retest_count: 1,
    untested_count: 5,
    custom_status1_count: 6, // id 6: final
    custom_status2_count: 7, // id 7: untested
    custom_status3_count: 8, // id 8: not final
  } as Run;

  it('adds every custom count to exactly one side', () => {
    const counts = runCounts(RUN, BY_ID);
    expect(counts).toMatchObject({ other: 14, untested: 12, executed: 24 });
    expect(counts.total).toBe(4 + 3 + 2 + 1 + 5 + 6 + 7 + 8);
    expect(counts.total).toBe(counts.executed + counts.untested);
  });

  it('counts a custom status the instance no longer lists as run', () => {
    expect(runCounts({ ...RUN, custom_status5_count: 2 }, BY_ID).other).toBe(16);
  });
});

describe('Every tool reads a status the same way', () => {
  /** One test per status id, each on its own case. */
  const TESTS = [1, 2, 3, 4, 5, 6, 7, 8].map((statusId) => ({
    id: 100 + statusId,
    case_id: statusId,
    status_id: statusId,
    title: `Case on status ${statusId}`,
  }));

  const RUN_ROW = {
    id: 1,
    project_id: 5,
    suite_id: 20,
    name: 'Run',
    created_on: 200,
    plan_id: null,
    passed_count: 1,
    failed_count: 1,
    blocked_count: 1,
    retest_count: 1,
    untested_count: 1,
    custom_status1_count: 1,
    custom_status2_count: 1,
    custom_status3_count: 1,
  };

  const ROUTES = {
    get_statuses: STATUSES,
    get_priorities: [{ id: 2, name: 'Medium', short_name: 'Medium' }],
    get_case_types: [{ id: 1, name: 'Other' }],
    get_users: page('users', []),
    'get_run/1': RUN_ROW,
    'get_tests/1': page('tests', TESTS),
    'get_tests/0': page(
      'tests',
      TESTS.map((test) => ({ ...test, id: test.id + 100, status_id: 1 })),
    ),
    get_results_for_run: page('results', []),
    'get_plans/5': page('plans', []),
    'get_runs/5': page('runs', [RUN_ROW, { ...RUN_ROW, id: 0, created_on: 100 }]),
    'get_cases/5': page(
      'cases',
      TESTS.map((test) => ({ id: test.case_id, title: test.title, priority_id: 2, type_id: 1, refs: 'R-1' })),
    ),
  };

  const kindOf = (caseId: number) => statusKind(caseId, BY_ID);

  const casesWhere = (predicate: (kind: StatusKind) => boolean) =>
    TESTS.flatMap((test) => (predicate(kindOf(test.case_id)) ? [test.case_id] : []));

  it('agrees across the run report, coverage and stability', async () => {
    const fake = fakeTestRail(ROUTES);
    const deps = { client: fake.client };

    const report = await getRunReport({ run_id: 1, include_passed: true }, deps);
    const coverage = await getCoverage({ project_id: 5, run_id: 1, recent_runs: 1, limit: 100 }, deps);
    const stability = await getStability({ project_id: 5, runs: 2, min_flips: 2 }, deps);
    fake.restore();

    // The run report: what is not passing, and what passed.
    const reportedFailing = [
      ...report.clusters.flatMap((cluster) => cluster.tests.map((test) => test.caseId)),
      ...report.undocumented.map((test) => test.caseId),
    ].toSorted((a, b) => a - b);

    expect(reportedFailing).toEqual(casesWhere(isNotPassing));
    expect(report.passed.map((test) => test.caseId)).toEqual(casesWhere((kind) => kind === 'passed'));
    expect(report.counts.total).toBe(8);
    expect(report.counts.untested).toBe(casesWhere((kind) => !hasRun(kind)).length);

    // Coverage: what the run left untested, and what never ran recently.
    const untestedInRun = coverage.runGaps!.untestedInRun.map((row) => row.caseId);
    expect(untestedInRun).toEqual(casesWhere((kind) => !hasRun(kind)));
    expect(coverage.neverExecuted!.cases.map((row) => row.caseId)).toEqual(untestedInRun);

    // Stability: every case passed in the earlier run, so each one that failed
    // in the later run regressed, and nothing unsettled or untested moved.
    const regressed = stability.regressed.map((row) => row.caseId).toSorted((a, b) => a - b);
    expect(regressed).toEqual(casesWhere((kind) => kind === 'failed'));
  });
});
