# User Stories

## src/gate.story.test.ts

### Gating this server per person with mcp-authz

### ✅ gives a reader the six read tools and none of the mutating ones

Tags: `authorization`, `mcp`

- **Given** a reader, gated with the exported permission map
- **When** the tool list is requested
  **Dana's catalogue**

  | Tool                   | Visible |
  | ---------------------- | ------- |
  | testrail_search        | true    |
  | testrail_run_report    | true    |
  | testrail_failures      | true    |
  | testrail_flaky         | true    |
  | testrail_coverage      | true    |
  | testrail_case          | true    |
  | testrail_case_write    | false   |
  | testrail_run           | false   |
  | testrail_report_result | false   |
  | testrail_raw           | false   |

- **Then** she sees the six priced testrail:read
- **And** the write tools and the admin escape hatch are absent, not merely refused
  > Absent matters twice: ten schemas cost context on every turn, and a tool the model can see is a tool it will try, burn a turn on, and route around.

### ✅ refuses the call even when a client names a tool it was never shown

Tags: `authorization`, `mcp`, `safety`

- **Given** a reader who skips the list and calls the write tool directly
- **When** she calls testrail_report_result
- **Then** the SDK refuses it, so hiding the tool was never the security boundary

### ✅ keeps a reader to reading a case, even with writes on

Tags: `authorization`, `mcp`, `safety`

- **Given** a reader, on a server whose credential may write
- **When** she asks testrail_case to update C101
- **Then** she gets the case back, and TestRail receives no update
- **And** the tool that writes cases refuses her

### ✅ widens the catalogue with the permissions, and only the escape hatch needs admin

Tags: `authorization`, `mcp`

- **Given** an editor and an admin against the same server
- **When** each lists tools
  **Catalogue by role**

  | Role   | Tools |
  | ------ | ----- |
  | reader | 6     |
  | editor | 9     |
  | admin  | 10    |

- **Then** the editor adds the three write tools but not testrail_raw
- **And** only the admin reaches anything the other nine tools do not cover

### ✅ fails the boot rather than serve a capability nobody priced

Tags: `authorization`, `mcp`, `safety`

- **Given** a connector whose permission map has drifted from the tools
- **When** it builds the server
- **Then** gate() throws, naming the tool, instead of guessing
  > This is why SECURITY.md can call the map the boundary: a tool added upstream without a price stops the deployment, rather than defaulting to everyone or to nobody in silence.

## src/http.story.test.ts

### The HTTP entry point

### ✅ answers /health with the instance and write switch, hardened headers included

Tags: `http`

- **Given** the built server on a free loopback port
- **When** /health is requested
  **/health**

  ```json
  {
    "ok": true,
    "testrail": "https://example.testrail.io",
    "writes": false
  }
  ```

- **Then** it is 200 JSON naming the instance, with writes off

### ✅ 404s any path other than /mcp and /health

Tags: `http`

- **Given** a running server
- **When** /admin is requested
- **Then** it is Not Found

### ✅ refuses a non-localhost Host, the DNS rebinding guard

Tags: `http`, `security`

- **Given** a running server
- **When** a request arrives addressed to evil.example
- **Then** it is refused before reaching any route

### ✅ refuses a cross-site Origin

Tags: `http`, `security`

- **Given** a running server
- **When** a web page on another origin calls it
- **Then** it is refused

### ✅ exits non-zero on an invalid PORT

Tags: `config`, `http`

- **Given** PORT=70000
- **Then** it exits non-zero, naming the bad value

### ✅ exits 1 with setup instructions when TestRail is not configured

Tags: `config`, `http`

- **Given** no TESTRAIL_* variables
- **Then** it exits 1 and says which variables to set

### ✅ drains and exits 0 on SIGTERM

Tags: `http`, `lifecycle`

- **Given** a running server
- **When** it receives SIGTERM
- **Then** it logs the drain and exits cleanly

## src/prompts.story.test.ts

### QA workflow prompts

### ✅ triage_run walks the model through report, failures and case detail for one run

Tags: `mcp`, `prompts`

- **Given** a connected client
- **When** triage_run is requested for run 612
  **Prompt**

  ```markdown
  Triage TestRail run 612.

  Do this in order:

  1. `testrail_run_report` with run_id 612 — read the totals and the failure clusters.
  2. `testrail_failures` with run_id 612 and include_last_good true — get the comments, defects, and when each case last passed.
  3. For any case whose failure is unclear, `testrail_case` with action "get" to read its steps and expected result.

  Then report:

  **Verdict** — one line: is this run releasable, and if not, what blocks it.

  **Clusters** — group the failures by root cause, not by test name. For each: how many tests, the shared symptom, and your best guess at the cause. Say when you are guessing.

  **Regressions vs. known** — separate cases that passed in a recent run (something broke) from cases that have been failing for a while (known debt).

  **Actions** — a short list, each naming a specific case id and who or what needs to act.

  Do not restate the pass/fail numbers as prose; the table already says them. Cite case ids as C123 so they are searchable.
  ```

- **Then** it names the run and the tools in order

### ✅ regression_summary defaults to five runs

Tags: `mcp`, `prompts`

- **Given** a connected client
- **When** regression_summary is requested without a run count
- **Then** it covers the last five runs of the project

### ✅ regression_summary honours an explicit run count

Tags: `mcp`, `prompts`

- **Given** a connected client
- **When** regression_summary is requested for 10 runs
- **Then** every tool call uses ten

### ✅ coverage_gap passes requirement keys through as a trimmed list

Tags: `mcp`, `prompts`

- **Given** a connected client
- **When** coverage_gap is requested with refs " RP-100, RP-101"
  **Prompt**

  ```markdown
  Analyse test coverage for TestRail project 5.

  Run `testrail_coverage` with project_id 5, refs ["RP-100", "RP-101"], and recent_runs 5.

  Then answer:

  **Biggest gap** — the single most important thing this project is not testing, and why you picked it over the others.

  **Untraceable cases** — how many cases have no requirement reference, and whether that is a process problem or just old cases.

  **Dead cases** — cases that exist but never execute. For each, a call: revive, automate, or delete. A case that has not run in months is not coverage, it is inventory.

  **Distribution** — is the priority spread plausible, or is everything Medium? A suite where nothing is Critical has not been prioritised.

  **Write next** — three to five concrete test cases worth adding, each with a title, the gap it closes, and a suggested priority.

  Ground every claim in the numbers the tool returned. If the data does not support a conclusion, say so instead of filling the space.
  ```

- **Then** the refs become a quoted, trimmed array, and are omitted when absent

### ✅ completes a project argument by id prefix or by name

Tags: `completion`, `mcp`, `prompts`

- **Given** projects 5 Curve Core, 6 Curve Pay and 51 Ledger
- **When** the human types part of an id or a name
  **Completions**

  ```json
  {
    "5": ["5", "51"],
    "pay": ["6"]
  }
  ```

- **Then** an id prefix matches every id starting with it, and names match case-insensitively

### ✅ offers no completions rather than failing when TestRail is unreachable

Tags: `completion`, `errors`, `mcp`, `prompts`

- **Given** get_projects fails
- **When** completion is requested
- **Then** the list is empty and the prompt menu keeps working

## src/resources.story.test.ts

### Browsable resources

### ✅ lists every project with a human suite mode and status

Tags: `mcp`, `resources`

- **Given** an instance with three projects in each suite mode
- **When** testrail://projects is read
  **testrail://projects**

  ```markdown
  # TestRail projects (3)

  Instance: https://example.testrail.io

  | id  | name       | suite mode      | status    |
  | --- | ---------- | --------------- | --------- |
  | 5   | Curve Core | single suite    | active    |
  | 6   | Curve Pay  | multiple suites | completed |
  | 7   | Curve Labs | baselines       | active    |
  ```

- **Then** each row carries its id, suite mode and status in words

### ✅ gives the lookup tables, and says when users cannot be listed

Tags: `mcp`, `resources`

- **Given** an API key without administrator rights, so get_users is refused
- **When** testrail://meta is read
  **testrail://meta**

  ```markdown
  # TestRail reference data

  ## Statuses

  | id  | name     | label    | final | untested |
  | --- | -------- | -------- | ----- | -------- |
  | 1   | passed   | Passed   | yes   |          |
  | 3   | untested | Untested |       | yes      |
  | 5   | failed   | Failed   | yes   |          |

  ## Priorities

  | id  | name     |
  | --- | -------- |
  | 4   | Critical |

  ## Case types

  | id  | name       |
  | --- | ---------- |
  | 7   | Functional |

  ## Users (0)

  _The API key cannot list users (needs administrator rights). Reports look up the people they mention one at a time instead._

  Writes are **disabled** on this server.
  ```

- **Then** statuses, priorities and types are tabled
- **And** the missing users are explained rather than silently empty

### ✅ lists users when the key can see them, and says writes are on

Tags: `mcp`, `resources`

- **Given** an administrator key on a server with writes enabled
- **When** testrail://meta is read
- **Then** the users table and the write switch are both there

### ✅ offers one overview per project through a listable template

Tags: `mcp`, `resources`

- **Given** a connected client
- **When** resources are listed
  **Resources**

  | URI                  | Name       |
  | -------------------- | ---------- |
  | testrail://projects  | projects   |
  | testrail://meta      | meta       |
  | testrail://project/5 | Curve Core |
  | testrail://project/6 | Curve Pay  |
  | testrail://project/7 | Curve Labs |

- **Then** each project appears as its own testrail://project/{id}

### ✅ summarises a project: suites, sections, milestones and recent runs

Tags: `mcp`, `resources`

- **Given** project 5 with one of everything
- **When** testrail://project/5 is read
  **testrail://project/5**

  ```markdown
  # Curve Core

  Project 5 · single suite · active
  https://example.testrail.io/index.php?/projects/overview/5

  ## Suites (1)

  | id  | name   |
  | --- | ------ |
  | 20  | Master |

  ## Sections (2)

  | id  | name     | parent |
  | --- | -------- | ------ |
  | 10  | Payments |        |
  | 11  | Refunds  | 10     |

  ## Milestones (1)

  | id  | name | due        | status |
  | --- | ---- | ---------- | ------ |
  | 3   | v2.4 | 2026-02-13 | open   |

  ## Recent runs (1)

  | id  | name               | created    | passed | failed | blocked | untested |
  | --- | ------------------ | ---------- | ------ | ------ | ------- | -------- |
  | 612 | Nightly regression | 2026-02-02 | 1      | 1      | 0       | 0        |

  > ⚠ Runs inside test plans could not be read (TestRail 404 on get_plans/5&limit=25: No fake route for 'get_plans/5&limit=25'); only standalone runs are included.
  ```

- **Then** every section of the overview is filled from TestRail

### ✅ still renders a project whose sub-lists TestRail refuses

Tags: `errors`, `mcp`, `resources`

- **Given** project 7, where suites, sections, milestones and runs all 404
- **When** testrail://project/7 is read
- **Then** the overview is empty rather than an error

### ✅ rejects a project id that is not a number

Tags: `mcp`, `resources`, `validation`

- **Given** a connected client
- **When** testrail://project/core is read
- **Then** it fails naming the bad id, before calling TestRail

### ✅ snapshots a run with each test named by status and assignee

Tags: `mcp`, `resources`

- **Given** run 612 with one pass and one failure
- **When** testrail://run/612 is read
  **testrail://run/612**

  ```markdown
  # Nightly regression

  Run 612 · open · created 2026-02-02
  https://example.testrail.io/index.php?/runs/view/612

  1 passed · 1 failed · 0 blocked · 0 retest · 0 untested

  ## Tests (2)

  | case | title           | status | assigned to |
  | ---- | --------------- | ------ | ----------- |
  | 101  | Login succeeds  | passed | user:16     |
  | 102  | Checkout totals | failed | unassigned  |
  ```

- **Then** counts and per-test rows are there

### ✅ rejects a run id that is not a number

Tags: `mcp`, `resources`, `validation`

- **Given** a connected client
- **When** testrail://run/latest is read
- **Then** it fails naming the bad id

## src/server.story.test.ts

### The MCP tool surface

### ✅ exposes ten task-oriented tools, each fully described

Tags: `mcp`

- **Given** a connected MCP client
- **When** the tool list is requested
  **Tools**

  | Name                   | Read-only | Destructive |
  | ---------------------- | --------- | ----------- |
  | testrail_search        | true      | false       |
  | testrail_run_report    | true      | false       |
  | testrail_failures      | true      | false       |
  | testrail_flaky         | true      | false       |
  | testrail_coverage      | true      | false       |
  | testrail_case          | true      | false       |
  | testrail_case_write    | false     | false       |
  | testrail_run           | false     | true        |
  | testrail_report_result | false     | false       |
  | testrail_raw           | false     | true        |

- **Then** there are ten, not one per REST endpoint
  > The two community TestRail MCP servers expose 42 and ~30 tools respectively.
- **And** every tool carries a description and an input schema

### ✅ annotates honestly which tools mutate and which destroy

Tags: `mcp`, `safety`

- **Given** a connected MCP client
- **When** the annotations are inspected
- **Then** the analysis tools and the case reader declare themselves read-only
- **And** the write tools do not
- **And** closing a run is flagged destructive, because it cannot be undone
  > A client that prompts on destructiveHint is the only thing between a model and an archived run.
- **But** posting a result is not — results append to a history rather than overwriting

### ✅ offers browsable resources so ids cost no tool turn

Tags: `mcp`

- **Given** a connected MCP client
- **When** resources are listed
  **Resources**

  ```json
  ["testrail://projects", "testrail://meta", "testrail://project/5", "testrail://project/6"]
  ```

- **Then** the fixed lookups are there
- **And** each project is enumerated from the live instance
  > These can be attached by the client up front, before the conversation starts.

### ✅ offers the three QA workflows as human-chosen prompts

Tags: `mcp`

- **Given** a connected MCP client
- **When** prompts are listed
- **Then** triage, summary and coverage are offered
  > A tool is chosen by the model mid-reasoning; a prompt is chosen by a human from a menu.

### Refusing writes on a read-only server

### ✅ turns every write tool into an explained refusal

Tags: `mcp`, `safety`

- **Given** a server started without TESTRAIL_ALLOW_WRITES
- **When** a result is posted
  **Response**

  ```
  Writes are disabled. 'add_results_for_cases/1' would modify TestRail. Set TESTRAIL_ALLOW_WRITES=true in the server environment to enable write tools.
  ```

- **Then** it comes back as a tool error the model can read and recover from
  > A tool-level isError reaches the conversation; a thrown protocol error never does.
- **And** no request reached TestRail

### ✅ cannot be bypassed through the raw escape hatch

Tags: `mcp`, `safety`

- **Given** a read-only server and a caller reaching for the raw API tool
- **When** a write endpoint is called directly through testrail_raw
- **Then** the same gate refuses it
  > The gate lives in the client, so every path through the server inherits it.

### ✅ says so in the server instructions, so the model does not keep trying

Tags: `mcp`

- **Given** a read-only server
- **When** the server instructions are read
- **Then** the read-only state is stated plainly
- **And** the model is told not to retry

### Validating tool input at the protocol boundary

### ✅ rejects a flaky threshold below two before any work happens

Tags: `mcp`, `validation`

- **Given** a caller asking for cases with a single pass/fail transition
  > One transition is a regression or a fix, never flakiness.
- **When** min_flips 1 is requested
  **Outcome**

  ```json
  {
    "thrown": false,
    "text": "Input validation error: Invalid arguments for tool testrail_flaky: min_flips: Too small: expected number to be >=2",
    "isError": true
  }
  ```

- **Then** the call is refused rather than silently widening the definition of flaky
- **And** the message names the offending argument

### ✅ explains which id a search is missing rather than guessing

Tags: `mcp`, `validation`

- **Given** a search for cases with no project named
- **When** the search runs
- **Then** it fails with the missing argument and how to find it

### ✅ hands a remote deployment the server before its tools are registered

Tags: `authorization`, `mcp`

- **Given** a connector that wants to gate these tools per person
  > The SDK keeps a built server's tool list private, so a gate applied afterwards has nothing left to intercept. This hook is the seam `gate()` from mcp-authz needs.
- **When** its wrap function registers a tool of its own
- **Then** its tool is listed first, ahead of all ten, so the wrap saw the server before any registration

### ✅ prices every capability the server lists, and fingerprints each one

Tags: `authorization`, `mcp`

- **Given** the exported GATE_PERMISSIONS map
- **When** mcp-authz lists the ungated server the way a client would

  > Ungated on purpose: a gated server answers per principal, and its list would miss the capabilities that most need a price.
  > No projects, so the `project` template lists no instances. Each instance is TestRail data, not a capability, and the map prices the template itself.
  > **Capabilities and their price**

  | Capability                | Permission     |
  | ------------------------- | -------------- |
  | prompt:coverage_gap       | testrail:read  |
  | prompt:regression_summary | testrail:read  |
  | prompt:triage_run         | testrail:read  |
  | resource:meta             | testrail:read  |
  | resource:project          | testrail:read  |
  | resource:projects         | testrail:read  |
  | resource:run              | testrail:read  |
  | testrail_case             | testrail:read  |
  | testrail_case_write       | testrail:write |
  | testrail_coverage         | testrail:read  |
  | testrail_failures         | testrail:read  |
  | testrail_flaky            | testrail:read  |
  | testrail_raw              | testrail:admin |
  | testrail_report_result    | testrail:write |
  | testrail_run              | testrail:write |
  | testrail_run_report       | testrail:read  |
  | testrail_search           | testrail:read  |

- **Then** the map names exactly what the server serves
- **And** the escape hatch is admin, not write
- **And** each definition is fingerprinted, so a changed description or schema shows up in review

## src/stdio.story.test.ts

### stdio --env-file

### ✅ loads the named file

Tags: `config`, `stdio`

- **Given** an env file and no TESTRAIL_* variables
- **Then** the server starts against the URL in the file

### ✅ lets the environment win over the file

Tags: `config`, `stdio`

- **Given** TESTRAIL_URL set in the environment and in the file
- **Then** the environment value is used

### ✅ refuses a relative path

Tags: `config`, `stdio`

- **Given** --env-file testrail.env, relative to the working directory
- **Then** it exits without reading it

### ✅ never reads ./.env on its own

Tags: `config`, `stdio`

- **Given** a .env in the working directory and no flag
- **Then** it is ignored and the server says it is not configured

## src/telemetry.story.test.ts

### Telemetry

### ✅ loads nothing without an OTLP endpoint

Tags: `telemetry`

- **Given** no OTEL_EXPORTER_OTLP_ENDPOINT
- **Then** there is nothing to wrap the server with

### ✅ instruments the server before its tools register, and serves through it

Tags: `telemetry`

- **Given** an OTLP endpoint
- **When** the server is built with it as the wrap
- **Then** buildServer returns the instrumented proxy, so every handler registered through it
- **And** tools still answer through it

## src/tools.story.test.ts

### A configured default project

### ✅ fills in project_id wherever a call leaves it out, and says so

Tags: `configuration`, `tools`

- **Given** a server started with TESTRAIL_PROJECT_ID=5
- **When** tools are called with no project_id
- **Then** each works on project 5
- **And** the tool schema and the server instructions name the default

### ✅ asks for a project when none is configured

Tags: `configuration`, `tools`

### The read tools

### ✅ testrail_search answers {"entity":"projects","limit":10} with markdown

Tags: `mcp`, `tools`

- **Given** a read-only server over a small TestRail instance
- **When** testrail_search is called
  **Arguments**

  ```json
  {
    "entity": "projects",
    "limit": 10
  }
  ```

  **Response**

  ```markdown
  ## Projects (1)

  | id  | name       | suite mode | completed |
  | --- | ---------- | ---------- | --------- |
  | 5   | Curve Core | single     |           |
  ```

- **Then** it answers without error and names what it found

### ✅ testrail_search answers {"entity":"cases","project_id":5,"limit":10} with markdown

Tags: `mcp`, `tools`

- **Given** a read-only server over a small TestRail instance
- **When** testrail_search is called
  **Arguments**

  ```json
  {
    "entity": "cases",
    "project_id": 5,
    "limit": 10
  }
  ```

  **Response**

  ```markdown
  ## Cases (2)

  | id  | title           | priority | type       | refs | updated |
  | --- | --------------- | -------- | ---------- | ---- | ------- |
  | 101 | Login succeeds  | Medium   | Functional | RP-1 |         |
  | 102 | Checkout totals | Critical | Functional |      |         |
  ```

- **Then** it answers without error and names what it found

### ✅ testrail_search answers {"entity":"runs","project_id":5,"limit":10} with markdown

Tags: `mcp`, `tools`

- **Given** a read-only server over a small TestRail instance
- **When** testrail_search is called
  **Arguments**

  ```json
  {
    "entity": "runs",
    "project_id": 5,
    "limit": 10
  }
  ```

  **Response**

  ```markdown
  ## Runs (2)

  | id  | name               | created    | passed | failed | blocked | untested | status |
  | --- | ------------------ | ---------- | ------ | ------ | ------- | -------- | ------ |
  | 612 | Nightly regression | 2026-02-02 | 1      | 1      | 0       | 0        | open   |
  | 611 | Previous nightly   | 2026-01-31 | 1      | 0      | 0       | 0        | open   |

  _Use the run report with a run id for the breakdown._
  ```

- **Then** it answers without error and names what it found

### ✅ testrail_search answers {"entity":"tests","run_id":612,"limit":10} with markdown

Tags: `mcp`, `tools`

- **Given** a read-only server over a small TestRail instance
- **When** testrail_search is called
  **Arguments**

  ```json
  {
    "entity": "tests",
    "run_id": 612,
    "limit": 10
  }
  ```

  **Response**

  ```markdown
  ## Tests (2)

  | id  | case | title           | status | assigned to |
  | --- | ---- | --------------- | ------ | ----------- |
  | 1   | 101  | Login succeeds  | passed | unassigned  |
  | 2   | 102  | Checkout totals | failed | unassigned  |
  ```

- **Then** it answers without error and names what it found

### ✅ testrail_run_report answers {"run_id":612} with markdown

Tags: `mcp`, `tools`

- **Given** a read-only server over a small TestRail instance
- **When** testrail_run_report is called
  **Arguments**

  ```json
  {
    "run_id": 612
  }
  ```

  **Response**

  ```markdown
  # Nightly regression

  Run 612 · open · created 2026-02-02 by unassigned
  https://example.testrail.io/index.php?/runs/view/612

  **50.0% passing** — 1 passed, 1 failed, 0 blocked, 0 retest, 0 untested (2 total)

  ## Status breakdown

  | status | count |
  | ------ | ----- |
  | passed | 1     |
  | failed | 1     |

  ## Failure clusters (1 distinct from 1 explained failures)

  ### 1× — total off by one cent

  | test | case | title           | status | defects |
  | ---- | ---- | --------------- | ------ | ------- |
  | 2    | 102  | Checkout totals | failed | PAY-7   |

  Sample comment:
  ```

  Total off by one cent

  ```

  ```

- **Then** it answers without error and names what it found

### ✅ testrail_failures answers {"run_id":612,"include_last_good":true} with markdown

Tags: `mcp`, `tools`

- **Given** a read-only server over a small TestRail instance
- **When** testrail_failures is called
  **Arguments**

  ```json
  {
    "run_id": 612,
    "include_last_good": true
  }
  ```

  **Response**

  ```markdown
  # 2 non-passing tests in run 612

  Nightly regression — https://example.testrail.io/index.php?/runs/view/612

  | case | title           | status | assigned   | elapsed | defects | last passed in       |
  | ---- | --------------- | ------ | ---------- | ------- | ------- | -------------------- |
  | 101  | Login succeeds  | passed | unassigned |         |         | run 612 (2026-02-02) |
  | 102  | Checkout totals | failed | unassigned |         | PAY-7   | run 612 (2026-02-02) |

  ## Result comments

  **C102 — Checkout totals**
  ```

  Total off by one cent

  ```

  ```

- **Then** it answers without error and names what it found

### ✅ testrail_flaky answers {"project_id":5} with markdown

Tags: `mcp`, `tools`

- **Given** a read-only server over a small TestRail instance
- **When** testrail_flaky is called
  **Arguments**

  ```json
  {
    "project_id": 5
  }
  ```

  **Response**

  ```markdown
  # Stability — 0 flaky, 1 regressed, 0 recovered

  Across 2 runs (2026-01-31 → 2026-02-02) of project 5.

  ## Flaky (0)

  _None. Every state change in this window was a one-way regression or fix, not alternation._

  ## Regressed (1)

  _Passed, then failed, and stayed failed. These are the ones to act on._

  | case | title           | settled runs | timeline |
  | ---- | --------------- | ------------ | -------- |
  | 102  | Checkout totals | 2            | .X       |

  _Timeline is oldest → newest: `.` passed, `X` failed, `-` untested/blocked/retest._
  ```

- **Then** it answers without error and names what it found

### ✅ testrail_coverage answers {"project_id":5} with markdown

Tags: `mcp`, `tools`

- **Given** a read-only server over a small TestRail instance
- **When** testrail_coverage is called
  **Arguments**

  ```json
  {
    "project_id": 5
  }
  ```

  **Response**

  ```markdown
  # Coverage — project 5

  2 cases analysed.

  ## Distribution

  | priority | cases |
  | -------- | ----- |
  | Medium   | 1     |
  | Critical | 1     |

  | type       | cases |
  | ---------- | ----- |
  | Functional | 2     |

  ## Cases with no requirement reference (1 of 2)

  | case | title           | priority |
  | ---- | --------------- | -------- |
  | 102  | Checkout totals | Critical |

  ## Never executed in the last 2 runs (0 of 2)

  _Every case has been executed recently._
  ```

- **Then** it answers without error and names what it found

### ✅ testrail_case answers {"case_id":102} with markdown

Tags: `mcp`, `tools`

- **Given** a read-only server over a small TestRail instance
- **When** testrail_case is called
  **Arguments**

  ```json
  {
    "case_id": 102
  }
  ```

  **Response**

  ```markdown
  # C102 — Checkout totals

  | field    | value                                                 |
  | -------- | ----------------------------------------------------- |
  | section  | Payments (10)                                         |
  | priority | Critical                                              |
  | type     | Functional                                            |
  | refs     | —                                                     |
  | estimate | —                                                     |
  | template | —                                                     |
  | updated  | —                                                     |
  | link     | https://example.testrail.io/index.php?/cases/view/102 |

  ## Recent executions

  | run | run name           | status | defects | comment |
  | --- | ------------------ | ------ | ------- | ------- |
  | 612 | Nightly regression | failed |         |         |
  | 611 | Previous nightly   | passed |         |         |
  ```

- **Then** it answers without error and names what it found

### ✅ testrail_run_report turns {"run_id":999} into a readable tool error

Tags: `errors`, `mcp`, `tools`

- **Given** a read-only server
- **When** testrail_run_report is called with arguments TestRail cannot satisfy
  **Response**

  ```
  TestRail 404 on get_run/999: No fake route for 'get_run/999'
  ```

- **Then** the failure is an isError result the model can read, not a protocol error

### ✅ testrail_failures turns {"run_id":999} into a readable tool error

Tags: `errors`, `mcp`, `tools`

- **Given** a read-only server
- **When** testrail_failures is called with arguments TestRail cannot satisfy
  **Response**

  ```
  TestRail 404 on get_run/999: No fake route for 'get_run/999'
  ```

- **Then** the failure is an isError result the model can read, not a protocol error

### ✅ testrail_flaky turns {"project_id":999} into a readable tool error

Tags: `errors`, `mcp`, `tools`

- **Given** a read-only server
- **When** testrail_flaky is called with arguments TestRail cannot satisfy
  **Response**

  ```
  TestRail 404 on get_runs/999&include_plan_runs=1&limit=10: No fake route for 'get_runs/999&include_plan_runs=1&limit=10'
  ```

- **Then** the failure is an isError result the model can read, not a protocol error

### ✅ testrail_coverage turns {"project_id":999} into a readable tool error

Tags: `errors`, `mcp`, `tools`

- **Given** a read-only server
- **When** testrail_coverage is called with arguments TestRail cannot satisfy
  **Response**

  ```
  TestRail 404 on get_cases/999&limit=250: No fake route for 'get_cases/999&limit=250'
  ```

- **Then** the failure is an isError result the model can read, not a protocol error

### ✅ testrail_case turns {} into a readable tool error

Tags: `errors`, `mcp`, `tools`

- **Given** a read-only server
- **When** testrail_case is called with arguments TestRail cannot satisfy
  **Response**

  ```
  Input validation error: Invalid arguments for tool testrail_case: case_id: Invalid input: expected number, received undefined
  ```

- **Then** the failure is an isError result the model can read, not a protocol error

### ✅ testrail_search turns {"entity":"cases","limit":10} into a readable tool error

Tags: `errors`, `mcp`, `tools`

- **Given** a read-only server
- **When** testrail_search is called with arguments TestRail cannot satisfy
  **Response**

  ```
  entity 'cases' needs a project_id. Search entity:'projects' first.
  ```

- **Then** the failure is an isError result the model can read, not a protocol error

### The write tools

### ✅ testrail_case_write {"action":"create","section_id":10,"title":"Refund succeeds"} refuses while writes are disabled

Tags: `mcp`, `safety`, `tools`

- **Given** a server started without TESTRAIL_ALLOW_WRITES
- **When** testrail_case_write is asked to write
- **Then** it refuses, and no write reached TestRail

### ✅ testrail_case_write {"action":"update","case_id":102,"title":"Checkout totals (GBP)"} refuses while writes are disabled

Tags: `mcp`, `safety`, `tools`

- **Given** a server started without TESTRAIL_ALLOW_WRITES
- **When** testrail_case_write is asked to write
- **Then** it refuses, and no write reached TestRail

### ✅ testrail_run {"action":"create","project_id":5,"name":"Release candidate"} refuses while writes are disabled

Tags: `mcp`, `safety`, `tools`

- **Given** a server started without TESTRAIL_ALLOW_WRITES
- **When** testrail_run is asked to write
- **Then** it refuses, and no write reached TestRail

### ✅ testrail_run {"action":"update","run_id":612,"name":"Nightly regression (rerun)"} refuses while writes are disabled

Tags: `mcp`, `safety`, `tools`

- **Given** a server started without TESTRAIL_ALLOW_WRITES
- **When** testrail_run is asked to write
- **Then** it refuses, and no write reached TestRail

### ✅ testrail_run {"action":"close","run_id":612} refuses while writes are disabled

Tags: `mcp`, `safety`, `tools`

- **Given** a server started without TESTRAIL_ALLOW_WRITES
- **When** testrail_run is asked to write
- **Then** it refuses, and no write reached TestRail

### ✅ testrail_report_result {"run_id":612,"results":[{"case_id":102,"status":"passed"}]} refuses while writes are disabled

Tags: `mcp`, `safety`, `tools`

- **Given** a server started without TESTRAIL_ALLOW_WRITES
- **When** testrail_report_result is asked to write
- **Then** it refuses, and no write reached TestRail

### ✅ testrail_case_write {"action":"create","section_id":10,"title":"Refund succeeds"} succeeds once writes are enabled

Tags: `mcp`, `tools`, `writes`

- **Given** a server started with TESTRAIL_ALLOW_WRITES=true
- **When** testrail_case_write writes
  **Response**

  ```
  Created case C103 — Refund succeeds
  https://example.testrail.io/index.php?/cases/view/103
  ```

- **Then** it reports what changed, with a link back to TestRail

### ✅ testrail_case_write {"action":"update","case_id":102,"title":"Checkout totals (GBP)"} succeeds once writes are enabled

Tags: `mcp`, `tools`, `writes`

- **Given** a server started with TESTRAIL_ALLOW_WRITES=true
- **When** testrail_case_write writes
  **Response**

  ```
  Updated case C102 — Checkout totals (GBP)
  Changed: title
  https://example.testrail.io/index.php?/cases/view/102
  ```

- **Then** it reports what changed, with a link back to TestRail

### ✅ testrail_run {"action":"create","project_id":5,"name":"Release candidate"} succeeds once writes are enabled

Tags: `mcp`, `tools`, `writes`

- **Given** a server started with TESTRAIL_ALLOW_WRITES=true
- **When** testrail_run writes
  **Response**

  ```
  Created run 613 — Release candidate
  https://example.testrail.io/index.php?/runs/view/613
  ```

- **Then** it reports what changed, with a link back to TestRail

### ✅ testrail_run {"action":"update","run_id":612,"name":"Nightly regression (rerun)"} succeeds once writes are enabled

Tags: `mcp`, `tools`, `writes`

- **Given** a server started with TESTRAIL_ALLOW_WRITES=true
- **When** testrail_run writes
  **Response**

  ```
  Updated run 612 — Nightly regression (rerun)
  Changed: name
  https://example.testrail.io/index.php?/runs/view/612
  ```

- **Then** it reports what changed, with a link back to TestRail

### ✅ testrail_run {"action":"close","run_id":612} succeeds once writes are enabled

Tags: `mcp`, `tools`, `writes`

- **Given** a server started with TESTRAIL_ALLOW_WRITES=true
- **When** testrail_run writes
  **Response**

  ```
  Closed run 612 — Nightly regression. This is permanent; the run is now archived.
  https://example.testrail.io/index.php?/runs/view/612
  ```

- **Then** it reports what changed, with a link back to TestRail

### ✅ testrail_report_result {"run_id":612,"results":[{"case_id":102,"status":"passed"}]} succeeds once writes are enabled

Tags: `mcp`, `tools`, `writes`

- **Given** a server started with TESTRAIL_ALLOW_WRITES=true
- **When** testrail_report_result writes
  **Response**

  ```
  Posted 1 result to run 612.

  | result | test | status |
  | --- | --- | --- |
  | 950 | 2 | passed |

  https://example.testrail.io/index.php?/runs/view/612
  ```

- **Then** it reports what changed, with a link back to TestRail

### ✅ testrail_case_write {"action":"create","title":"No section"} names the missing piece

Tags: `mcp`, `tools`, `validation`

- **Given** a server with writes enabled
- **When** a write is missing what it needs
- **Then** the error says which argument to add, and nothing was written

### ✅ testrail_case_write {"action":"update","title":"No id"} names the missing piece

Tags: `mcp`, `tools`, `validation`

- **Given** a server with writes enabled
- **When** a write is missing what it needs
- **Then** the error says which argument to add, and nothing was written

### ✅ testrail_run {"action":"create","name":"No project"} names the missing piece

Tags: `mcp`, `tools`, `validation`

- **Given** a server with writes enabled
- **When** a write is missing what it needs
- **Then** the error says which argument to add, and nothing was written

### ✅ testrail_run {"action":"update","name":"No id"} names the missing piece

Tags: `mcp`, `tools`, `validation`

- **Given** a server with writes enabled
- **When** a write is missing what it needs
- **Then** the error says which argument to add, and nothing was written

### ✅ testrail_run {"action":"close"} names the missing piece

Tags: `mcp`, `tools`, `validation`

- **Given** a server with writes enabled
- **When** a write is missing what it needs
- **Then** the error says which argument to add, and nothing was written

### ✅ testrail_report_result {"run_id":612,"results":[{"case_id":102,"status":"untested"}]} names the missing piece

Tags: `mcp`, `tools`, `validation`

- **Given** a server with writes enabled
- **When** a write is missing what it needs
- **Then** the error says which argument to add, and nothing was written

### The raw escape hatch

### ✅ reads any endpoint, normalising a pasted URL

Tags: `mcp`, `raw`, `tools`

- **Given** a read-only server
- **When** a full TestRail URL is passed as the endpoint
  **Response**

  ````
  `get_shared_steps/5`

  ```json
  {
    "offset": 0,
    "limit": 250,
    "size": 1,
    "_links": {
      "next": null,
      "prev": null
    },
    "shared_steps": [
      {
        "id": 3,
        "title": "Log in as admin"
      }
    ]
  }
  ````

  ```

  ```

- **Then** it calls the path after /api/v2/ and returns the JSON

### ✅ refuses a body on a read endpoint rather than letting TestRail ignore it

Tags: `mcp`, `raw`, `tools`, `validation`

- **Given** a server with writes enabled
- **When** a body is sent to a get_ endpoint
- **Then** it is refused before any request

### ✅ refuses a raw write while writes are disabled

Tags: `mcp`, `raw`, `safety`, `tools`

- **Given** a read-only server
- **When** a write endpoint is called through testrail_raw
- **Then** the client write gate refuses it
