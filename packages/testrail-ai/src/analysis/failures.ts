import { appendQuery, type TestRailClient } from '../client';
import { resolveMeta, type TestRailDeps } from '../deps';
import {
  clip,
  pluralize,
  failedStepNumbers,
  htmlToText,
  stepsTable,
  table,
  truncate,
  unixToDate,
} from '../format';
import { FailuresInputSchema, parseSteps, type FailuresInput } from '../schemas';
import type { Run, StepResult, Test } from '../types';
import { failingFilter, latestResultsWithCompleteness } from './run-report';
import { configKey, recentRuns } from './runs';
import { completeness, warningLines, type Completeness } from '../completeness';

/**
 * What is failing, and since when.
 *
 * `include_last_good` is the part that matters: knowing a test fails is nearly
 * useless on its own, but knowing it passed in run 611 and failed in run 612
 * bounds the change that broke it.
 */

export type FailureDetail = {
  testId: number;
  caseId: number;
  title: string;
  status: string;
  assignedTo: string;
  elapsed: string;
  defects: string;
  comment: string;
  /** Per-step outcomes, when the case uses a Steps template. */
  stepResults: StepResult[] | undefined;
  failedSteps: number[];
  totalSteps: number;
  attachmentCount: number;
  lastGood: { runId: number; name: string; date: string } | null;
};

export type FailuresReport = Completeness & {
  runId: number;
  runName: string;
  url: string;
  includedLastGood: boolean;
  failures: FailureDetail[];
  /** Status lookup retained with the result so formatting needs no hidden dependency. */
  statusNames: Record<number, string>;
};

export async function getFailures(input: FailuresInput, deps: TestRailDeps): Promise<FailuresReport> {
  const args = FailuresInputSchema.parse(input);
  const { client } = deps;
  const [meta, run] = await Promise.all([resolveMeta(deps), client.request<Run>(`get_run/${args.run_id}`)]);

  const [testResult, resultHistory] = await Promise.all([
    client.list<Test>(appendQuery(`get_tests/${args.run_id}`, failingFilter(meta)), 'tests', args.limit),
    latestResultsWithCompleteness(client, args.run_id),
  ]);

  const tests = testResult.rows;
  // Named while the last-good search runs; it never rejects, so it is awaited last.
  const naming = meta.nameUsers(tests.map((test) => test.assignedto_id));
  const results = resultHistory.rows;

  const warnings = [
    testResult.truncated
      ? `Failure list was capped at ${args.limit}; additional failures are not shown.`
      : undefined,
    resultHistory.truncated
      ? 'Result history was capped at 1000 records; some comments or defect links may be missing.'
      : undefined,
  ].filter((warning): warning is string => warning !== undefined);

  const lastGoodResult = args.include_last_good
    ? await findLastGood(
        client,
        run,
        tests.map((test) => test.case_id),
        args.lookback_runs,
      )
    : {
        rows: new Map<number, { runId: number; name: string; date: string }>(),
        truncatedRuns: 0,
        warnings: [],
      };

  const lastGood = lastGoodResult.rows;
  warnings.push(...lastGoodResult.warnings);

  if (lastGoodResult.truncatedRuns > 0) {
    warnings.push(
      `${pluralize(lastGoodResult.truncatedRuns, 'lookback run')} exceeded 1000 passing tests; last-good matches may be missing.`,
    );
  }

  await naming;

  return {
    runId: run.id,
    runName: run.name,
    url: client.link('run', run.id),
    includedLastGood: args.include_last_good,
    statusNames: Object.fromEntries(
      [...new Set([...meta.statuses.keys(), 1, 2, 3, 4, 5])].map((id) => [id, meta.statusName(id)]),
    ),
    ...completeness(...warnings),
    failures: tests.map((test) => {
      const result = results.get(test.id);
      const steps = parseSteps(result?.custom_step_results);

      return {
        testId: test.id,
        caseId: test.case_id,
        title: test.title,
        status: meta.statusName(test.status_id),
        assignedTo: meta.userName(test.assignedto_id),
        elapsed: result?.elapsed ?? '',
        defects: result?.defects ?? '',
        comment: htmlToText(result?.comment ?? ''),
        stepResults: steps,
        failedSteps: failedStepNumbers(steps),
        totalSteps: Array.isArray(steps) ? steps.length : 0,
        attachmentCount: Array.isArray(result?.attachment_ids) ? result.attachment_ids.length : 0,
        lastGood: lastGood.get(test.case_id) ?? null,
      };
    }),
  };
}

/**
 * Walk backwards through earlier runs until every case has been seen passing, or
 * the lookback is exhausted. Stops early when there is nothing left to find,
 * because each extra run is another round trip.
 */
async function findLastGood(
  client: TestRailClient,
  run: Run,
  caseIds: number[],
  lookbackRuns: number,
): Promise<{
  rows: Map<number, { runId: number; name: string; date: string }>;
  truncatedRuns: number;
  warnings: string[];
}> {
  const found = new Map<number, { runId: number; name: string; date: string }>();
  const wanted = new Set(caseIds);

  const { rows: candidates, warnings } = await recentRuns(client, {
    projectId: run.project_id,
    suiteId: run.suite_id,
    createdBefore: run.created_on,
    limit: lookbackRuns,
  });

  let truncatedRuns = 0;

  // A pass under another configuration says nothing about this one.
  const sameConfig = candidates.filter((candidate) => configKey(candidate) === configKey(run));

  for (const candidate of sameConfig) {
    if (wanted.size === 0) break;

    const result = await client.list<Test>(
      appendQuery(`get_tests/${candidate.id}`, 'status_id=1'),
      'tests',
      1000,
    );

    const rows = result.rows;

    if (result.truncated) truncatedRuns++;

    for (const test of rows) {
      if (!wanted.has(test.case_id)) continue;
      found.set(test.case_id, {
        runId: candidate.id,
        name: candidate.name,
        date: unixToDate(candidate.created_on),
      });
      wanted.delete(test.case_id);
    }
  }

  return { rows: found, truncatedRuns, warnings };
}

export function formatFailures(report: FailuresReport): string {
  if (report.failures.length === 0) {
    return [
      `Run ${report.runId} (${report.runName}) has no failing, blocked or retest tests in the rows inspected.`,
      ...report.warnings.map((warning) => `> ⚠ ${warning}`),
    ].join('\n\n');
  }

  const lines: string[] = [
    `# ${report.failures.length} non-passing test${report.failures.length === 1 ? '' : 's'} in run ${report.runId}`,
    '',
    `${report.runName} — ${report.url}`,
    ...warningLines(report),
    '',
    table(
      [
        'case',
        'title',
        'status',
        'assigned',
        'elapsed',
        'defects',
        ...(report.includedLastGood ? ['last passed in'] : []),
      ],
      report.failures.map((row) => [
        row.caseId,
        clip(row.title, 70),
        row.status,
        row.assignedTo,
        row.elapsed,
        row.defects,
        ...(report.includedLastGood
          ? [row.lastGood ? `run ${row.lastGood.runId} (${row.lastGood.date})` : 'not in lookback']
          : []),
      ]),
    ),
    '',
    '## Result comments',
    '',
  ];

  for (const failure of report.failures) {
    const steps = stepsTable(failure.stepResults, (id) => report.statusNames[id] ?? `status:${id}`);

    if (!failure.comment && !steps && failure.attachmentCount === 0) continue;

    lines.push(`**C${failure.caseId} — ${clip(failure.title, 80)}**`);

    // Per-step outcomes are where a manual failure's real evidence lives —
    // "failed at step 4 of 7, expected X, got Y".
    if (failure.failedSteps.length > 0) {
      lines.push('', `Failed at step ${failure.failedSteps.join(', ')} of ${failure.totalSteps}.`);
    }

    if (failure.comment) lines.push('', '```', truncate(failure.comment, 600), '```');

    if (steps) lines.push('', steps);

    if (failure.attachmentCount > 0) {
      lines.push(
        '',
        `_${pluralize(failure.attachmentCount, 'attachment')} — fetch with \`get_attachments_for_test/${failure.testId}\`._`,
      );
    }

    lines.push('');
  }

  return lines.join('\n');
}
