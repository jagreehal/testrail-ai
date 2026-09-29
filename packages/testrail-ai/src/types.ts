/**
 * Only the fields this server actually reads. TestRail returns far more —
 * including an open-ended set of `custom_*` keys that differ per instance —
 * so every entity carries an index signature rather than pretending to be closed.
 */

/** A value TestRail sent as JSON. Everything it returns parses to one of these. */
export type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

type Custom = Record<string, Json>;

/** A JSON body sent to a TestRail write endpoint. */
export type TestRailBody = { [field: string]: Json };

export type Project = Custom & {
  id: number;
  name: string;
  /** 1 = single suite, 2 = single + baselines, 3 = multiple suites. */
  suite_mode: number;
  is_completed: boolean;
};

export type Suite = Custom & { id: number; name: string; description: string | null };

export type Section = Custom & {
  id: number;
  name: string;
  parent_id: number | null;
  suite_id: number | null;
};

export type Case = Custom & {
  id: number;
  title: string;
  section_id: number;
  suite_id: number | null;
  type_id: number;
  priority_id: number;
  refs: string | null;
  estimate: string | null;
  milestone_id: number | null;
  updated_on: number | null;
  created_on: number | null;
  /** 1 text, 2 steps, 3 exploratory; absent on instances that predate templates. */
  template_id?: number | null;
  is_deleted?: number;
};

export type Run = Custom & {
  id: number;
  name: string;
  description: string | null;
  project_id: number;
  suite_id: number | null;
  milestone_id: number | null;
  is_completed: boolean;
  completed_on: number | null;
  created_on: number;
  created_by: number;
  /** The configuration's display name, e.g. `Chrome, Windows`. Set for plan runs. */
  config: string | null;
  /** The configuration's ids. Unlike `config`, unchanged when a configuration is renamed. */
  config_ids?: number[] | null;
  passed_count: number;
  failed_count: number;
  blocked_count: number;
  untested_count: number;
  retest_count: number;
  /** Set when the run belongs to a test plan. */
  plan_id?: number | null;
  /** One count per custom status: `custom_status1_count` is status id 6, up to 7 → id 12. */
  custom_status1_count?: number;
  custom_status2_count?: number;
  custom_status3_count?: number;
  custom_status4_count?: number;
  custom_status5_count?: number;
  custom_status6_count?: number;
  custom_status7_count?: number;
};

export type Test = Custom & {
  id: number;
  case_id: number;
  run_id?: number;
  status_id: number;
  title: string;
  assignedto_id: number | null;
};

export type Result = Custom & {
  id: number;
  test_id: number;
  status_id: number | null;
  comment: string | null;
  defects: string | null;
  elapsed: string | null;
  version: string | null;
  created_on: number;
  created_by: number;
};

export type Plan = Custom & {
  id: number;
  name: string;
  is_completed: boolean;
  created_on: number;
  milestone_id: number | null;
};

export type Milestone = Custom & {
  id: number;
  name: string;
  is_completed: boolean;
  due_on: number | null;
};

export type User = Custom & { id: number; name: string; email: string };

/**
 * One row of a Steps-template case: the step itself, and — once executed — what
 * actually happened. TestRail stores these under `custom_steps_separated` on the
 * case and `custom_step_results` on the result, with the same shape.
 */
/** One structured step, decoded by `parseSteps`: a cell that is not text is left out. */
export type StepResult = {
  content?: string;
  expected?: string;
  actual?: string;
  status_id?: number;
};

export type Status = Custom & {
  id: number;
  name: string;
  label: string;
  is_final: boolean;
  is_untested: boolean;
};

export type CaseType = Custom & { id: number; name: string };

export type Priority = Custom & { id: number; name: string; short_name: string };
