import { story } from 'executable-stories-vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { FAKE_META, fakeTestRail, page } from '../test-support';
import { formatRunReport, getRunReport } from './run-report';

/**
 * The flagship read. Its job is to turn a wall of failures into a short list of
 * causes — and, just as importantly, to be honest when it cannot.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const RUN = {
  id: 612,
  project_id: 5,
  name: 'Manual Regression',
  description: null,
  suite_id: 20,
  milestone_id: null,
  is_completed: false,
  completed_on: null,
  created_on: 1_770_000_000,
  created_by: 16,
  config: null,
  passed_count: 3,
  failed_count: 3,
  blocked_count: 1,
  untested_count: 0,
  retest_count: 0,
};

describe('Reporting on a run', () => {
  it('warns when the test list is capped instead of claiming a complete report', async ({ task }) => {
    story.init(task, { tags: ['run-report', 'pagination', 'regression'] });

    const fake = fakeTestRail(
      {
        'get_run/612': RUN,
        'get_tests/612': page(
          'tests',
          Array.from({ length: 4 }, (_, index) => ({
            id: index + 1,
            case_id: index + 1,
            title: `Case ${index + 1}`,
            status_id: 1,
          })),
          '/api/v2/get_tests/612&limit=4&offset=4',
        ),
        'get_results_for_run/612': page('results', []),
      },
      { maxRows: 1 },
    );

    cleanup = fake.restore;

    const report = await getRunReport(
      { run_id: 612, include_passed: false },
      { client: fake.client, meta: FAKE_META },
    );

    expect(report.complete).toBe(false);
    expect(report.warnings[0]).toMatch(/capped/);
    expect(formatRunReport(report)).toContain('⚠');
  });

  it('groups failures sharing a cause into one cluster', async ({ task }) => {
    story.init(task, { tags: ['run-report'], covers: ['src/analysis/run-report.ts'] });

    story.given('a run where three tests failed with the same timeout, differing only in duration');

    const fake = fakeTestRail({
      'get_run/612': RUN,
      'get_tests/612': page('tests', [
        { id: 1, case_id: 101, title: 'Login', status_id: 5 },
        { id: 2, case_id: 102, title: 'Checkout', status_id: 5 },
        { id: 3, case_id: 103, title: 'Search', status_id: 5 },
        { id: 4, case_id: 104, title: 'Profile', status_id: 1 },
      ]),
      'get_results_for_run/612': page('results', [
        { id: 1, test_id: 1, status_id: 5, comment: 'Timeout after 30000ms', defects: 'CUR-1' },
        { id: 2, test_id: 2, status_id: 5, comment: 'Timeout after 45000ms', defects: '' },
        { id: 3, test_id: 3, status_id: 5, comment: 'Timeout after 51000ms', defects: '' },
      ]),
    });

    cleanup = fake.restore;

    story.when('the run is reported on');

    const report = await getRunReport(
      { run_id: 612, include_passed: false },
      { client: fake.client, meta: FAKE_META },
    );

    story.json({
      label: 'Clusters',
      value: report.clusters.map((c) => ({ signature: c.signature, size: c.tests.length })),
    });

    story.then('one cluster is reported, not three separate failures');
    story.note('Three tests, one bug. This is the difference between a readable report and a wall of noise.');
    expect(report.clusters).toHaveLength(1);
    expect(report.clusters[0]?.tests).toHaveLength(3);

    story.and('a sample comment is carried so the reader sees the real message');
    expect(report.clusters[0]?.sampleComment).toContain('Timeout after 30000ms');
  });

  it('keeps genuinely different failures in separate clusters', async ({ task }) => {
    story.init(task, { tags: ['run-report'] });

    story.given('two failures with unrelated causes');

    const fake = fakeTestRail({
      'get_run/612': RUN,
      'get_tests/612': page('tests', [
        { id: 1, case_id: 101, title: 'Login', status_id: 5 },
        { id: 2, case_id: 102, title: 'Checkout', status_id: 5 },
      ]),
      'get_results_for_run/612': page('results', [
        { id: 1, test_id: 1, status_id: 5, comment: 'Timeout after 30000ms' },
        { id: 2, test_id: 2, status_id: 5, comment: 'Element not found: #submit' },
      ]),
    });

    cleanup = fake.restore;

    story.when('the run is reported on');

    const report = await getRunReport(
      { run_id: 612, include_passed: false },
      { client: fake.client, meta: FAKE_META },
    );

    story.then('they stay apart');
    expect(report.clusters).toHaveLength(2);
  });

  it('separates unexplained failures instead of lumping them into one fake cluster', async ({ task }) => {
    story.init(task, { tags: ['run-report'], covers: ['src/analysis/run-report.ts'] });

    story.given('a run where most non-passing tests have no result comment');
    story.note(
      'On a real 986-test run this was 46 of 58 failures. Clustering them produced one meaningless ' +
        'group that buried the seven real clusters.',
    );

    const fake = fakeTestRail({
      'get_run/612': RUN,
      'get_tests/612': page('tests', [
        { id: 1, case_id: 101, title: 'Login', status_id: 5 },
        { id: 2, case_id: 102, title: 'Checkout', status_id: 5 },
        { id: 3, case_id: 103, title: 'Search', status_id: 2 },
      ]),
      'get_results_for_run/612': page('results', [
        { id: 1, test_id: 1, status_id: 5, comment: 'Timeout after 30000ms' },
      ]),
    });

    cleanup = fake.restore;

    story.when('the run is reported on');

    const report = await getRunReport(
      { run_id: 612, include_passed: false },
      { client: fake.client, meta: FAKE_META },
    );

    story.then('only the explained failure forms a cluster');
    expect(report.clusters).toHaveLength(1);

    story.and('the unexplained ones are reported separately');
    expect(report.undocumented.map((row) => row.caseId)).toEqual([102, 103]);

    story.when('the report is rendered');
    const text = formatRunReport(report);
    story.code({ label: 'Output', content: text, lang: 'markdown' });

    story.then('the gap is named as a gap in the record, not as a cause');
    expect(text).toContain('## No result comment (2 of 3 non-passing)');
    expect(text).toContain('nothing to diagnose from TestRail alone');
  });
});

describe('Pass rate arithmetic', () => {
  it('measures against what actually ran, not what was planned', async ({ task }) => {
    story.init(task, { tags: ['run-report'], covers: ['src/analysis/run-report.ts'] });

    story.given('an in-progress run: 4 passed, 1 failed, and 95 still untested');
    story.table({
      label: 'Counts',
      columns: ['passed', 'failed', 'untested'],
      rows: [['4', '1', '95']],
    });

    const fake = fakeTestRail({
      'get_run/608': {
        ...RUN,
        id: 608,
        passed_count: 4,
        failed_count: 1,
        blocked_count: 0,
        untested_count: 95,
      },
      'get_tests/608': page('tests', []),
      'get_results_for_run/608': page('results', []),
    });

    cleanup = fake.restore;

    story.when('the pass rate is calculated');

    const report = await getRunReport(
      { run_id: 608, include_passed: false },
      { client: fake.client, meta: FAKE_META },
    );

    story.kv({ label: 'Pass rate', value: `${report.passRate?.toFixed(1)}%` });

    story.then('it is 80% — four of the five tests that ran');
    story.note(
      'Counting untested as failures would show 4%, making an in-progress run look catastrophic. ' +
        'Counting them as passes would hide the failure entirely.',
    );
    expect(report.passRate).toBeCloseTo(80);

    story.and('the untested tests are still reported in the totals');
    expect(report.counts.untested).toBe(95);
    expect(report.counts.total).toBe(100);
  });

  it('reports no pass rate at all when nothing has run', async ({ task }) => {
    story.init(task, { tags: ['run-report', 'edge-case'] });

    story.given('a run where every test is untested');

    const fake = fakeTestRail({
      'get_run/609': {
        ...RUN,
        id: 609,
        passed_count: 0,
        failed_count: 0,
        blocked_count: 0,
        retest_count: 0,
        untested_count: 10,
      },
      'get_tests/609': page('tests', []),
      'get_results_for_run/609': page('results', []),
    });

    cleanup = fake.restore;

    story.when('the run is reported on');

    const report = await getRunReport(
      { run_id: 609, include_passed: false },
      { client: fake.client, meta: FAKE_META },
    );

    story.then('the pass rate is null rather than a misleading 0%');
    expect(report.passRate).toBeNull();

    story.and('the rendered report shows a dash');
    expect(formatRunReport(report)).toContain('— passing');
  });

  it('counts tests on a custom status in the totals and the pass rate', async ({ task }) => {
    story.init(task, { tags: ['run-report', 'custom-status'], covers: ['src/analysis/run-report.ts'] });

    story.given('one test passed, one on a custom status, one on a custom status that means not yet run');

    const statuses: [
      number,
      { id: number; name: string; label: string; is_final: boolean; is_untested: boolean },
    ][] = [
      [6, { id: 6, name: 'custom_status1', label: 'Deferred', is_final: true, is_untested: false }],
      [7, { id: 7, name: 'custom_status2', label: 'Queued', is_final: false, is_untested: true }],
    ];

    const meta = { ...FAKE_META, statuses: new Map(statuses) };

    const fake = fakeTestRail({
      'get_run/610': {
        ...RUN,
        id: 610,
        passed_count: 1,
        failed_count: 0,
        blocked_count: 0,
        retest_count: 0,
        untested_count: 0,
        custom_status1_count: 1,
        custom_status2_count: 1,
      },
      'get_tests/610': page('tests', []),
      'get_results_for_run/610': page('results', []),
    });

    cleanup = fake.restore;

    story.when('the run is reported on');
    const report = await getRunReport({ run_id: 610, include_passed: false }, { client: fake.client, meta });

    story.then('three tests in total, and half of those that ran passed');
    expect(report.counts).toMatchObject({ passed: 1, other: 1, untested: 1, total: 3 });
    expect(report.passRate).toBe(50);
    expect(formatRunReport(report)).toContain('1 other, 1 untested (3 total)');
  });
});

describe('Choosing which run to report on', () => {
  it('falls back to the latest run in a project when no run is named', async ({ task }) => {
    story.init(task, { tags: ['run-report'] });

    story.given('a project whose most recent run is 612');

    const fake = fakeTestRail({
      'get_plans/5': page('plans', []),
      'get_runs/5': page('runs', [RUN]),
      'get_tests/612': page('tests', []),
      'get_results_for_run/612': page('results', []),
    });

    cleanup = fake.restore;

    story.when('a report is asked for by project alone');

    const report = await getRunReport(
      { project_id: 5, include_passed: false },
      { client: fake.client, meta: FAKE_META },
    );

    story.then('the latest run is used');
    expect(report.runId).toBe(612);
  });

  it('asks for one or the other rather than guessing', async ({ task }) => {
    story.init(task, { tags: ['run-report', 'edge-case'] });
    story.given('neither a run id nor a project id');
    const fake = fakeTestRail({});
    cleanup = fake.restore;

    story.when('a report is requested');
    story.then('it explains what is missing');
    await expect(
      getRunReport({ include_passed: false }, { client: fake.client, meta: FAKE_META }),
    ).rejects.toThrow(/run_id.*or a project_id/i);
  });
});

describe('Rendering the report', () => {
  it('produces markdown that renders — headings and tables keep their blank lines', async ({ task }) => {
    story.init(task, { tags: ['run-report', 'formatting'] });

    story.given('a report with a heading followed by a table');
    story.note('An earlier version stripped every blank line, which silently broke all markdown rendering.');

    const fake = fakeTestRail({
      'get_run/612': RUN,
      'get_tests/612': page('tests', [{ id: 1, case_id: 101, title: 'Login', status_id: 1 }]),
      'get_results_for_run/612': page('results', []),
    });

    cleanup = fake.restore;

    story.when('the report is rendered');

    const text = formatRunReport(
      await getRunReport({ run_id: 612, include_passed: false }, { client: fake.client, meta: FAKE_META }),
    );

    story.code({ label: 'Output', content: text, lang: 'markdown' });

    story.then('a blank line separates the heading from its table');
    expect(text).toContain('## Status breakdown\n\n|');

    story.and('the run link is present for a human to verify against');
    expect(text).toContain('https://example.testrail.io/index.php?/runs/view/612');
  });
});
