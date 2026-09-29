/**
 * testrail-ai — TestRail, shaped for agents rather than for REST.
 *
 * Two layers, deliberately separate:
 *
 *   `get*`    fetch and join, returning plain typed data
 *   `format*` turn that data into markdown
 *
 * The MCP server calls both. The CLI calls `get*` alone for `--json` and both
 * for human output. Anyone building something else gets the data layer without
 * inheriting our presentation choices — which is the whole reason this is a
 * package and not just an MCP server with files in it.
 */

export { sharedClient, TestRailClient, TestRailError } from './client';

export type { ListResult } from './client';

export { loadConfig } from './config';

export type { Config } from './config';

export type { ClientDeps, TestRailDeps } from './deps';

export { loadMeta } from './meta';

export type { Meta } from './meta';

export { hasRun, isNotPassing, runCounts, statusKind } from './status';

export type { RunCounts, StatusKind } from './status';

export { completeness } from './completeness';

export type { Completeness } from './completeness';

export { recentRuns } from './analysis/runs';

export * from './schemas';

export * from './types';

export { formatSearch, search } from './analysis/search';

export type { SearchResult } from './analysis/search';

export { formatRunReport, getRunReport } from './analysis/run-report';

export type { FailureCluster, RunReport } from './analysis/run-report';

export { formatFailures, getFailures } from './analysis/failures';

export type { FailureDetail, FailuresReport } from './analysis/failures';

export { formatStability, getStability } from './analysis/stability';

export type { CaseStability, StabilityReport } from './analysis/stability';

export { formatCoverage, getCoverage } from './analysis/coverage';

export type { CoverageReport, CoverageRow } from './analysis/coverage';

export { formatCaseDetail, getCaseDetail } from './analysis/case-detail';

export type { CaseDetail } from './analysis/case-detail';

export { closeRun, createCase, createRun, reportResults, updateCase, updateRun } from './write/index';

export type { PostedResult, WriteOutcome } from './write/index';
