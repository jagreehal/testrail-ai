import type { TestRailClient } from '../client';
import type { Meta } from '../meta';
import { resolveMeta, type TestRailDeps } from '../deps';
import { clip, clusterByMessage, htmlToText, table, truncate, unixToDate } from '../format';
import { RunReportInputSchema, type RunReportInput } from '../schemas';
import type { Result, Run, Test } from '../types';
import { isNotPassing, runCounts } from '../status';
import { recentRuns } from './runs';
import { completeness, warningLines, type Completeness } from '../completeness';

/**
 * One run, answered in one call: totals, pass rate, and the failures grouped by
 * what actually caused them.
 *
 * Clustering is what makes a 986-test run readable. Nearly always a wall of
 * failures is three real problems wearing forty-seven different test names.
 */

export type FailureCluster = {
  signature: string;
  tests: { testId: number; caseId: number; title: string; status: string; defects: string }[];
  sampleComment: string | null;
};

export type RunReport = Completeness & {
  runId: number;
  name: string;
  url: string;
  isCompleted: boolean;
  createdOn: string;
  createdBy: string;
  config: string | null;
  counts: {
    passed: number;
    failed: number;
    blocked: number;
    retest: number;
    /** Tests on a custom status that has run without passing. */
    other: number;
    /** Built-in untested plus any custom status flagged `is_untested`. */
    untested: number;
    total: number;
  };
  /** Percentage of *executed* tests that passed; null when nothing has run yet. */
  passRate: number | null;
  statusBreakdown: { status: string; count: number }[];
  clusters: FailureCluster[];
  /** Non-passing tests with no comment — a gap in the record, not a cluster. */
  undocumented: { caseId: number; title: string; status: string }[];
  passed: { caseId: number; title: string }[];
};

export async function resolveRun(
  client: TestRailClient,
  runId: number | undefined,
  projectId: number | undefined,
): Promise<{ run: Run; warnings: string[] }> {
  if (runId !== undefined) return { run: await client.request<Run>(`get_run/${runId}`), warnings: [] };

  if (projectId === undefined) {
    throw new Error('Give either a run_id, or a project_id to take the latest run from.');
  }

  const { rows, warnings } = await recentRuns(client, { projectId, limit: 1 });
  const latest = rows[0];

  if (!latest) throw new Error(`Project ${projectId} has no runs.`);

  return { run: latest, warnings };
}

/**
 * The latest result per test. `get_results_for_run` returns newest first, so the
 * first sighting of a test_id is its current result — which is why this keeps
 * the first and ignores the rest rather than sorting by date.
 */
export async function latestResults(client: TestRailClient, runId: number): Promise<Map<number, Result>> {
  return (await latestResultsWithCompleteness(client, runId)).rows;
}

export async function latestResultsWithCompleteness(
  client: TestRailClient,
  runId: number,
): Promise<{ rows: Map<number, Result>; truncated: boolean }> {
  const result = await client.list<Result>(`get_results_for_run/${runId}`, 'results', 1000);
  const latest = new Map<number, Result>();

  for (const row of result.rows) if (!latest.has(row.test_id)) latest.set(row.test_id, row);

  return { rows: latest, truncated: result.truncated };
}

export async function getRunReport(input: RunReportInput, deps: TestRailDeps): Promise<RunReport> {
  const args = RunReportInputSchema.parse(input);
  const { client } = deps;

  // Nothing here waits on anything it does not need: reference data loads while
  // the run is found, and the creator is named while its tests are read.
  const [meta, { run, warnings: runWarnings }] = await Promise.all([
    resolveMeta(deps),
    resolveRun(client, args.run_id, args.project_id),
  ]);

  const [testResult, resultHistory] = await Promise.all([
    client.list<Test>(`get_tests/${run.id}`, 'tests', client.maxRows * 4),
    latestResultsWithCompleteness(client, run.id),
    meta.nameUsers([run.created_by]),
  ]);

  const tests = testResult.rows;
  const results = resultHistory.rows;

  const warnings = [
    testResult.truncated
      ? `Test list was capped at ${tests.length}; status details below are incomplete.`
      : undefined,
    resultHistory.truncated
      ? 'Result history was capped at 1000 records; some comments or defect links may be missing.'
      : undefined,
  ].filter((warning): warning is string => warning !== undefined);

  const counts = runCounts(run, meta.statuses);

  const byStatus = new Map<number, Test[]>();

  for (const test of tests) {
    const bucket = byStatus.get(test.status_id);

    if (bucket) bucket.push(test);
    else byStatus.set(test.status_id, [test]);
  }

  const notPassing = tests.filter((test) => isNotPassing(meta.statusKind(test.status_id)));
  const commentOf = (test: Test) => htmlToText(results.get(test.id)?.comment ?? '');

  // Tests with no comment carry no signal to cluster ON, so clustering them
  // produces one enormous "(no message)" bucket that crowds out the real
  // clusters. They are a gap in the record, and are reported as one.
  const documented = notPassing.filter((test) => commentOf(test));
  const undocumented = notPassing.filter((test) => !commentOf(test));

  const clusterMap = clusterByMessage(documented, (test) => commentOf(test).slice(0, 300));

  const clusters: FailureCluster[] = [...clusterMap.entries()]
    .toSorted((a, b) => b[1].length - a[1].length)
    .map(([signature, group]) => ({
      signature,
      sampleComment: results.get(group[0]!.id)?.comment
        ? htmlToText(results.get(group[0]!.id)!.comment)
        : null,
      tests: group.map((test) => ({
        testId: test.id,
        caseId: test.case_id,
        title: test.title,
        status: meta.statusName(test.status_id),
        defects: results.get(test.id)?.defects ?? '',
      })),
    }));

  return {
    runId: run.id,
    name: run.name,
    url: client.link('run', run.id),
    isCompleted: run.is_completed,
    createdOn: unixToDate(run.created_on),
    createdBy: meta.userName(run.created_by),
    config: run.config,
    counts: {
      passed: counts.passed,
      failed: counts.failed,
      blocked: counts.blocked,
      retest: counts.retest,
      other: counts.other,
      untested: counts.untested,
      total: counts.total,
    },
    // Pass rate over what actually ran. Counting untested as failure would make
    // an in-progress run look catastrophic; counting it as pass would hide it.
    passRate: counts.executed > 0 ? (counts.passed / counts.executed) * 100 : null,
    statusBreakdown: [...byStatus.entries()]
      .toSorted((a, b) => b[1].length - a[1].length)
      .map(([statusId, group]) => ({ status: meta.statusName(statusId), count: group.length })),
    clusters,
    undocumented: undocumented.map((test) => ({
      caseId: test.case_id,
      title: test.title,
      status: meta.statusName(test.status_id),
    })),
    passed: args.include_passed
      ? tests
          .filter((test) => meta.statusKind(test.status_id) === 'passed')
          .map((test) => ({ caseId: test.case_id, title: test.title }))
      : [],
    ...completeness(...warnings, ...runWarnings),
  };
}

export function formatRunReport(report: RunReport): string {
  const { counts } = report;

  const notPassingCount =
    report.clusters.reduce((sum, c) => sum + c.tests.length, 0) + report.undocumented.length;

  const lines: (string | null)[] = [
    `# ${report.name}`,
    '',
    `Run ${report.runId} · ${report.isCompleted ? 'closed' : 'open'} · created ${report.createdOn} by ${report.createdBy}`,
    report.config ? `Config: ${report.config}` : null,
    report.url,
    ...warningLines(report),
    '',
    `**${report.passRate === null ? '—' : `${report.passRate.toFixed(1)}%`} passing** — ` +
      `${counts.passed} passed, ${counts.failed} failed, ${counts.blocked} blocked, ` +
      `${counts.retest} retest, ${counts.other > 0 ? `${counts.other} other, ` : ''}` +
      `${counts.untested} untested (${counts.total} total)`,
    '',
    '## Status breakdown',
    '',
    table(
      ['status', 'count'],
      report.statusBreakdown.map((row) => [row.status, row.count]),
    ),
  ];

  if (report.clusters.length > 0) {
    const documentedCount = report.clusters.reduce((sum, c) => sum + c.tests.length, 0);
    lines.push(
      '',
      `## Failure clusters (${report.clusters.length} distinct from ${documentedCount} explained failures)`,
      '',
    );

    for (const cluster of report.clusters) {
      lines.push(
        `### ${cluster.tests.length}× — ${clip(cluster.signature, 160)}`,
        '',
        table(
          ['test', 'case', 'title', 'status', 'defects'],
          cluster.tests
            .slice(0, 25)
            .map((test) => [test.testId, test.caseId, clip(test.title, 70), test.status, test.defects]),
        ),
      );

      if (cluster.tests.length > 25) {
        lines.push(`_…and ${cluster.tests.length - 25} more in this cluster._`);
      }

      if (cluster.sampleComment) {
        lines.push('', 'Sample comment:', '```', truncate(cluster.sampleComment, 800), '```');
      }

      lines.push('');
    }
  }

  if (report.undocumented.length > 0) {
    const byStatus = new Map<string, number>();

    for (const row of report.undocumented) byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);

    lines.push(
      '',
      `## No result comment (${report.undocumented.length} of ${notPassingCount} non-passing)`,
      '',
      'These failed or were blocked with no explanation recorded, so there is nothing to ' +
        'diagnose from TestRail alone — someone has to be asked, or the run re-executed.',
      '',
      table(
        ['status', 'count'],
        [...byStatus.entries()].toSorted((a, b) => b[1] - a[1]),
      ),
      '',
      table(
        ['case', 'title', 'status'],
        report.undocumented.slice(0, 40).map((row) => [row.caseId, clip(row.title, 80), row.status]),
      ),
    );

    if (report.undocumented.length > 40) {
      lines.push(`_…and ${report.undocumented.length - 40} more._`);
    }
  }

  if (report.passed.length > 0) {
    lines.push(
      '',
      `## Passed (${report.passed.length})`,
      '',
      table(
        ['case', 'title'],
        report.passed.map((row) => [row.caseId, clip(row.title, 90)]),
      ),
    );
  }

  return lines.filter((line) => line !== null).join('\n');
}

/** Shared by `getFailures`: the endpoint filter for "did not pass". */
export function failingFilter(meta: Meta): string {
  return `status_id=${meta.failingStatusIds.join(',')}`;
}
