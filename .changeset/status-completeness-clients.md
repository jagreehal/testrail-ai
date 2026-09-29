---
'testrail-ai': minor
'testrail-ai-mcp': patch
---

Every tool reads a status the same way. `statusKind` sorts a status into passed, failed, unsettled or untested, and the run report, coverage and stability all use it, so a custom status counts the same everywhere. `runCounts`, `hasRun` and `isNotPassing` are exported alongside it.

Every report carries `complete` and `warnings`. A row cap, a skipped page, plans that could not be read or a section or suite that could not be read each become a warning. This replaces `truncated` on the run, failures and coverage reports and on search results; a search's `note` now holds guidance only.

`sharedClient(config)` keeps one client per configuration, so reference data loads once per credential rather than once per request. `buildServer` uses it by default.

Custom fields, step results and write bodies are typed as `Json`, and `parseSteps` decodes structured steps. `recentRuns` and `completeness` are exported.
