import { appendQuery, type ListResult, type TestRailClient } from '../client';
import { mapWithConcurrency } from '../concurrency';
import type { Run } from '../types';

type Plan = { id: number; entries?: { runs?: Run[] }[] };

/**
 * Which configuration a run tested, for telling one configuration's history
 * from another's. Built from `config_ids`, so renaming a configuration does not
 * split its history; the display name is the fallback when ids are missing.
 */
export function configKey(run: Pick<Run, 'config' | 'config_ids'>): string {
  return run.config_ids?.length
    ? `ids:${run.config_ids.toSorted((a, b) => a - b).join(',')}`
    : `name:${run.config ?? ''}`;
}

/**
 * How many plans the fallback reads. A plan can gain a run long after it was
 * created, so no date says which older plans are safe to skip; past this many,
 * the result says what it left out.
 */
const PLAN_LIMIT = 25;

/**
 * A project's most recent runs, newest first, including runs that belong to a
 * test plan.
 *
 * `get_runs` leaves plan runs out unless asked with `include_plan_runs=1`, and a
 * team that organises work in plans would otherwise see missing history and
 * false coverage gaps. Instances that predate the flag ignore it, so when the
 * project has plans and none of their runs came back, this reads the most recent
 * plans directly and merges what it finds.
 */
export async function recentRuns(
  client: TestRailClient,
  args: {
    projectId: number;
    suiteId?: number | null;
    milestoneId?: number;
    isCompleted?: boolean;
    createdAfter?: number;
    createdBefore?: number;
    limit: number;
  },
): Promise<ListResult<Run> & { warnings: string[] }> {
  const filters = [
    args.suiteId ? `suite_id=${args.suiteId}` : '',
    args.milestoneId === undefined ? '' : `milestone_id=${args.milestoneId}`,
    args.isCompleted === undefined ? '' : `is_completed=${args.isCompleted ? 1 : 0}`,
    args.createdAfter === undefined ? '' : `created_after=${args.createdAfter}`,
    args.createdBefore === undefined ? '' : `created_before=${args.createdBefore}`,
  ].filter(Boolean);

  // The plan list is asked for alongside the runs, not after them: when it is
  // needed, which is whenever no plan run came back, waiting for the runs first
  // added a full round trip to every report. When it is not needed, it is one
  // spare request.
  const planList = client.list<Plan>(
    appendQuery(
      `get_plans/${args.projectId}`,
      // A plan's runs are never older than the plan, so an upper bound on the
      // plan is safe. A lower bound is not: an old plan can gain new runs.
      [
        args.milestoneId === undefined ? '' : `milestone_id=${args.milestoneId}`,
        args.createdBefore === undefined ? '' : `created_before=${args.createdBefore}`,
      ]
        .filter(Boolean)
        .join('&'),
    ),
    'plans',
    Math.max(args.limit, PLAN_LIMIT),
  );

  // Its failure is handled below when it is used, and irrelevant when it is not.
  planList.catch(() => undefined);

  const direct = await client.list<Run>(
    appendQuery(`get_runs/${args.projectId}`, [...filters, 'include_plan_runs=1'].join('&')),
    'runs',
    args.limit,
  );

  if (direct.rows.some((run) => run.plan_id != null)) return { ...direct, warnings: [] };

  // Plan runs are a supplement: if the plans cannot be read, the standalone runs
  // still answer, and the report says what it could not include.
  let details: Plan[];
  let plansTruncated: boolean;

  try {
    const plans = await planList;

    if (plans.rows.length === 0) return { ...direct, warnings: [] };
    plansTruncated = plans.truncated;
    details = await mapWithConcurrency(plans.rows, (plan) => client.request<Plan>(`get_plan/${plan.id}`));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    return {
      ...direct,
      warnings: [`Runs inside test plans could not be read (${reason}); only standalone runs are included.`],
    };
  }

  const planRuns = details
    .flatMap((plan) => plan.entries ?? [])
    .flatMap((entry) => entry.runs ?? [])
    // The same filters `get_runs` applied, since plan runs were not filtered by it.
    .filter((run) => !args.suiteId || run.suite_id === args.suiteId)
    .filter((run) => args.milestoneId === undefined || run.milestone_id === args.milestoneId)
    .filter((run) => args.isCompleted === undefined || run.is_completed === args.isCompleted)
    .filter((run) => args.createdAfter === undefined || run.created_on >= args.createdAfter)
    .filter((run) => args.createdBefore === undefined || run.created_on < args.createdBefore);

  const byId = new Map([...direct.rows, ...planRuns].map((run) => [run.id, run]));
  const merged = [...byId.values()].toSorted((a, b) => b.created_on - a.created_on);

  return {
    rows: merged.slice(0, args.limit),
    truncated: direct.truncated || plansTruncated || merged.length > args.limit,
    warnings: plansTruncated
      ? [
          `Read runs from the ${Math.max(args.limit, PLAN_LIMIT)} most recent test plans; older plans were not read.`,
        ]
      : [],
  };
}
