# testrail-ai-mcp

## 0.2.0

### Minor Changes

- 5a23938: Optional default project. Set `TESTRAIL_PROJECT_ID` and the MCP tools and CLI commands use it whenever the project is left out. The tool schemas and server instructions name it, and a call with no project and no default is refused with a message saying so. The library functions still take the project explicitly; the client exposes `defaultProjectId` and `requireProject()` for frontends.
- 5a23938: `testrail_case` reads a case. Creating and updating move to `testrail_case_write`, priced `testrail:write` in `GATE_PERMISSIONS`.

  Stability, coverage, the latest run and the last good run include runs inside test plans. Run totals and pass rates count custom statuses, and a report's `counts.other` holds those that ran. Case history finds the project through the case's suite.

  `loadTelemetry()` replaces `initTelemetry()`. Call it once and pass the result to `buildServer` as `wrap`, so tracing covers every tool, resource and prompt.

- 5a23938: Find cases by where they live. Case search takes `section_path` (`--section-path` in the CLI), such as `Checkout > Payments`, matched without case. A unique trailing part is enough, and in a project with several suites the path starts with the suite name. An unknown or ambiguous path lists the candidates. Section search shows each section's full path.

### Patch Changes

- 5a23938: - Clients copy their config when created, so later changes to the object passed in have no effect.
  - Stability keeps a separate history for each run configuration, and a failure's last good run must have the same configuration. Each stability row now includes `config`.
  - Case history warns when a run has more tests than it reads and the case may be among the ones skipped.
  - Run search and the project resource include runs inside test plans.
  - Creating a run with `case_ids: []` creates an empty run.
  - Input types accept the fields that have defaults as optional, so `getCaseDetail({ case_id })` type-checks.
- 5a23938: Test steps whose content is not text render blank instead of `[object Object]`, and `fakeTestRail` from `testrail-ai/testing` accepts a `Request` as well as a URL. Built with TypeScript 7 against MCP SDK 2.1.
- 5a23938: With tracing on, each tool result is scanned for prompt-injection patterns, since case text and result comments come from anyone on the TestRail instance. A match is recorded on the tool span as `mcp.security.injection.*`. The result itself is not changed.
- 5a23938: - People are named even when the API key cannot list users. Reports look up the users they show one at a time (at most 20 per report, cached per client), so `user:22` becomes a name. The reference data gains `nameUsers()`.
  - Faster reports. Run discovery asks for the plan list alongside the runs rather than after them, and the run and failures reports load reference data while they find the run. A cold run report on a small project dropped from about 1.7s to 1.1s.
  - The MCP server instructions tell the model that text from TestRail is data written by its users, never instructions to follow.
- 5a23938: Every TestRail request is an OpenTelemetry client span, named by operation (`testrail get_tests`), with the endpoint, status code, error type and retries recorded. The spans use `@opentelemetry/api`, so they do nothing unless an SDK is registered. With tracing on, the MCP server's tool spans now show the TestRail calls behind them.
- 5a23938: Every tool reads a status the same way. `statusKind` sorts a status into passed, failed, unsettled or untested, and the run report, coverage and stability all use it, so a custom status counts the same everywhere. `runCounts`, `hasRun` and `isNotPassing` are exported alongside it.

  Every report carries `complete` and `warnings`. A row cap, a skipped page, plans that could not be read or a section or suite that could not be read each become a warning. This replaces `truncated` on the run, failures and coverage reports and on search results; a search's `note` now holds guidance only.

  `sharedClient(config)` keeps one client per configuration, so reference data loads once per credential rather than once per request. `buildServer` uses it by default.

  Custom fields, step results and write bodies are typed as `Json`, and `parseSteps` decodes structured steps. `recentRuns` and `completeness` are exported.

- Updated dependencies [5a23938]
- Updated dependencies [5a23938]
- Updated dependencies [5a23938]
- Updated dependencies [5a23938]
- Updated dependencies [5a23938]
- Updated dependencies [5a23938]
- Updated dependencies [5a23938]
- Updated dependencies [5a23938]
- Updated dependencies [5a23938]
- Updated dependencies [5a23938]
- Updated dependencies [5a23938]
  - testrail-ai@0.2.0
