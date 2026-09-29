import { z } from 'zod';
import type { Json, StepResult } from './types';

const IdSchema = z.number().int().positive();

/**
 * One set of input schemas, used by both frontends.
 *
 * This is the reason the core package exists. The MCP server feeds these
 * straight to `registerTool` as tool schemas; the CLI parses flags and validates
 * against the same objects. A new filter is added once and both frontends get
 * it, with identical validation and identical error messages — there is no
 * second definition to drift.
 */

export const EntitySchema = z.enum([
  'projects',
  'suites',
  'sections',
  'cases',
  'runs',
  'plans',
  'milestones',
  'tests',
]);

export type Entity = z.infer<typeof EntitySchema>;

export const SearchInputSchema = z.object({
  entity: EntitySchema.describe('What to look for'),
  project_id: IdSchema.optional().describe('Required for everything except projects and tests'),
  run_id: IdSchema.optional().describe('Required when entity is tests'),
  suite_id: IdSchema.optional().describe('Narrow cases/sections to one suite (multi-suite projects only)'),
  section_id: IdSchema.optional().describe('Narrow cases to one section'),
  section_path: z
    .string()
    .optional()
    .describe(
      "Cases only: the section by its names, top level first, e.g. 'Checkout > Payments'. " +
        'In a project with several suites, start with the suite name. ' +
        'An alternative to section_id; a unique trailing part is enough.',
    ),
  query: z.string().optional().describe('Substring match on the title or name, case-insensitive'),
  priority_id: z.number().int().min(1).max(4).optional().describe('Cases only: 1 Low … 4 Critical'),
  type_id: IdSchema.optional().describe('Cases only'),
  refs: z
    .string()
    .optional()
    .describe("Cases only: the reference/requirement a case links to, e.g. 'JIRA-1234'"),
  label_id: z.array(IdSchema).optional().describe('Cases only: match any of these label ids'),
  status_id: z
    .array(IdSchema)
    .optional()
    .describe('Tests only: 1 passed, 2 blocked, 3 untested, 4 retest, 5 failed'),
  milestone_id: IdSchema.optional().describe('Runs and plans only'),
  is_completed: z.boolean().optional().describe('Runs, plans and milestones: filter on completion'),
  created_after: z.string().optional().describe("ISO date, or a relative offset like '7d' / '24h' / '2w'"),
  updated_after: z.string().optional().describe('Cases only. Same formats as created_after'),
  limit: z.number().int().min(1).max(1000).default(50).describe('Maximum rows to return'),
});

export type SearchInput = z.input<typeof SearchInputSchema>;

export const RunReportInputSchema = z.object({
  run_id: IdSchema.optional().describe(
    'The run to report on. Omit to take the most recent run in project_id.',
  ),
  project_id: IdSchema.optional().describe('Used with no run_id to pick the latest run'),
  include_passed: z.boolean().default(false).describe('List passing tests too'),
});

export type RunReportInput = z.input<typeof RunReportInputSchema>;

export const FailuresInputSchema = z.object({
  run_id: IdSchema.describe('The run to inspect'),
  include_last_good: z
    .boolean()
    .default(false)
    .describe('Look back through earlier runs for the last pass of each failing case. Slower.'),
  lookback_runs: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(10)
    .describe('How many earlier runs to search when include_last_good is set'),
  limit: z.number().int().min(1).max(200).default(50).describe('Maximum failures to report'),
});

export type FailuresInput = z.input<typeof FailuresInputSchema>;

export const StabilityInputSchema = z.object({
  project_id: IdSchema.describe('Project to analyse'),
  suite_id: IdSchema.optional().describe('Restrict to one suite'),
  runs: z.number().int().min(2).max(25).default(10).describe('How many recent runs to compare'),
  min_flips: z
    .number()
    .int()
    // Floored at 2 deliberately: one transition is a regression or a fix, never
    // flakiness. Those get their own sections in the result.
    .min(2)
    .default(2)
    .describe('Minimum pass↔fail transitions before a case counts as flaky. Minimum 2.'),
});

export type StabilityInput = z.input<typeof StabilityInputSchema>;

export const CoverageInputSchema = z.object({
  project_id: IdSchema.describe('Project to analyse'),
  suite_id: IdSchema.optional().describe('Restrict to one suite'),
  run_id: IdSchema.optional().describe('Compare the suite against this run'),
  recent_runs: z
    .number()
    .int()
    .min(0)
    .max(25)
    .default(5)
    .describe('How many recent runs count as "recently executed". 0 skips that check.'),
  refs: z.array(z.string()).optional().describe('Requirement keys to check for a covering case'),
  limit: z.number().int().min(1).max(2000).default(500).describe('Maximum cases to read'),
});

export type CoverageInput = z.input<typeof CoverageInputSchema>;

export const CaseDetailInputSchema = z.object({
  case_id: IdSchema.describe('The case to read'),
  include_history: z.boolean().default(true).describe('Include recent execution results'),
});

export type CaseDetailInput = z.input<typeof CaseDetailInputSchema>;

/* ------------------------------------------------------------------- writes */

export const CaseWriteFieldsSchema = z.object({
  title: z.string().optional().describe('Case title'),
  priority_id: z.number().int().min(1).max(4).optional().describe('1 Low … 4 Critical'),
  type_id: IdSchema.optional().describe('Case type'),
  refs: z.string().optional().describe('Comma-separated requirement references'),
  estimate: z.string().optional().describe("TestRail duration, e.g. '30s', '5min', '1h 30m'"),
  milestone_id: IdSchema.optional().describe('Milestone to attach the case to'),
  steps: z.string().optional().describe('Test steps as plain text or markdown'),
  preconditions: z.string().optional().describe('Preconditions as plain text or markdown'),
  expected: z.string().optional().describe('Expected result as plain text or markdown'),
  template_id: z
    .number()
    .int()
    .optional()
    .describe('1 = Text (plain `steps`), 2 = Steps (structured `steps_separated`)'),
  steps_separated: z
    .array(
      z.object({
        content: z.string().describe('What the tester does'),
        expected: z.string().optional().describe('What should happen'),
      }),
    )
    .optional()
    .describe('Structured steps. Requires the matching template, usually template_id 2.'),
  custom_fields: z
    .record(z.string().regex(/^custom_/, 'Custom field names must start with custom_'), z.json())
    .optional()
    .describe('Instance-specific fields, keyed exactly as TestRail names them (custom_…)'),
});

export type CaseWriteFields = z.infer<typeof CaseWriteFieldsSchema>;

export const RunWriteFieldsSchema = z.object({
  name: z.string().optional().describe('Run name'),
  description: z.string().optional().describe('Run description'),
  suite_id: IdSchema.optional().describe('Required for multi-suite projects'),
  milestone_id: IdSchema.optional().describe('Milestone to attach the run to'),
  assignedto_id: IdSchema.optional().describe('User to assign the run to'),
  refs: z.string().optional().describe('Comma-separated requirement references'),
  config_ids: z.array(IdSchema).optional().describe('Configuration ids, for a plan entry'),
  case_ids: z.array(IdSchema).optional().describe('Limit the run to these cases'),
  include_all: z.boolean().optional().describe('True includes every case in the suite'),
});

export type RunWriteFields = z.infer<typeof RunWriteFieldsSchema>;

export const ResultStatusSchema = z.enum(['passed', 'blocked', 'untested', 'retest', 'failed']);

export const ReportResultsInputSchema = z.object({
  run_id: IdSchema.describe('The run to post into'),
  results: z
    .array(
      z.object({
        case_id: IdSchema.describe('The case being reported on'),
        status: ResultStatusSchema.describe('Outcome'),
        comment: z.string().optional().describe('What happened — failure output, notes'),
        defects: z.string().optional().describe('Comma-separated defect ids, e.g. JIRA keys'),
        elapsed: z.string().optional().describe("Duration, e.g. '30s' or '2m 15s'"),
        version: z.string().optional().describe('Build or version under test'),
        assignedto_id: IdSchema.optional().describe('Reassign the test'),
      }),
    )
    .min(1)
    .max(500)
    .describe('One entry per case'),
});

export type ReportResultsInput = z.infer<typeof ReportResultsInputSchema>;

export const RawInputSchema = z.object({
  endpoint: z.string().min(1).describe("Path after /api/v2/, e.g. 'get_shared_steps/5'"),
  body: z.record(z.string(), z.json()).optional().describe('JSON body; makes the call a POST'),
  max_chars: z.number().int().min(500).max(100_000).default(20_000).describe('Truncate the JSON'),
});

export type RawInput = z.input<typeof RawInputSchema>;

/** TestRail's numeric status ids, by the name people actually say. */
export const STATUS_IDS: Record<z.infer<typeof ResultStatusSchema>, number> = {
  passed: 1,
  blocked: 2,
  untested: 3,
  retest: 4,
  failed: 5,
};

const optionalText = z.string().optional().catch(undefined);

const StepResultSchema = z.object({
  content: optionalText,
  expected: optionalText,
  actual: optionalText,
  status_id: z.number().int().optional().catch(undefined),
});

/**
 * Decode `custom_steps_separated` or `custom_step_results`. TestRail stores these
 * per instance and a template can leave them out or fill a cell with something
 * other than text, so a malformed cell is dropped and a malformed field reads as
 * no steps, rather than failing the whole case.
 */
export function parseSteps(value: Json | undefined): StepResult[] | undefined {
  const parsed = z.array(StepResultSchema.catch({})).safeParse(value);

  return parsed.success && parsed.data.length > 0 ? parsed.data : undefined;
}
