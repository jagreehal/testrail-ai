import { resolveMeta, type ClientDeps, type TestRailDeps } from '../deps';
import {
  CaseWriteFieldsSchema,
  ReportResultsInputSchema,
  RunWriteFieldsSchema,
  type CaseWriteFields,
  type ReportResultsInput,
  type RunWriteFields,
  STATUS_IDS,
} from '../schemas';
import type { Case, Run, TestRailBody } from '../types';
import { z } from 'zod';

/**
 * The mutations, kept apart from the read paths so the boundary is obvious.
 *
 * Every one of these funnels through `client.request()`, which refuses when
 * writes are disabled — the gate is in the client, not repeated here, so a new
 * write cannot forget it.
 */

export type WriteOutcome = { id: number; title: string; url: string; changed: string[] };

const CreateCaseArgsSchema = z.object({
  sectionId: z.number().int().positive(),
  fields: CaseWriteFieldsSchema,
});

const UpdateCaseArgsSchema = z.object({ caseId: z.number().int().positive(), fields: CaseWriteFieldsSchema });

const CreateRunArgsSchema = z.object({
  projectId: z.number().int().positive(),
  fields: RunWriteFieldsSchema,
});

const UpdateRunArgsSchema = z.object({ runId: z.number().int().positive(), fields: RunWriteFieldsSchema });

const CloseRunArgsSchema = z.object({ runId: z.number().int().positive() });

/**
 * Only send what was actually supplied. TestRail's update endpoints treat a
 * present key as an instruction, so spreading undefined fields would blank out
 * everything the caller did not mention.
 */
export function caseBody(fields: CaseWriteFields): TestRailBody {
  fields = CaseWriteFieldsSchema.parse(fields);
  const body: TestRailBody = {};

  if (fields.title !== undefined) body.title = fields.title;

  if (fields.priority_id !== undefined) body.priority_id = fields.priority_id;

  if (fields.type_id !== undefined) body.type_id = fields.type_id;

  if (fields.refs !== undefined) body.refs = fields.refs;

  if (fields.estimate !== undefined) body.estimate = fields.estimate;

  if (fields.milestone_id !== undefined) body.milestone_id = fields.milestone_id;

  if (fields.template_id !== undefined) body.template_id = fields.template_id;

  if (fields.steps !== undefined) body.custom_steps = fields.steps;

  if (fields.preconditions !== undefined) body.custom_preconds = fields.preconditions;

  if (fields.expected !== undefined) body.custom_expected = fields.expected;

  // Structured steps live under a differently-named field, and TestRail wants
  // `expected` present on every row even when it is empty.
  if (fields.steps_separated !== undefined) {
    body.custom_steps_separated = fields.steps_separated.map((step) => ({
      content: step.content,
      expected: step.expected ?? '',
    }));
  }

  return { ...body, ...fields.custom_fields };
}

export function runBody(fields: RunWriteFields): TestRailBody {
  fields = RunWriteFieldsSchema.parse(fields);
  const body: TestRailBody = {};

  if (fields.name !== undefined) body.name = fields.name;

  if (fields.description !== undefined) body.description = fields.description;

  if (fields.suite_id !== undefined) body.suite_id = fields.suite_id;

  if (fields.milestone_id !== undefined) body.milestone_id = fields.milestone_id;

  if (fields.assignedto_id !== undefined) body.assignedto_id = fields.assignedto_id;

  if (fields.refs !== undefined) body.refs = fields.refs;

  if (fields.config_ids !== undefined) body.config_ids = fields.config_ids;

  // `case_ids` only means anything alongside include_all:false. An empty list is
  // kept: it asks for a run with no cases, not for every case in the suite.
  if (fields.case_ids !== undefined) {
    body.include_all = false;
    body.case_ids = fields.case_ids;
  } else if (fields.include_all !== undefined) {
    body.include_all = fields.include_all;
  }

  return body;
}

export async function createCase(
  args: { sectionId: number; fields: CaseWriteFields },
  deps: ClientDeps,
): Promise<WriteOutcome> {
  args = CreateCaseArgsSchema.parse(args);
  const { client } = deps;

  if (!args.fields.title) throw new Error('Creating a case needs a title.');
  const body = caseBody(args.fields);
  const created = await client.request<Case>(`add_case/${args.sectionId}`, body);

  return {
    id: created.id,
    title: created.title,
    url: client.link('case', created.id),
    changed: Object.keys(body),
  };
}

export async function updateCase(
  args: { caseId: number; fields: CaseWriteFields },
  deps: ClientDeps,
): Promise<WriteOutcome> {
  args = UpdateCaseArgsSchema.parse(args);
  const { client } = deps;
  const body = caseBody(args.fields);

  if (Object.keys(body).length === 0) throw new Error('Updating a case needs at least one field to change.');
  const updated = await client.request<Case>(`update_case/${args.caseId}`, body);

  return {
    id: updated.id,
    title: updated.title,
    url: client.link('case', updated.id),
    changed: Object.keys(body),
  };
}

export async function createRun(
  args: { projectId: number; fields: RunWriteFields },
  deps: ClientDeps,
): Promise<WriteOutcome> {
  args = CreateRunArgsSchema.parse(args);
  const { client } = deps;

  if (!args.fields.name) throw new Error('Creating a run needs a name.');
  const body = runBody(args.fields);
  const run = await client.request<Run>(`add_run/${args.projectId}`, body);

  return { id: run.id, title: run.name, url: client.link('run', run.id), changed: Object.keys(body) };
}

export async function updateRun(
  args: { runId: number; fields: RunWriteFields },
  deps: ClientDeps,
): Promise<WriteOutcome> {
  args = UpdateRunArgsSchema.parse(args);
  const { client } = deps;
  const body = runBody(args.fields);

  if (Object.keys(body).length === 0) throw new Error('Updating a run needs at least one field to change.');
  const run = await client.request<Run>(`update_run/${args.runId}`, body);

  return { id: run.id, title: run.name, url: client.link('run', args.runId), changed: Object.keys(body) };
}

/** Irreversible: TestRail archives the run and it can never be reopened. */
export async function closeRun(args: { runId: number }, deps: ClientDeps): Promise<WriteOutcome> {
  args = CloseRunArgsSchema.parse(args);
  const { client } = deps;
  const run = await client.request<Run>(`close_run/${args.runId}`, {});

  return { id: run.id, title: run.name, url: client.link('run', args.runId), changed: ['is_completed'] };
}

export type PostedResult = { resultId: number; testId: number; status: string };

export async function reportResults(args: ReportResultsInput, deps: TestRailDeps): Promise<PostedResult[]> {
  args = ReportResultsInputSchema.parse(args);
  const { client } = deps;
  const meta = await resolveMeta(deps);
  // TestRail rejects a posted result with status 3 — you cannot mark a test
  // untested, you remove the result instead. Say so rather than letting the API
  // return an opaque 400.
  const untested = args.results.filter((row) => row.status === 'untested');

  if (untested.length > 0) {
    throw new Error(
      `TestRail does not accept 'untested' as a posted result (cases ${untested
        .map((row) => row.case_id)
        .join(', ')}). Untested is the absence of a result, not a result.`,
    );
  }

  const payload = {
    results: args.results.map((row) => ({
      case_id: row.case_id,
      status_id: STATUS_IDS[row.status],
      ...(row.comment !== undefined && { comment: row.comment }),
      ...(row.defects !== undefined && { defects: row.defects }),
      ...(row.elapsed !== undefined && { elapsed: row.elapsed }),
      ...(row.version !== undefined && { version: row.version }),
      ...(row.assignedto_id !== undefined && { assignedto_id: row.assignedto_id }),
    })),
  };

  const posted = await client.request<{ id: number; test_id: number; status_id: number }[]>(
    `add_results_for_cases/${args.run_id}`,
    payload,
  );

  return posted.map((row) => ({
    resultId: row.id,
    testId: row.test_id,
    status: meta.statusName(row.status_id),
  }));
}
