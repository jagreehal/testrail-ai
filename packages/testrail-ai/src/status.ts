import type { Run, Status } from './types';

/**
 * What a status means for analysis. Every tool reads a status through
 * `statusKind`, so the run report, coverage and stability cannot disagree about
 * whether a test ran, passed or failed.
 *
 * - `passed`: passed.
 * - `failed`: ran and failed. Failed, and any final custom status.
 * - `unsettled`: ran, outcome not decided. Blocked, retest, and any custom
 *   status that is not final.
 * - `untested`: has not run. Untested, and any custom status flagged `is_untested`.
 *
 * Each tool picks its view from these: the run report lists what is not passing
 * (`failed` and `unsettled`), coverage counts what ran (anything but
 * `untested`), and stability compares only settled outcomes (`passed` and
 * `failed`).
 */
export type StatusKind = 'passed' | 'failed' | 'unsettled' | 'untested';

type StatusFlags = Pick<Status, 'is_untested' | 'is_final'>;

const BUILT_IN = new Map<number, StatusKind>([
  [1, 'passed'],
  [2, 'unsettled'],
  [3, 'untested'],
  [4, 'unsettled'],
  [5, 'failed'],
]);

export function statusKind(
  id: number | null | undefined,
  statuses: ReadonlyMap<number, StatusFlags>,
): StatusKind {
  if (id == null) return 'untested';
  const builtIn = BUILT_IN.get(id);

  if (builtIn) return builtIn;
  const status = statuses.get(id);

  // An id the instance no longer lists still ran; its meaning is unknown.
  if (!status) return 'unsettled';

  if (status.is_untested) return 'untested';

  return status.is_final ? 'failed' : 'unsettled';
}

export const hasRun = (kind: StatusKind): boolean => kind !== 'untested';

export const isNotPassing = (kind: StatusKind): boolean => kind === 'failed' || kind === 'unsettled';

const CUSTOM_COUNTS = [
  'custom_status1_count',
  'custom_status2_count',
  'custom_status3_count',
  'custom_status4_count',
  'custom_status5_count',
  'custom_status6_count',
  'custom_status7_count',
] as const;

export type RunCounts = {
  passed: number;
  failed: number;
  blocked: number;
  retest: number;
  /** Tests on a custom status that has run. */
  other: number;
  /** Built-in untested plus any custom status flagged `is_untested`. */
  untested: number;
  /** Everything that ran. */
  executed: number;
  total: number;
};

/** A run's totals, custom statuses included. `custom_statusN_count` counts status id N + 5. */
export function runCounts(run: Run, statuses: ReadonlyMap<number, StatusFlags>): RunCounts {
  let other = 0;
  let customUntested = 0;
  CUSTOM_COUNTS.forEach((key, index) => {
    const count = run[key] ?? 0;

    if (hasRun(statusKind(index + 6, statuses))) other += count;
    else customUntested += count;
  });
  const executed = run.passed_count + run.failed_count + run.blocked_count + run.retest_count + other;
  const untested = run.untested_count + customUntested;

  return {
    passed: run.passed_count,
    failed: run.failed_count,
    blocked: run.blocked_count,
    retest: run.retest_count,
    other,
    untested,
    executed,
    total: executed + untested,
  };
}
