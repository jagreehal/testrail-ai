import { story } from 'executable-stories-vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { FAKE_META, fakeTestRail, page } from '../test-support';
import { classifyStates, formatStability, getStability } from './stability';

/**
 * The distinction this file exists to protect: a test that failed once and
 * stayed failed is a REGRESSION, not a flake. An earlier version reported all 30
 * regressions in a real project as "flaky", which is exactly how genuine
 * breakage gets waved away as noise.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe('Test stability classification', () => {
  it('treats a single pass-to-fail transition as a regression, not flakiness', ({ task }) => {
    story.init(task, { tags: ['stability'], covers: ['src/analysis/stability.ts'] });

    story.given('a case that passed in one run and failed in the next');
    const states = [{ kind: 'passed' as const }, { kind: 'failed' as const }];
    story.state({ label: 'Timeline', value: '.X' });

    story.when('its history is classified');
    const result = classifyStates(states);
    story.json({ label: 'Classification', value: result });

    story.then('exactly one transition is counted');
    expect(result.flips).toBe(1);

    story.and('the case is recorded as ending in a failed state');
    expect(result.endedFailing).toBe(true);

    story.but('one transition is below the flaky threshold of two');
    expect(result.flips).toBeLessThan(2);
  });

  it('treats a single fail-to-pass transition as a recovery', ({ task }) => {
    story.init(task, { tags: ['stability'] });

    story.given('a case that failed and then passed');
    story.when('its history is classified');
    const result = classifyStates([{ kind: 'failed' }, { kind: 'passed' }]);

    story.then('one transition is counted, ending in a passing state');
    expect(result.flips).toBe(1);
    expect(result.endedFailing).toBe(false);
  });

  it('requires genuine alternation before calling a case flaky', ({ task }) => {
    story.init(task, { tags: ['stability'] });

    story.given('a case that passed, failed, then passed again');
    story.when('its history is classified');
    const result = classifyStates([{ kind: 'passed' }, { kind: 'failed' }, { kind: 'passed' }]);
    story.json({ label: 'Classification', value: result });

    story.then('two transitions are counted across three settled runs');
    expect(result.flips).toBe(2);
    expect(result.runs).toBe(3);

    story.and('that is what qualifies it as flaky rather than regressed');
    expect(result.flips).toBeGreaterThanOrEqual(2);
  });

  it('does not count untested, blocked or retest runs as instability', ({ task }) => {
    story.init(task, { tags: ['stability'] });

    story.given('a case that passed, was skipped three times, then passed again');
    story.note('Untested/blocked/retest mean "we do not know yet", not "it failed".');

    story.when('its history is classified');

    const result = classifyStates([
      { kind: 'passed' },
      { kind: 'untested' },
      { kind: 'unsettled' },
      { kind: 'unsettled' },
      { kind: 'passed' },
    ]);

    story.then('no transitions are counted');
    expect(result.flips).toBe(0);

    story.and('only the two settled runs are considered');
    expect(result.runs).toBe(2);

    story.but('none of the unsettled runs are counted as failures');
    expect(result.failures).toBe(0);
  });

  it('reports a consistently failing case as broken, not flaky', ({ task }) => {
    story.init(task, { tags: ['stability'] });

    story.given('a case that failed in all three runs');
    story.when('its history is classified');
    const result = classifyStates([{ kind: 'failed' }, { kind: 'failed' }, { kind: 'failed' }]);

    story.then('there are no transitions, so it is not flaky');
    expect(result.flips).toBe(0);

    story.and('all three runs are recorded as failures');
    expect(result.failures).toBe(3);
  });

  it('handles a case with no history at all', ({ task }) => {
    story.init(task, { tags: ['stability', 'edge-case'] });

    story.given('a case that has never appeared in a run');
    story.when('its history is classified');
    story.then('every count is zero and nothing throws');
    expect(classifyStates([])).toEqual({ flips: 0, runs: 0, failures: 0, endedFailing: false });
  });
});

describe('Stability report over a project', () => {
  it('separates flaky, regressed and recovered cases in one pass', async ({ task }) => {
    story.init(task, { tags: ['stability'], covers: ['src/analysis/stability.ts'] });

    story.given('a project with three runs and three cases behaving differently');
    story.table({
      label: 'Expected behaviour',
      columns: ['Case', 'Run 1', 'Run 2', 'Run 3', 'Verdict'],
      rows: [
        ['10 Login', 'pass', 'fail', 'pass', 'flaky — alternates'],
        ['20 Checkout', 'pass', 'pass', 'fail', 'regressed — broke and stayed broken'],
        ['30 Search', 'fail', 'fail', 'pass', 'recovered — fixed'],
      ],
    });

    const fake = fakeTestRail({
      'get_plans/5': page('plans', []),
      'get_runs/5': page('runs', [
        { id: 3, created_on: 300 },
        { id: 2, created_on: 200 },
        { id: 1, created_on: 100 },
      ]),
      'get_tests/1': page('tests', [
        { id: 1, case_id: 10, title: 'Login', status_id: 1 },
        { id: 2, case_id: 20, title: 'Checkout', status_id: 1 },
        { id: 3, case_id: 30, title: 'Search', status_id: 5 },
      ]),
      'get_tests/2': page('tests', [
        { id: 4, case_id: 10, title: 'Login', status_id: 5 },
        { id: 5, case_id: 20, title: 'Checkout', status_id: 1 },
        { id: 6, case_id: 30, title: 'Search', status_id: 5 },
      ]),
      'get_tests/3': page('tests', [
        { id: 7, case_id: 10, title: 'Login', status_id: 1 },
        { id: 8, case_id: 20, title: 'Checkout', status_id: 5 },
        { id: 9, case_id: 30, title: 'Search', status_id: 1 },
      ]),
    });

    cleanup = fake.restore;

    story.when('stability is analysed across those runs');

    const report = await getStability(
      {
        project_id: 5,
        runs: 3,
        min_flips: 2,
      },
      { client: fake.client, meta: FAKE_META },
    );

    story.json({
      label: 'Verdicts',
      value: {
        flaky: report.flaky.map((r) => r.caseId),
        regressed: report.regressed.map((r) => r.caseId),
        recovered: report.recovered.map((r) => r.caseId),
      },
    });

    story.then('only the alternating case is reported as flaky');
    expect(report.flaky.map((row) => row.caseId)).toEqual([10]);

    story.and('the case that broke and stayed broken is reported as regressed');
    expect(report.regressed.map((row) => row.caseId)).toEqual([20]);

    story.and('the case that was fixed is reported as recovered');
    expect(report.recovered.map((row) => row.caseId)).toEqual([30]);

    story.and('the timeline reads oldest to newest');
    expect(report.flaky[0]?.timeline).toBe('.X.');
  });

  it('says so plainly when nothing changed state', async ({ task }) => {
    story.init(task, { tags: ['stability'] });

    story.given('a project where every case passed in both runs');

    const fake = fakeTestRail({
      'get_plans/5': page('plans', []),
      'get_runs/5': page('runs', [
        { id: 2, created_on: 200 },
        { id: 1, created_on: 100 },
      ]),
      'get_tests/': page('tests', [{ id: 1, case_id: 10, title: 'Login', status_id: 1 }]),
    });

    cleanup = fake.restore;

    story.when('stability is analysed and formatted');

    const report = await getStability(
      { project_id: 5, runs: 2, min_flips: 2 },
      { client: fake.client, meta: FAKE_META },
    );

    const text = formatStability(report);

    story.then('all three buckets are empty');
    expect(report.flaky).toHaveLength(0);
    expect(report.regressed).toHaveLength(0);
    expect(report.recovered).toHaveLength(0);

    story.and('the report says nothing changed rather than printing empty tables');
    story.code({ label: 'Output', content: text, lang: 'markdown' });
    expect(text).toContain('No case changed pass↔fail state');
  });

  it('keeps each configuration to its own history', async ({ task }) => {
    story.init(task, { tags: ['stability', 'configurations'] });

    story.given('one case passing on Chrome, failing on Safari, then passing on Chrome');

    const fake = fakeTestRail({
      'get_runs/5': page('runs', [
        { id: 3, plan_id: 40, config: 'Chrome', created_on: 300 },
        { id: 2, plan_id: 40, config: 'Safari', created_on: 200 },
        { id: 1, plan_id: 40, config: 'Chrome', created_on: 100 },
      ]),
      'get_tests/1': page('tests', [{ id: 11, case_id: 10, title: 'Login', status_id: 1 }]),
      'get_tests/2': page('tests', [{ id: 21, case_id: 10, title: 'Login', status_id: 5 }]),
      'get_tests/3': page('tests', [{ id: 31, case_id: 10, title: 'Login', status_id: 1 }]),
    });

    cleanup = fake.restore;

    const report = await getStability({ project_id: 5, runs: 3 }, { client: fake.client, meta: FAKE_META });

    story.then('a browser difference is not reported as flakiness');
    expect(report.flaky).toEqual([]);
    expect(report.regressed).toEqual([]);
    expect(report.complete).toBe(true);
    story.code({ label: 'Output', content: formatStability(report), lang: 'markdown' });
  });

  it('does not claim nothing changed when a case alternated below the threshold', async ({ task }) => {
    story.init(task, { tags: ['stability'] });

    story.given('a case that went pass, fail, pass, with min_flips 3');

    const fake = fakeTestRail({
      'get_plans/5': page('plans', []),
      'get_runs/5': page('runs', [
        { id: 3, created_on: 300 },
        { id: 2, created_on: 200 },
        { id: 1, created_on: 100 },
      ]),
      'get_tests/1': page('tests', [{ id: 11, case_id: 10, title: 'Login', status_id: 1 }]),
      'get_tests/2': page('tests', [{ id: 21, case_id: 10, title: 'Login', status_id: 5 }]),
      'get_tests/3': page('tests', [{ id: 31, case_id: 10, title: 'Login', status_id: 1 }]),
    });

    cleanup = fake.restore;

    const report = await getStability(
      { project_id: 5, runs: 3, min_flips: 3 },
      { client: fake.client, meta: FAKE_META },
    );

    const text = formatStability(report);
    story.code({ label: 'Output', content: text, lang: 'markdown' });

    story.then('it says the case fell below the threshold');
    expect(report.belowThreshold).toBe(1);
    expect(text).toContain('No case met the reporting criteria.');
    expect(text).toContain('_1 case alternated fewer than 3 times, so is not listed._');
    expect(text).not.toContain('No case changed');
  });

  it('still shows what fell below the threshold when something else is listed', async ({ task }) => {
    story.init(task, { tags: ['stability'] });

    story.given('with min_flips 3, one case going .X.X and another going .X..');

    const statuses = { 10: [1, 5, 1, 5], 20: [1, 5, 1, 1] };

    const fake = fakeTestRail({
      'get_plans/5': page('plans', []),
      'get_runs/5': page(
        'runs',
        [4, 3, 2, 1].map((id) => ({ id, created_on: id * 100 })),
      ),
      ...Object.fromEntries(
        [1, 2, 3, 4].map((runId) => [
          `get_tests/${runId}`,
          page(
            'tests',
            Object.entries(statuses).map(([caseId, byRun]) => ({
              id: runId * 100 + Number(caseId),
              case_id: Number(caseId),
              title: `Case ${caseId}`,
              status_id: byRun[runId - 1]!,
            })),
          ),
        ]),
      ),
    });

    cleanup = fake.restore;

    const report = await getStability(
      { project_id: 5, runs: 4, min_flips: 3 },
      { client: fake.client, meta: FAKE_META },
    );

    const text = formatStability(report);
    story.code({ label: 'Output', content: text, lang: 'markdown' });

    story.then('one case is flaky, and the other is counted rather than dropped');
    expect(report.flaky.map((row) => row.caseId)).toEqual([10]);
    expect(report.belowThreshold).toBe(1);
    expect(text).toContain('_1 case alternated fewer than 3 times, so is not listed._');
  });

  it('follows a configuration by its ids, so a rename keeps one history', async ({ task }) => {
    story.init(task, { tags: ['stability', 'configurations'] });

    story.given('Chrome passing, then the same configuration renamed and failing, with Safari alongside');

    const fake = fakeTestRail({
      'get_runs/5': page('runs', [
        { id: 3, plan_id: 40, config: 'Chrome (desktop)', config_ids: [2, 1], created_on: 300 },
        { id: 2, plan_id: 40, config: 'Safari', config_ids: [3], created_on: 200 },
        { id: 1, plan_id: 40, config: 'Chrome', config_ids: [1, 2], created_on: 100 },
      ]),
      'get_tests/1': page('tests', [{ id: 11, case_id: 10, title: 'Login', status_id: 1 }]),
      'get_tests/2': page('tests', [{ id: 21, case_id: 10, title: 'Login', status_id: 1 }]),
      'get_tests/3': page('tests', [{ id: 31, case_id: 10, title: 'Login', status_id: 5 }]),
    });

    cleanup = fake.restore;

    const report = await getStability({ project_id: 5, runs: 3 }, { client: fake.client, meta: FAKE_META });

    story.then('Chrome is one history, a regression, shown under the newest run name');
    expect(report.regressed).toMatchObject([{ caseId: 10, config: 'Chrome (desktop)', timeline: '.X' }]);

    story.and('Safari, with a single result, is counted as too little evidence');
    expect(report.insufficientEvidence).toBe(1);
    expect(formatStability(report)).toContain(
      '_1 case had fewer than two settled results, too few to judge._',
    );
  });

  it('refuses to guess from a single run', async ({ task }) => {
    story.init(task, { tags: ['stability', 'edge-case'] });

    story.given('a project with only one run');

    const fake = fakeTestRail({
      'get_plans/5': page('plans', []),
      'get_runs/5': page('runs', [{ id: 1, created_on: 100 }]),
    });

    cleanup = fake.restore;

    story.when('stability is requested');
    story.then('it fails loudly instead of reporting everything as stable');
    await expect(
      getStability({ project_id: 5, runs: 10, min_flips: 2 }, { client: fake.client, meta: FAKE_META }),
    ).rejects.toThrow(/at least 2 runs/i);
  });
});

describe('Stability report formatting', () => {
  it('leads with the counts a reader acts on', async ({ task }) => {
    story.init(task, { tags: ['stability', 'formatting'] });

    story.given('a report with one flaky, one regressed and one recovered case');

    const fake = fakeTestRail({
      'get_plans/5': page('plans', []),
      'get_runs/5': page('runs', [
        { id: 3, created_on: 300 },
        { id: 2, created_on: 200 },
        { id: 1, created_on: 100 },
      ]),
      'get_tests/1': page('tests', [
        { id: 1, case_id: 10, title: 'Login', status_id: 1 },
        { id: 2, case_id: 20, title: 'Checkout', status_id: 1 },
      ]),
      'get_tests/2': page('tests', [
        { id: 4, case_id: 10, title: 'Login', status_id: 5 },
        { id: 5, case_id: 20, title: 'Checkout', status_id: 1 },
      ]),
      'get_tests/3': page('tests', [
        { id: 7, case_id: 10, title: 'Login', status_id: 1 },
        { id: 8, case_id: 20, title: 'Checkout', status_id: 5 },
      ]),
    });

    cleanup = fake.restore;

    story.when('the report is formatted as markdown');

    const text = formatStability(
      await getStability({ project_id: 5, runs: 3, min_flips: 2 }, { client: fake.client, meta: FAKE_META }),
    );

    story.code({ label: 'Output', content: text, lang: 'markdown' });

    story.then('the heading carries all three counts');
    expect(text).toContain('# Stability — 1 flaky, 1 regressed, 0 recovered');

    story.and('the regressed section explains why it is the urgent one');
    expect(text).toContain('These are the ones to act on');

    story.but('empty sections are omitted rather than printed blank');
    expect(text).not.toContain('## Recovered');
  });
});
