---
'testrail-ai': minor
'testrail-ai-mcp': patch
---

Every TestRail request is an OpenTelemetry client span, named by operation (`testrail get_tests`), with the endpoint, status code, error type and retries recorded. The spans use `@opentelemetry/api`, so they do nothing unless an SDK is registered. With tracing on, the MCP server's tool spans now show the TestRail calls behind them.
