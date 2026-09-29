import { mapWithConcurrency } from '../concurrency';
import { resolveMeta, type TestRailDeps } from '../deps';
import { clip, pluralize, table, unixToDate } from '../format';
import { StabilityInputSchema, type StabilityInput } from '../schemas';
import type { StatusKind } from '../status';
import type { Test } from '../types';
import { configKey, recentRuns } from './runs';
import { completeness, warningLines, type Completeness } from '../completeness';

/**
 * Flaky, regressed, or recovered — three different things that a naive
 * "count the failures" report conflates into one.
 *
 * A test that fails every time is broken. A test that passed and then failed and
 * stayed failed is a regression, and it is the most urgent of the three. Only a
 * test that genuinely alternates is flaky. Reporting a regression as flakiness
 * is how real breakage gets dismissed as noise, so the distinction is enforced
 * here rather than left to the caller.
 */

export type CaseStability = {
  caseId: number;
  title: string;
  /**
   * The run configuration, e.g. `Chrome, Windows`, or null outside one. Each
   * configuration has its own history: Chrome passing while Safari fails is a
   * browser difference, not flakiness.
   */
  config: string | null;
  /** pass↔fail transitions across settled runs. */
  flips: number;
  /** Runs where the outcome was settled (passed or failed), not untested, blocked or retest. */
  runs: number;
  failures: number;
  endedFailing: boolean;
  /** Oldest → newest: `.` passed, `X` failed, `-` unsettled. */
  timeline: string;
};

export type StabilityReport = Completeness & {
  projectId: number;
  runCount: number;
  from: string;
  to: string;
  minFlips: number;
  /** Cases that alternated, but fewer than `minFlips` times, so appear in no list. */
  belowThreshold: number;
  /**
   * Case histories with fewer than two settled results in the window: too
   * little evidence to show any change, so they appear in no list either.
   */
  insufficientEvidence: number;
  flaky: CaseStability[];
  regressed: CaseStability[];
  recovered: CaseStability[];
};

/**
 * Reduce one case's run history to the numbers that decide flaky vs regressed.
 *
 * Exported so it can be tested directly: this is the logic that once reported
 * every regression as "flaky", because a lone `.X` transition was counted as
 * flakiness. It is not — it is a regression.
 */
export function classifyStates(states: { kind: StatusKind }[]) {
  // Only settled outcomes count. Untested, blocked and retest mean "we do not
  // know yet"; counting them as failures would report the whole suite as unstable.
  const settled = states.filter((state) => state.kind === 'passed' || state.kind === 'failed');
  let flips = 0;

  for (let index = 1; index < settled.length; index++) {
    if (settled[index]!.kind !== settled[index - 1]!.kind) flips++;
  }

  return {
    flips,
    runs: settled.length,
    failures: settled.filter((state) => state.kind === 'failed').length,
    endedFailing: settled.at(-1)?.kind === 'failed',
  };
}

export function renderTimeline(states: { kind: StatusKind }[]): string {
  return states
    .map((state) => (state.kind === 'passed' ? '.' : state.kind === 'failed' ? 'X' : '-'))
    .join('');
}

export async function getStability(input: StabilityInput, deps: TestRailDeps): Promise<StabilityReport> {
  const args = StabilityInputSchema.parse(input);
  const { client } = deps;

  const { rows: runs, warnings: runWarnings } = await recentRuns(client, {
    projectId: args.project_id,
    suiteId: args.suite_id,
    limit: args.runs,
  });

  if (runs.length < 2) {
    throw new Error(
      `Need at least 2 runs to judge stability; project ${args.project_id} has ${runs.length}.`,
    );
  }

  // Oldest first, so a transition reads in the direction time actually moved.
  const ordered = runs.toSorted((a, b) => a.created_on - b.created_on);

  // One request per run, in parallel — these are independent, and awaiting them
  // in a loop made a 25-run comparison 25 sequential round trips.
  const [perRun, meta] = await Promise.all([
    mapWithConcurrency(ordered, (run) => client.list<Test>(`get_tests/${run.id}`, 'tests', 2000)),
    resolveMeta(deps),
  ]);

  const cappedRuns = perRun.filter((result) => result.truncated).length;

  // Folded back in input order, so the timeline still reads oldest to newest.
  const history = new Map<
    string,
    { caseId: number; config: string | null; title: string; states: { runId: number; kind: StatusKind }[] }
  >();

  for (const [index, run] of ordered.entries()) {
    const config = run.config ?? null;

    for (const test of perRun[index]!.rows) {
      const key = JSON.stringify([test.case_id, configKey(run)]);
      const entry = history.get(key) ?? { caseId: test.case_id, config, title: test.title, states: [] };
      entry.states.push({ runId: run.id, kind: meta.statusKind(test.status_id) });
      // Runs are oldest first, so this ends on the name the newest run recorded.
      // TestRail keeps the name a run was created with, even after a rename.
      entry.config = config;
      history.set(key, entry);
    }
  }

  const analysed: CaseStability[] = [...history.values()]
    .map((entry) => ({
      caseId: entry.caseId,
      title: entry.title,
      config: entry.config,
      timeline: renderTimeline(entry.states),
      ...classifyStates(entry.states),
    }))
    .toSorted((a, b) => b.flips - a.flips || b.runs - a.runs);

  return {
    projectId: args.project_id,
    runCount: ordered.length,
    from: unixToDate(ordered[0]!.created_on),
    to: unixToDate(ordered.at(-1)!.created_on),
    minFlips: args.min_flips,
    belowThreshold: analysed.filter((row) => row.flips >= 2 && row.flips < args.min_flips).length,
    insufficientEvidence: analysed.filter((row) => row.runs < 2).length,
    // Genuine alternation needs at least two transitions, which in turn needs at
    // least three settled observations.
    flaky: analysed.filter((row) => row.flips >= args.min_flips && row.runs >= 3),
    regressed: analysed.filter((row) => row.flips === 1 && row.endedFailing),
    recovered: analysed.filter((row) => row.flips === 1 && !row.endedFailing),
    ...completeness(
      cappedRuns > 0 &&
        `${pluralize(cappedRuns, 'run')} exceeded 2000 tests; stability classifications may be incomplete.`,
      ...runWarnings,
    ),
  };
}

export function formatStability(report: StabilityReport): string {
  const { flaky, regressed, recovered } = report;
  const window = `Across ${report.runCount} runs (${report.from} → ${report.to}) of project ${report.projectId}.`;

  const below =
    report.belowThreshold > 0 &&
    `${pluralize(report.belowThreshold, 'case')} alternated fewer than ${report.minFlips} times, so ${report.belowThreshold === 1 ? 'is' : 'are'} not listed.`;

  const thin =
    report.insufficientEvidence > 0 &&
    `${pluralize(report.insufficientEvidence, 'case')} had fewer than two settled results, too few to judge.`;

  // What was left out, shown whenever something was, so an empty or short list
  // is never read as the whole picture.
  const omitted = [below, thin].filter((line): line is string => Boolean(line));

  if (flaky.length === 0 && regressed.length === 0 && recovered.length === 0) {
    return [
      below ? `No case met the reporting criteria. ${window}` : `No case changed pass↔fail state. ${window}`,
      ...omitted.map((line) => `_${line}_`),
      ...report.warnings.map((warning) => `> ⚠ ${warning}`),
    ].join('\n\n');
  }

  const section = (title: string, note: string, rows: CaseStability[], withFlips: boolean) => {
    const lines = ['', `## ${title} (${rows.length})`, '', `_${note}_`, ''];

    if (rows.length === 0) return lines;
    lines.push(
      withFlips
        ? table(
            ['case', 'title', 'flips', 'settled runs', 'failures', 'timeline'],
            rows
              .slice(0, 50)
              .map((row) => [
                row.caseId,
                clip(row.config ? `${row.title} [${row.config}]` : row.title, 60),
                row.flips,
                row.runs,
                row.failures,
                row.timeline,
              ]),
          )
        : table(
            ['case', 'title', 'settled runs', 'timeline'],
            rows
              .slice(0, 50)
              .map((row) => [
                row.caseId,
                clip(row.config ? `${row.title} [${row.config}]` : row.title, 60),
                row.runs,
                row.timeline,
              ]),
          ),
    );

    if (rows.length > 50) lines.push(`_…and ${rows.length - 50} more._`);

    return lines;
  };

  return [
    `# Stability — ${flaky.length} flaky, ${regressed.length} regressed, ${recovered.length} recovered`,
    '',
    window,
    ...omitted.flatMap((line) => ['', `_${line}_`]),
    ...warningLines(report),
    ...section(
      'Flaky',
      flaky.length === 0
        ? below
          ? 'None at the threshold.'
          : 'None. Every state change in this window was a one-way regression or fix, not alternation.'
        : `At least ${report.minFlips} pass↔fail transitions over 3+ settled runs — genuinely alternating.`,
      flaky,
      true,
    ),
    ...(regressed.length > 0
      ? section(
          'Regressed',
          'Passed, then failed, and stayed failed. These are the ones to act on.',
          regressed,
          false,
        )
      : []),
    ...(recovered.length > 0
      ? section(
          'Recovered',
          'Failed, then passed and stayed passing. Fixed, or the environment settled.',
          recovered,
          false,
        )
      : []),
    '',
    '_Timeline is oldest → newest: `.` passed, `X` failed, `-` untested/blocked/retest._',
  ].join('\n');
}
