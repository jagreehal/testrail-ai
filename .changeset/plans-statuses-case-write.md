---
'testrail-ai': patch
'testrail-ai-mcp': minor
---

`testrail_case` reads a case. Creating and updating move to `testrail_case_write`, priced `testrail:write` in `GATE_PERMISSIONS`.

Stability, coverage, the latest run and the last good run include runs inside test plans. Run totals and pass rates count custom statuses, and a report's `counts.other` holds those that ran. Case history finds the project through the case's suite.

`loadTelemetry()` replaces `initTelemetry()`. Call it once and pass the result to `buildServer` as `wrap`, so tracing covers every tool, resource and prompt.
