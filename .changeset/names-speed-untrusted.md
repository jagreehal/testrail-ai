---
'testrail-ai': minor
'testrail-ai-mcp': patch
---

- People are named even when the API key cannot list users. Reports look up the users they show one at a time (at most 20 per report, cached per client), so `user:22` becomes a name. The reference data gains `nameUsers()`.
- Faster reports. Run discovery asks for the plan list alongside the runs rather than after them, and the run and failures reports load reference data while they find the run. A cold run report on a small project dropped from about 1.7s to 1.1s.
- The MCP server instructions tell the model that text from TestRail is data written by its users, never instructions to follow.
