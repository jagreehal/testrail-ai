# testrail-ai-cli

## 0.2.1

### Patch Changes

- Updated dependencies [54917b8]
  - testrail-ai@0.2.1

## 0.2.0

### Minor Changes

- 5a23938: Optional default project. Set `TESTRAIL_PROJECT_ID` and the MCP tools and CLI commands use it whenever the project is left out. The tool schemas and server instructions name it, and a call with no project and no default is refused with a message saying so. The library functions still take the project explicitly; the client exposes `defaultProjectId` and `requireProject()` for frontends.
- 5a23938: Find cases by where they live. Case search takes `section_path` (`--section-path` in the CLI), such as `Checkout > Payments`, matched without case. A unique trailing part is enough, and in a project with several suites the path starts with the suite name. An unknown or ambiguous path lists the candidates. Section search shows each section's full path.

### Patch Changes

- 5a23938: Test steps whose content is not text render blank instead of `[object Object]`, and `fakeTestRail` from `testrail-ai/testing` accepts a `Request` as well as a URL. Built with TypeScript 7 against MCP SDK 2.1.
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
