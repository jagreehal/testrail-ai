/**
 * Written the way someone using the published packages would write it. It is
 * type-checked against the built declarations with strict `nodenext`
 * resolution, so a broken export map, a missing type or an unresolvable
 * declaration fails here rather than in someone else's build.
 */
import { gate } from 'mcp-authz';
import {
  completeness,
  formatRunReport,
  getCaseDetail,
  getRunReport,
  loadConfig,
  recentRuns,
  runCounts,
  search,
  sharedClient,
  statusKind,
  TestRailError,
  type Completeness,
  type Config,
  type Json,
  type RunReport,
  type StatusKind,
  type TestRailBody,
} from 'testrail-ai';
import { stepsTable, table } from 'testrail-ai/advanced';
import { fakeTestRail, page, sentBody, TEST_CONFIG, type Route } from 'testrail-ai/testing';
import { buildServer, GATE_PERMISSIONS, loadTelemetry, type GatePermission } from 'testrail-ai-mcp';

export function configFrom(env: Record<string, string | undefined>): Config {
  return loadConfig(env);
}

export async function passRate(config: Config, runId: number): Promise<number | null> {
  const report: RunReport = await getRunReport(
    // Only the required fields: the schema supplies every default.
    { run_id: runId },
    { client: sharedClient(config) },
  );

  const checked: Completeness = report;

  return checked.complete ? report.passRate : null;
}

export async function minimalCalls(config: Config): Promise<boolean> {
  const client = sharedClient(config);

  const [detail, found] = await Promise.all([
    getCaseDetail({ case_id: 1 }, { client }),
    search({ entity: 'projects' }, { client }),
  ]);

  return detail.complete && found.complete;
}

export function kinds(ids: number[]): StatusKind[] {
  return ids.map((id) => statusKind(id, new Map()));
}

export async function latestRunIds(config: Config): Promise<number[]> {
  const { rows, warnings } = await recentRuns(sharedClient(config), { projectId: 1, limit: 5 });

  return warnings.length === 0 ? rows.map((run) => run.id) : [];
}

export const body: TestRailBody = { title: 'Case', custom_fields: { custom_owner: ['qa'] } };

export const value: Json = sentBody(undefined);

export const warnings = completeness('capped', false, undefined).warnings;

export const routes = { get_projects: page('projects', [{ id: 1, name: 'Core' }]) } satisfies Record<
  string,
  Route
>;

export const fake = fakeTestRail(routes, { allowWrites: false });

export const rendered: string = table(['a'], [['b']]) + (stepsTable([{ content: 'Open' }]) ?? '');

export function describeError(cause: unknown): string {
  return cause instanceof TestRailError ? `${cause.status} on ${cause.endpoint}` : 'unknown';
}

export const formatted: (report: RunReport) => string = formatRunReport;

export const totals = runCounts.length;

export async function gatedServer(principal: Parameters<typeof gate<GatePermission>>[1]) {
  const instrument = await loadTelemetry();

  return buildServer(TEST_CONFIG, {
    client: fake.client,
    wrap: (server) => gate(instrument ? instrument(server) : server, principal, GATE_PERMISSIONS),
  });
}
