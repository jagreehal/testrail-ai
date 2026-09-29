import type { ListResult, TestRailClient } from '../client';
import { mapWithConcurrency } from '../concurrency';
import { resolveMeta, type TestRailDeps } from '../deps';
import { clip, htmlToText, stepsTable, table, truncate, unixToIso } from '../format';
import { CaseDetailInputSchema, parseSteps, type CaseDetailInput } from '../schemas';
import { z } from 'zod';
import type { Case, Result, Section, StepResult, Test } from '../types';
import { recentRuns } from './runs';
import { completeness, warningLines, type Completeness } from '../completeness';

/**
 * A test case, rendered as something worth reading.
 *
 * A TestRail case is mostly rich text — steps, preconditions, expected results —
 * stored as HTML fragments that cost several times their meaning in tokens. The
 * custom field names differ per instance, so the rich-text fields are discovered
 * rather than hardcoded.
 */

export type CaseDetail = Completeness & {
  caseId: number;
  title: string;
  sectionName: string | null;
  sectionId: number;
  priority: string;
  type: string;
  refs: string | null;
  estimate: string | null;
  templateId: number | null;
  updated: string | null;
  url: string;
  /** Discovered `custom_*` string fields, HTML stripped. */
  richText: { name: string; text: string }[];
  /** `custom_steps_separated`, when the case uses a Steps template. */
  structuredSteps: StepResult[] | undefined;
  otherFields: { field: string; value: string }[];
  history: { runId: number; runName: string; status: string; defects: string; comment: string }[];
};

export async function getCaseDetail(input: CaseDetailInput, deps: TestRailDeps): Promise<CaseDetail> {
  const args = CaseDetailInputSchema.parse(input);
  const { client } = deps;
  const meta = await resolveMeta(deps);
  const resolvedDeps = { client, meta };
  const testCase = await client.request<Case>(`get_case/${args.case_id}`);
  const section = await client.request<Section>(`get_section/${testCase.section_id}`).catch(() => undefined);

  const { history, warnings: historyWarnings } = args.include_history
    ? await caseHistory(testCase, resolvedDeps)
    : { history: [], warnings: [] };

  const { richText, otherFields } = customFields(testCase);

  return {
    caseId: testCase.id,
    title: testCase.title,
    sectionName: section?.name ?? null,
    sectionId: testCase.section_id,
    priority: meta.priorityName(testCase.priority_id),
    type: meta.typeName(testCase.type_id),
    refs: testCase.refs,
    estimate: testCase.estimate,
    templateId: testCase.template_id ?? null,
    updated: unixToIso(testCase.updated_on),
    url: client.link('case', testCase.id),
    richText,
    structuredSteps: parseSteps(testCase.custom_steps_separated),
    otherFields,
    history,
    ...completeness(
      !section && `Section ${testCase.section_id} could not be read; showing its id.`,
      ...historyWarnings,
    ),
  };
}

/**
 * Recent execution history for one case.
 *
 * TestRail has no "results for this case across all runs" endpoint, so this
 * walks the project's recent runs and picks out the matching test. Bounded to a
 * handful of runs on purpose — this is context for a case, not an audit trail.
 */
async function caseHistory(
  testCase: Case,
  deps: TestRailDeps & { meta: NonNullable<TestRailDeps['meta']> },
): Promise<{ history: CaseDetail['history']; warnings: string[] }> {
  const { client, meta } = deps;
  const project = await projectOf(client, testCase);

  if (project.id === undefined) return { history: [], warnings: [project.warning] };

  const { rows: runs, warnings } = await recentRuns(client, {
    projectId: project.id,
    suiteId: testCase.suite_id,
    limit: 5,
  });

  // Each run is an independent lookup, so they go out together.
  const perRun = await mapWithConcurrency(runs, async (run) => {
    const { rows: tests, truncated } = await client.list<Test>(`get_tests/${run.id}`, 'tests', 2000);
    const test = tests.find((candidate) => candidate.case_id === testCase.id);

    if (!test) {
      if (truncated) {
        warnings.push(`Run ${run.id} has more than 2000 tests; C${testCase.id} may be in the part not read.`);
      }

      return undefined;
    }

    const results = await client
      .list<Result>(`get_results/${test.id}`, 'results', 1)
      .catch((): ListResult<Result> => {
        warnings.push(`Results for run ${run.id} could not be read; its comment and defects are blank.`);

        return { rows: [], truncated: false };
      });

    const latest = results.rows[0];

    return {
      runId: run.id,
      runName: run.name,
      status: meta.statusName(test.status_id),
      defects: latest?.defects ?? '',
      comment: htmlToText(latest?.comment ?? ''),
    };
  });

  return { history: perRun.filter((entry) => entry !== undefined), warnings };
}

export function formatCaseDetail(detail: CaseDetail): string {
  const lines: string[] = [
    `# C${detail.caseId} — ${detail.title}`,
    ...warningLines(detail),
    '',
    table(
      ['field', 'value'],
      [
        [
          'section',
          detail.sectionName ? `${detail.sectionName} (${detail.sectionId})` : String(detail.sectionId),
        ],
        ['priority', detail.priority],
        ['type', detail.type],
        ['refs', detail.refs ?? '—'],
        ['estimate', detail.estimate ?? '—'],
        ['template', detail.templateId ?? '—'],
        ['updated', detail.updated ?? '—'],
        ['link', detail.url],
      ],
    ),
  ];

  for (const entry of detail.richText) {
    lines.push('', `## ${entry.name}`, '', truncate(entry.text, 3000));
  }

  // Structured steps are an array; without this they land in the raw-JSON dump
  // below, and the steps are the point of the case.
  const structured = stepsTable(detail.structuredSteps);

  if (structured) lines.push('', '## steps (structured)', '', structured);

  if (detail.otherFields.length > 0) {
    lines.push(
      '',
      '## Other custom fields',
      '',
      table(
        ['field', 'value'],
        detail.otherFields.map((row) => [row.field, row.value]),
      ),
    );
  }

  if (detail.history.length > 0) {
    lines.push(
      '',
      '## Recent executions',
      '',
      table(
        ['run', 'run name', 'status', 'defects', 'comment'],
        detail.history.map((row) => [
          row.runId,
          clip(row.runName, 50),
          row.status,
          row.defects,
          clip(row.comment, 120),
        ]),
      ),
    );
  }

  return lines.join('\n');
}

/**
 * `get_case` names the case's suite, not its project, so the project comes from
 * the suite.
 */
async function projectOf(
  client: TestRailClient,
  testCase: Case,
): Promise<{ id: number; warning?: undefined } | { id: undefined; warning: string }> {
  if (testCase.suite_id == null) {
    return { id: undefined, warning: 'History skipped: the case names no suite to find its project from.' };
  }

  // History is context for the case, so a suite it cannot read means no history, not an error.
  const suite = await client
    .request<{ project_id: number }>(`get_suite/${testCase.suite_id}`)
    .catch(() => undefined);

  return suite
    ? { id: suite.project_id }
    : { id: undefined, warning: `History skipped: suite ${testCase.suite_id} could not be read.` };
}

const Text = z.string();

/**
 * A case's `custom_*` fields, which differ per instance. Text fields become
 * readable prose; anything else is kept as JSON so nothing is silently dropped.
 */
function customFields(testCase: Case): Pick<CaseDetail, 'richText' | 'otherFields'> {
  const richText: CaseDetail['richText'] = [];
  const otherFields: CaseDetail['otherFields'] = [];

  for (const [key, value] of Object.entries(testCase)) {
    if (!key.startsWith('custom_') || value === null || key === 'custom_steps_separated') continue;

    const text = Text.safeParse(value);

    if (!text.success) {
      otherFields.push({ field: key, value: JSON.stringify(value) });
      continue;
    }

    const readable = htmlToText(text.data);

    if (readable) richText.push({ name: key.replace(/^custom_/, '').replace(/_/g, ' '), text: readable });
  }

  return { richText, otherFields };
}
