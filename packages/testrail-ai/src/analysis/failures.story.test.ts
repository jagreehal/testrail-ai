import { story } from 'executable-stories-vitest';
import { describe, expect, it } from 'vitest';
import { FAKE_META, fakeTestRail, page } from '../test-support';
import { formatFailures, getFailures } from './failures';

describe('Failure report completeness', () => {
  it('warns when more failures exist than the requested limit', async ({ task }) => {
    story.init(task, {
      tags: ['failures', 'pagination', 'regression'],
      covers: ['src/analysis/failures.ts'],
    });

    const fake = fakeTestRail({
      'get_run/1': {
        id: 1,
        project_id: 5,
        suite_id: 2,
        name: 'Regression',
        created_on: 100,
      },
      'get_tests/1': page(
        'tests',
        [{ id: 10, case_id: 20, title: 'Login', status_id: 5 }],
        '/api/v2/get_tests/1&limit=1&offset=1',
      ),
      'get_results_for_run/1': page('results', []),
    });

    const report = await getFailures(
      { run_id: 1, include_last_good: false, lookback_runs: 10, limit: 1 },
      { client: fake.client, meta: FAKE_META },
    );

    expect(report.complete).toBe(false);
    expect(report.warnings[0]).toMatch(/capped/);
    expect(formatFailures(report)).toContain('⚠');
  });
});

const RUN = { id: 612, project_id: 5, suite_id: 2, name: 'Regression', created_on: 1_700_000_000 };

const FAILING = [
  { id: 10, case_id: 20, title: 'Login', status_id: 5, assignedto_id: 3 },
  { id: 11, case_id: 21, title: 'Logout', status_id: 2, assignedto_id: null },
];

const passing = (caseIds: number[]) =>
  page(
    'tests',
    caseIds.map((caseId) => ({ id: caseId * 10, case_id: caseId, title: 'x', status_id: 1 })),
  );

describe('Failure detail', () => {
  it('carries the latest comment, defects, per-step outcome and attachments for each failure', async ({
    task,
  }) => {
    story.init(task, { tags: ['failures'], covers: ['src/analysis/failures.ts'] });

    story.given('a run with one failure that has a rich result and one with no result at all');

    const fake = fakeTestRail({
      'get_run/612': RUN,
      'get_tests/612': page('tests', FAILING),
      'get_results_for_run/612': page('results', [
        {
          test_id: 10,
          status_id: 5,
          comment: '<p>Timed out &amp; gave up</p>',
          defects: 'CUR-9',
          elapsed: '1m 5s',
          attachment_ids: [1, 2],
          custom_step_results: [
            { content: 'Open page', expected: 'Page loads', status_id: 1 },
            { content: 'Submit', expected: 'Signed in', actual: 'Spinner forever', status_id: 5 },
          ],
        },
        // Older result for the same test: the newest one above must win.
        { test_id: 10, status_id: 1, comment: 'old pass' },
      ]),
    });

    story.when('failures are fetched');

    const report = await getFailures(
      { run_id: 612, include_last_good: false, lookback_runs: 10, limit: 50 },
      { client: fake.client, meta: FAKE_META },
    );

    const markdown = formatFailures(report);
    story.code({ label: 'Rendered', content: markdown, lang: 'markdown' });

    story.then('only failing statuses were asked for');
    expect(fake.calls).toContain('get_tests/612&status_id=2,4,5&limit=50');

    story.and('the newest result supplies the evidence');
    expect(report.failures[0]).toMatchObject({
      caseId: 20,
      status: 'failed',
      assignedTo: 'user:3',
      elapsed: '1m 5s',
      defects: 'CUR-9',
      comment: 'Timed out & gave up',
      failedSteps: [2],
      totalSteps: 2,
      attachmentCount: 2,
      lastGood: null,
    });
    expect(report.failures[1]).toMatchObject({
      caseId: 21,
      status: 'blocked',
      assignedTo: 'unassigned',
      comment: '',
      failedSteps: [],
      totalSteps: 0,
      attachmentCount: 0,
    });
    expect(report.statusNames).toEqual({
      1: 'passed',
      2: 'blocked',
      3: 'untested',
      4: 'retest',
      5: 'failed',
    });
    expect(report.complete).toBe(true);

    story.and('the markdown leads with the failing step and points at the attachments');
    expect(markdown).toContain('# 2 non-passing tests in run 612');
    expect(markdown).toContain('Failed at step 2 of 2.');
    expect(markdown).toContain('Spinner forever');
    expect(markdown).toContain('fetch with `get_attachments_for_test/10`');
    expect(markdown).not.toContain('last passed in');
    story.note('A failure with no comment, steps or attachments gets no evidence block of its own.');
    expect(markdown).not.toContain('**C21');
  });

  it('says plainly when nothing in the run is failing', async ({ task }) => {
    story.init(task, { tags: ['failures'] });

    const fake = fakeTestRail({
      'get_run/612': RUN,
      'get_tests/612': page('tests', []),
      'get_results_for_run/612': page('results', []),
    });

    const report = await getFailures(
      { run_id: 612, include_last_good: false, lookback_runs: 10, limit: 50 },
      { client: fake.client, meta: FAKE_META },
    );

    expect(formatFailures(report)).toBe(
      'Run 612 (Regression) has no failing, blocked or retest tests in the rows inspected.',
    );
  });

  it('warns when the result history was capped, since comments may be missing', async ({ task }) => {
    story.init(task, { tags: ['failures', 'pagination'] });
    const history = Array.from({ length: 1001 }, (_, index) => ({ test_id: 1000 + index, status_id: 1 }));

    const fake = fakeTestRail({
      'get_run/612': RUN,
      'get_tests/612': page('tests', []),
      // A bare array: older TestRail, and more rows than the 1000 read.
      'get_results_for_run/612': history,
    });

    const report = await getFailures(
      { run_id: 612, include_last_good: false, lookback_runs: 10, limit: 50 },
      { client: fake.client, meta: FAKE_META },
    );

    expect(report.warnings).toEqual([
      'Result history was capped at 1000 records; some comments or defect links may be missing.',
    ]);
    expect(formatFailures(report)).toContain(
      '> ⚠ Result history was capped at 1000 records; some comments or defect links may be missing.',
    );
  });
});

describe('Finding the last good run', () => {
  it('walks back through earlier runs of the same suite until each case is seen passing', async ({
    task,
  }) => {
    story.init(task, { tags: ['failures', 'last-good'], covers: ['src/analysis/failures.ts'] });

    story.given('two failures: one passed in the previous run, one never passed in the lookback');

    const fake = fakeTestRail({
      'get_run/612': RUN,
      'get_tests/612': page('tests', FAILING),
      'get_results_for_run/612': page('results', []),
      'get_plans/5': page('plans', []),
      'get_runs/5': page('runs', [
        { id: 611, name: 'Yesterday', created_on: 1_699_913_600 },
        { id: 610, name: 'Day before', created_on: 1_699_827_200 },
      ]),
      'get_tests/611': passing([20]),
      'get_tests/610': passing([99]),
    });

    story.when('failures are fetched with include_last_good');

    const report = await getFailures(
      { run_id: 612, include_last_good: true, lookback_runs: 2, limit: 50 },
      { client: fake.client, meta: FAKE_META },
    );

    const markdown = formatFailures(report);
    story.code({ label: 'Rendered', content: markdown, lang: 'markdown' });

    story.then('only earlier runs of the same suite are searched, bounded by the lookback');
    expect(fake.calls).toContain(
      'get_runs/5&suite_id=2&created_before=1700000000&include_plan_runs=1&limit=2',
    );
    expect(fake.calls).toContain('get_tests/611&status_id=1&limit=250');
    expect(fake.calls).toContain('get_tests/610&status_id=1&limit=250');

    story.and('each failure names the run it last passed in, or says it was not found');
    expect(report.failures[0]?.lastGood).toEqual({ runId: 611, name: 'Yesterday', date: '2023-11-13' });
    expect(report.failures[1]?.lastGood).toBeNull();
    expect(markdown).toContain('last passed in');
    expect(markdown).toContain('run 611 (2023-11-13)');
    expect(markdown).toContain('not in lookback');
  });

  it('only counts a pass under the same configuration as the failing run', async ({ task }) => {
    story.init(task, { tags: ['failures', 'last-good', 'configurations'] });

    story.given('a Chrome run failing C20, which passed on Safari yesterday and on Chrome the day before');

    const fake = fakeTestRail({
      'get_run/612': { ...RUN, plan_id: 40, config: 'Chrome' },
      'get_tests/612': page('tests', FAILING.slice(0, 1)),
      'get_results_for_run/612': page('results', []),
      'get_runs/5': page('runs', [
        { id: 611, name: 'Yesterday', plan_id: 40, config: 'Safari', created_on: 1_699_913_600 },
        { id: 610, name: 'Day before', plan_id: 40, config: 'Chrome', created_on: 1_699_827_200 },
      ]),
      'get_tests/611': passing([20]),
      'get_tests/610': passing([20]),
    });

    const report = await getFailures(
      { run_id: 612, include_last_good: true, lookback_runs: 2 },
      { client: fake.client, meta: FAKE_META },
    );

    story.then('the last good run is the Chrome one');
    expect(report.failures[0]?.lastGood).toEqual({ runId: 610, name: 'Day before', date: '2023-11-12' });
    expect(fake.calls).not.toContain('get_tests/611&status_id=1&limit=250');
  });

  it('stops walking back as soon as every failure has been placed', async ({ task }) => {
    story.init(task, { tags: ['failures', 'last-good', 'performance'] });

    const fake = fakeTestRail({
      'get_run/612': { ...RUN, suite_id: null },
      'get_tests/612': page('tests', FAILING),
      'get_results_for_run/612': page('results', []),
      'get_plans/5': page('plans', []),
      'get_runs/5': page('runs', [
        { id: 611, name: 'Yesterday', created_on: 1_699_913_600 },
        { id: 610, name: 'Day before', created_on: 1_699_827_200 },
      ]),
      'get_tests/611': passing([20, 21]),
      'get_tests/610': passing([20, 21]),
    });

    await getFailures(
      { run_id: 612, include_last_good: true, lookback_runs: 10, limit: 50 },
      { client: fake.client, meta: FAKE_META },
    );

    story.then('a run without a suite searches the whole project, and the second run is never fetched');
    expect(fake.calls).toContain('get_runs/5&created_before=1700000000&include_plan_runs=1&limit=10');
    expect(
      fake.calls.filter(
        (call) => call.startsWith('get_tests/61') && call !== 'get_tests/612&status_id=2,4,5&limit=50',
      ),
    ).toEqual(['get_tests/611&status_id=1&limit=250']);
  });

  it('warns when a lookback run had more passing tests than it could read', async ({ task }) => {
    story.init(task, { tags: ['failures', 'last-good', 'pagination'] });

    const fake = fakeTestRail({
      'get_run/612': RUN,
      'get_tests/612': page('tests', FAILING),
      'get_results_for_run/612': page('results', []),
      'get_plans/5': page('plans', []),
      'get_runs/5': page('runs', [{ id: 611, name: 'Huge', created_on: 1_699_913_600 }]),
      'get_tests/611': Array.from({ length: 1001 }, (_, index) => ({
        id: index,
        case_id: 5000 + index,
        title: 'x',
        status_id: 1,
      })),
    });

    const report = await getFailures(
      { run_id: 612, include_last_good: true, lookback_runs: 1, limit: 50 },
      { client: fake.client, meta: FAKE_META },
    );

    expect(report.complete).toBe(false);
    expect(report.warnings).toEqual([
      '1 lookback run exceeded 1000 passing tests; last-good matches may be missing.',
    ]);
  });
});
