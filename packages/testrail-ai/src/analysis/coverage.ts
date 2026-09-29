import { appendQuery } from '../client';
import { mapWithConcurrency } from '../concurrency';
import { resolveMeta, type TestRailDeps } from '../deps';
import { clip, pluralize, table, unixToDate } from '../format';
import { CoverageInputSchema, type CoverageInput } from '../schemas';
import { hasRun } from '../status';
import type { Case, Run, Test } from '../types';
import { recentRuns } from './runs';
import { completeness, warningLines, type Completeness } from '../completeness';

/**
 * What the suite is not testing.
 *
 * Three different gaps, deliberately kept apart: cases that exist but trace to
 * no requirement, cases that exist but never execute, and requirements with no
 * case at all. The last is the one TestRail's own UI will not show you.
 */

export type CoverageRow = { caseId: number; title: string; priority: string; updated?: string };

export type CoverageReport = Completeness & {
  projectId: number;
  caseCount: number;
  byPriority: { name: string; count: number }[];
  byType: { name: string; count: number }[];
  unreferenced: CoverageRow[];
  /** Requirements the caller named that no case covers. Empty when none were named. */
  uncoveredRefs: string[];
  namedRefCount: number;
  neverExecuted: { runsChecked: number; cases: CoverageRow[] } | null;
  runGaps: { runId: number; notInRun: CoverageRow[]; untestedInRun: CoverageRow[] } | null;
};

export async function getCoverage(input: CoverageInput, deps: TestRailDeps): Promise<CoverageReport> {
  const args = CoverageInputSchema.parse(input);
  const { client } = deps;
  const meta = await resolveMeta(deps);
  const warnings: string[] = [];

  const { rows: cases, truncated } = await client.list<Case>(
    appendQuery(`get_cases/${args.project_id}`, args.suite_id ? `suite_id=${args.suite_id}` : ''),
    'cases',
    args.limit,
  );

  if (cases.length === 0) throw new Error(`No cases found in project ${args.project_id}.`);

  if (truncated)
    warnings.push(`Case list was capped at ${args.limit}; raise \`limit\` for the full picture.`);

  const tally = <K>(keyOf: (row: Case) => K) => {
    const counts = new Map<K, number>();

    for (const row of cases) counts.set(keyOf(row), (counts.get(keyOf(row)) ?? 0) + 1);

    return [...counts.entries()].toSorted((a, b) => b[1] - a[1]);
  };

  const row = (testCase: Case): CoverageRow => ({
    caseId: testCase.id,
    title: testCase.title,
    priority: meta.priorityName(testCase.priority_id),
    updated: unixToDate(testCase.updated_on),
  });

  // Requirements with no case at all.
  let uncoveredRefs: string[] = [];

  if (args.refs?.length) {
    const covered = new Set<string>();

    for (const testCase of cases) {
      for (const ref of (testCase.refs ?? '').split(/[,\s]+/).filter(Boolean)) {
        covered.add(ref.toLowerCase());
      }
    }

    uncoveredRefs = args.refs.filter((ref) => !covered.has(ref.toLowerCase()));
  }

  // A case that exists but never runs is not coverage, it is inventory.
  let neverExecuted: CoverageReport['neverExecuted'] = null;

  if (args.recent_runs > 0) {
    const { rows: runs, warnings: runWarnings } = await recentRuns(client, {
      projectId: args.project_id,
      suiteId: args.suite_id,
      limit: args.recent_runs,
    });

    warnings.push(...runWarnings);

    // Independent per-run fetches; parallel rather than one at a time.
    const perRun = await mapWithConcurrency(runs, (run) =>
      client.list<Test>(`get_tests/${run.id}`, 'tests', 2000),
    );

    const cappedRuns = perRun.filter((result) => result.truncated).length;

    if (cappedRuns > 0) {
      warnings.push(
        `${pluralize(cappedRuns, 'recent run')} exceeded 2000 tests; execution coverage may be incomplete.`,
      );
    }

    const executed = new Set<number>();

    for (const { rows } of perRun) {
      for (const test of rows) if (hasRun(meta.statusKind(test.status_id))) executed.add(test.case_id);
    }

    neverExecuted = {
      runsChecked: runs.length,
      cases: cases.filter((testCase) => !executed.has(testCase.id)).map(row),
    };
  }

  // What a specific run skipped — "we shipped without testing these".
  let runGaps: CoverageReport['runGaps'] = null;

  if (args.run_id !== undefined) {
    const run = await client.request<Run>(`get_run/${args.run_id}`);

    // Another project's run would list its cases as untested here, and this
    // project's cases as missing from it.
    if (run.project_id !== args.project_id) {
      throw new Error(`Run ${run.id} belongs to project ${run.project_id}, not project ${args.project_id}.`);
    }

    if (args.suite_id !== undefined && run.suite_id != null && run.suite_id !== args.suite_id) {
      throw new Error(`Run ${run.id} ran suite ${run.suite_id}, not suite ${args.suite_id}.`);
    }

    const testResult = await client.list<Test>(`get_tests/${args.run_id}`, 'tests', 2000);
    const tests = testResult.rows;

    if (testResult.truncated) {
      warnings.push(`Run ${args.run_id} exceeded 2000 tests; run-gap coverage is incomplete.`);
    }

    const inRun = new Set(tests.map((test) => test.case_id));
    runGaps = {
      runId: args.run_id,
      notInRun: cases.filter((testCase) => !inRun.has(testCase.id)).map(row),
      untestedInRun: tests
        .filter((test) => !hasRun(meta.statusKind(test.status_id)))
        .map((test) => ({ caseId: test.case_id, title: test.title, priority: '' })),
    };
  }

  return {
    projectId: args.project_id,
    caseCount: cases.length,
    byPriority: tally((testCase) => meta.priorityName(testCase.priority_id)).map(([name, count]) => ({
      name,
      count,
    })),
    byType: tally((testCase) => meta.typeName(testCase.type_id)).map(([name, count]) => ({ name, count })),
    unreferenced: cases.filter((testCase) => !testCase.refs?.trim()).map(row),
    uncoveredRefs,
    namedRefCount: args.refs?.length ?? 0,
    neverExecuted,
    runGaps,
    ...completeness(...warnings),
  };
}

export function formatCoverage(report: CoverageReport): string {
  const lines: string[] = [
    `# Coverage — project ${report.projectId}`,
    '',
    `${report.caseCount} cases analysed.`,
    ...warningLines(report),
  ];

  const capped = (rows: CoverageRow[], columns: 'basic' | 'dated', max = 50) => {
    const body =
      columns === 'dated'
        ? table(
            ['case', 'title', 'priority', 'updated'],
            rows.slice(0, max).map((r) => [r.caseId, clip(r.title, 70), r.priority, r.updated ?? '']),
          )
        : table(
            ['case', 'title', 'priority'],
            rows.slice(0, max).map((r) => [r.caseId, clip(r.title, 80), r.priority]),
          );

    return rows.length > max ? `${body}\n_…and ${rows.length - max} more._` : body;
  };

  lines.push(
    '',
    '## Distribution',
    '',
    table(
      ['priority', 'cases'],
      report.byPriority.map((r) => [r.name, r.count]),
    ),
    '',
    table(
      ['type', 'cases'],
      report.byType.map((r) => [r.name, r.count]),
    ),
    '',
    `## Cases with no requirement reference (${report.unreferenced.length} of ${report.caseCount})`,
    '',
    report.unreferenced.length === 0
      ? '_Every case is traceable to a requirement._'
      : capped(report.unreferenced, 'basic'),
  );

  if (report.namedRefCount > 0) {
    lines.push(
      '',
      `## Requirements with no covering case (${report.uncoveredRefs.length} of ${report.namedRefCount})`,
      '',
      report.uncoveredRefs.length === 0
        ? '_All named requirements have at least one case._'
        : report.uncoveredRefs.map((ref) => `- ${ref}`).join('\n'),
    );
  }

  if (report.neverExecuted) {
    lines.push(
      '',
      `## Never executed in the last ${pluralize(report.neverExecuted.runsChecked, 'run')} ` +
        `(${report.neverExecuted.cases.length} of ${report.caseCount})`,
      '',
      report.neverExecuted.cases.length === 0
        ? '_Every case has been executed recently._'
        : capped(report.neverExecuted.cases, 'dated'),
    );
  }

  if (report.runGaps) {
    lines.push(
      '',
      `## Run ${report.runGaps.runId} gaps`,
      '',
      `${pluralize(report.runGaps.notInRun.length, 'suite case')} ${isAre(report.runGaps.notInRun.length)} not in the run; ` +
        `${report.runGaps.untestedInRun.length} ${isAre(report.runGaps.untestedInRun.length)} in it but untested.`,
      '',
      table(
        ['case', 'title', 'priority', 'gap'],
        [
          ...report.runGaps.notInRun
            .slice(0, 30)
            .map((r) => [r.caseId, clip(r.title, 70), r.priority, 'not in run']),
          ...report.runGaps.untestedInRun
            .slice(0, 30)
            .map((r) => [r.caseId, clip(r.title, 70), '', 'untested']),
        ],
      ),
    );
  }

  return lines.join('\n');
}

function isAre(n: number): string {
  return n === 1 ? 'is' : 'are';
}
