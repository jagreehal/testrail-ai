---
'testrail-ai-mcp': patch
---

With tracing on, each tool result is scanned for prompt-injection patterns, since case text and result comments come from anyone on the TestRail instance. A match is recorded on the tool span as `mcp.security.injection.*`. The result itself is not changed.
