---
'testrail-ai': minor
'testrail-ai-mcp': minor
'testrail-ai-cli': minor
---

Optional default project. Set `TESTRAIL_PROJECT_ID` and the MCP tools and CLI commands use it whenever the project is left out. The tool schemas and server instructions name it, and a call with no project and no default is refused with a message saying so. The library functions still take the project explicitly; the client exposes `defaultProjectId` and `requireProject()` for frontends.
