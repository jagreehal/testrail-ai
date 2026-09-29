/**
 * Permission map for `gate()` from mcp-authz.
 *
 * Every capability this package registers must appear here. `gate()` throws on
 * an unpriced registration, so a partial map fails at boot rather than leaving
 * a tool reachable by everyone (or by nobody) with nothing in the logs.
 *
 * Labels match mcp-authz: bare tool names, `prompt:…`, `resource:…` keyed by the
 * name passed to `registerResource` / `registerPrompt`.
 *
 * `testrail_case` only reads; creating and updating live in `testrail_case_write`,
 * priced as write. `TESTRAIL_ALLOW_WRITES=true` is the blast-radius control for
 * the credential; this map is who may see which tools when writes are on.
 * `testrail_raw` is admin: it can reach anything the other tools do not cover.
 */
export const GATE_PERMISSIONS = {
  testrail_search: 'testrail:read',
  testrail_run_report: 'testrail:read',
  testrail_failures: 'testrail:read',
  testrail_flaky: 'testrail:read',
  testrail_coverage: 'testrail:read',
  testrail_case: 'testrail:read',
  testrail_case_write: 'testrail:write',
  testrail_run: 'testrail:write',
  testrail_report_result: 'testrail:write',
  testrail_raw: 'testrail:admin',
  'prompt:triage_run': 'testrail:read',
  'prompt:regression_summary': 'testrail:read',
  'prompt:coverage_gap': 'testrail:read',
  'resource:projects': 'testrail:read',
  'resource:meta': 'testrail:read',
  'resource:project': 'testrail:read',
  'resource:run': 'testrail:read',
} as const;

export type GatePermission = (typeof GATE_PERMISSIONS)[keyof typeof GATE_PERMISSIONS];
