import { story } from 'executable-stories-vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeTestRail, page } from '../test-support';
import type { Json } from '../types';
import { recentRuns } from './runs';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const run = (id: number, created_on: number, extra: Record<string, Json> = {}) => ({
  id,
  name: `Run ${id}`,
  suite_id: 20,
  created_on,
  plan_id: null,
  ...extra,
});

describe('Listing recent runs, plan runs included', () => {
  it('asks TestRail for plan runs, and stops there when it returns them', async ({ task }) => {
    story.init(task, { tags: ['runs', 'plans'], covers: ['src/analysis/runs.ts'] });

    story.given('an instance that honours include_plan_runs');

    const fake = fakeTestRail({
      'get_runs/5': page('runs', [run(3, 30, { plan_id: 9 }), run(2, 20)]),
    });

    cleanup = fake.restore;

    story.when('the three most recent runs are listed');
    const result = await recentRuns(fake.client, { projectId: 5, limit: 3 });

    story.then('the plan run is among them, and no plan is read in detail');
    expect(result.rows.map((row) => row.id)).toEqual([3, 2]);
    story.note(
      'The plan list goes out alongside the runs, so a project without plan runs pays no extra round trip.',
    );
    expect(fake.calls.toSorted()).toEqual(['get_plans/5&limit=25', 'get_runs/5&include_plan_runs=1&limit=3']);
  });

  it('reads the plans itself when an older instance ignores the flag', async ({ task }) => {
    story.init(task, { tags: ['runs', 'plans', 'compatibility'], covers: ['src/analysis/runs.ts'] });

    story.given('an instance that returns only standalone runs, and a plan with two runs');

    const fake = fakeTestRail({
      'get_runs/5': page('runs', [run(4, 40), run(1, 10)]),
      'get_plans/5': page('plans', [{ id: 9 }]),
      'get_plan/9': {
        id: 9,
        entries: [
          { runs: [run(6, 60, { plan_id: 9 }), run(4, 40)] },
          { runs: [run(5, 50, { plan_id: 9, suite_id: 21 })] },
        ],
      },
    });

    cleanup = fake.restore;

    story.when('the three most recent runs of suite 20 are listed');
    const result = await recentRuns(fake.client, { projectId: 5, suiteId: 20, limit: 3 });

    story.then('plan runs merge in newest first, without duplicates or other suites');
    story.table({
      label: 'Runs returned',
      columns: ['id', 'created_on'],
      rows: result.rows.map((row) => [String(row.id), String(row.created_on)]),
    });
    expect(result.rows.map((row) => row.id)).toEqual([6, 4, 1]);
    expect(result.truncated).toBe(false);
  });

  it('keeps a lookback window before its cut-off, and reports a cap', async ({ task }) => {
    story.init(task, { tags: ['runs', 'plans'], covers: ['src/analysis/runs.ts'] });

    story.given('plan runs on both sides of a cut-off');

    const fake = fakeTestRail({
      'get_runs/5': page('runs', [run(2, 20)]),
      'get_plans/5': page('plans', [{ id: 9 }]),
      'get_plan/9': { id: 9, entries: [{ runs: [run(8, 80, { plan_id: 9 }), run(3, 30, { plan_id: 9 })] }] },
    });

    cleanup = fake.restore;

    story.when('one run created before 50 is asked for');
    const result = await recentRuns(fake.client, { projectId: 5, createdBefore: 50, limit: 1 });

    story.then('the later plan run is left out, and the cap is reported');
    expect(result.rows.map((row) => row.id)).toEqual([3]);
    expect(result.truncated).toBe(true);
    expect(fake.calls).toContain('get_plans/5&created_before=50&limit=25');
  });

  it('keeps the standalone runs and says so when the plans cannot be read', async ({ task }) => {
    story.init(task, { tags: ['runs', 'plans', 'resilience'], covers: ['src/analysis/runs.ts'] });

    story.given('an API key that cannot list plans');

    const fake = fakeTestRail({
      'get_runs/5': page('runs', [run(2, 20)]),
      'get_plans/5': () => new Response('forbidden', { status: 403 }),
    });

    cleanup = fake.restore;

    story.when('the runs are listed');
    const result = await recentRuns(fake.client, { projectId: 5, limit: 5 });

    story.then('the standalone runs come back with a warning naming what is missing');
    expect(result.rows.map((row) => row.id)).toEqual([2]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/^Runs inside test plans could not be read \(TestRail 403/);
  });

  it('says so when there are more plans than it reads', async ({ task }) => {
    story.init(task, { tags: ['runs', 'plans', 'pagination'], covers: ['src/analysis/runs.ts'] });

    story.given('a project with more test plans than the fallback reads');
    const planIds = Array.from({ length: 25 }, (_, index) => index + 1);

    const fake = fakeTestRail({
      'get_runs/5': page('runs', [run(2, 20)]),
      'get_plans/5': page(
        'plans',
        planIds.map((id) => ({ id })),
        '/api/v2/get_plans/5&limit=25&offset=25',
      ),
      ...Object.fromEntries(planIds.map((id) => [`get_plan/${id}`, { id, entries: [] }])),
    });

    cleanup = fake.restore;

    story.when('the runs are listed');
    const result = await recentRuns(fake.client, { projectId: 5, limit: 5 });

    story.then('the result names the plans it did not read');
    expect(result.warnings).toEqual([
      'Read runs from the 25 most recent test plans; older plans were not read.',
    ]);
  });

  it('adds nothing for a project without plans', async ({ task }) => {
    story.init(task, { tags: ['runs', 'plans'], covers: ['src/analysis/runs.ts'] });

    story.given('standalone runs and no plans');

    const fake = fakeTestRail({
      'get_runs/5': page('runs', [run(2, 20), run(1, 10)]),
      'get_plans/5': page('plans', []),
    });

    cleanup = fake.restore;

    story.when('the runs are listed');
    const result = await recentRuns(fake.client, { projectId: 5, limit: 5 });

    story.then('the runs come back as TestRail listed them');
    expect(result.rows.map((row) => row.id)).toEqual([2, 1]);
    expect(fake.calls.some((call) => call.startsWith('get_plan/'))).toBe(false);
  });
});

describe('Run ordering, across random mixes of standalone and plan runs', () => {
  it('returns the newest runs of both kinds, newest first, without duplicates', async () => {
    // A seeded generator, so a failure reproduces.
    let seed = 7;
    const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
    const pick = (max: number) => Math.floor(next() * max);

    for (let trial = 0; trial < 60; trial++) {
      // Unique timestamps, so "newest first" has one right answer.
      const times = [...new Set(Array.from({ length: 30 }, () => 1 + pick(10_000)))];
      const all = times.map((created_on, index) => run(index + 1, created_on, { suite_id: 20 + pick(2) }));
      const standalone = all.filter(() => next() < 0.5);
      const planned = all.filter((row) => !standalone.includes(row) || next() < 0.2);

      const plans = [0, 1, 2].map((id) => ({
        id: 100 + id,
        entries: [
          {
            runs: planned.flatMap((row, index) => (index % 3 === id ? [{ ...row, plan_id: 100 + id }] : [])),
          },
        ],
      }));

      const limit = 1 + pick(8);
      const suiteId = next() < 0.5 ? 20 : undefined;
      const createdBefore = next() < 0.5 ? 1 + pick(10_000) : undefined;

      const inScope = (row: { suite_id: number; created_on: number }) =>
        (suiteId === undefined || row.suite_id === suiteId) &&
        (createdBefore === undefined || row.created_on < createdBefore);

      const newestFirst = <T extends { created_on: number }>(rows: T[]) =>
        rows.toSorted((a, b) => b.created_on - a.created_on);

      // What TestRail's get_runs would return: filtered, newest first, capped.
      const direct = newestFirst(standalone.filter(inScope)).slice(0, limit);

      const fake = fakeTestRail({
        'get_runs/5': page('runs', direct),
        'get_plans/5': page(
          'plans',
          plans.map(({ id }) => ({ id })),
        ),
        ...Object.fromEntries(plans.map((plan) => [`get_plan/${plan.id}`, plan])),
      });

      const result = await recentRuns(fake.client, { projectId: 5, suiteId, createdBefore, limit });
      fake.restore();

      const expected = newestFirst([
        ...new Map(
          [...standalone, ...planned].flatMap((row) => (inScope(row) ? [[row.id, row] as const] : [])),
        ).values(),
      ])
        .slice(0, limit)
        .map((row) => row.id);

      expect(
        result.rows.map((row) => row.id),
        `trial ${trial}`,
      ).toEqual(expected);
    }
  });
});
