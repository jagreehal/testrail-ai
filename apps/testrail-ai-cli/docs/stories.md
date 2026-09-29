# User Stories

## src/cli.story.test.ts

### Running the CLI

### ✅ lists its commands so an agent skill can discover them

Tags: `cli`

- **Given** the CLI with no arguments beyond --help
- **When** help is printed
  **Output**

  ```
  Usage: testrail-ai [options] [command]

  TestRail for humans and agents — reports, triage, stability and coverage

  Options:
    -V, --version                        output the version number
    --json                               Emit the raw result as JSON instead of
                                         markdown
    --url <url>                          TestRail URL (defaults to TESTRAIL_URL)
    --email <email>                      TestRail email (defaults to
                                         TESTRAIL_EMAIL)
    --api-key <key>                      TestRail API key (defaults to
                                         TESTRAIL_API_KEY)
    -h, --help                           display help for command

  Commands:
    search [options] <entity>            Find projects, suites, sections, cases,
                                         runs, plans, milestones or tests
    report [options] [run]               Full report on one run: totals, pass
                                         rate, failures clustered by cause
    failures [options] <run>             Non-passing tests in a run, with
                                         comments, per-step results and defects
    stability|flaky [options] [project]  Flaky vs regressed vs recovered across
                                         recent runs
    coverage [options] [project]         What the suite is not testing
    case [options] <case>                Full detail on one test case
    projects                             List every project — the usual starting
                                         point
    help [command]                       display help for command

  ```

- **Then** every workflow command is listed
- **And** --json is advertised, because that is what makes it scriptable

### ✅ refuses to start without credentials, naming what is missing

Tags: `cli`, `config`

- **Given** an environment with no TestRail configuration
- **When** a command is run
  **stderr**

  ```
  TestRail MCP is not configured.
    - url: TESTRAIL_URL must be a full URL, e.g. https://example.testrail.io
    - email: TESTRAIL_EMAIL is required
    - apiKey: TESTRAIL_API_KEY is required

  Set TESTRAIL_URL, TESTRAIL_EMAIL and TESTRAIL_API_KEY in the environment (or in a .env file next to the server).

  ```

- **Then** it exits non-zero rather than half-working
- **And** each missing variable is named

### ✅ rejects a non-numeric id instead of querying for NaN

Tags: `cli`, `validation`

- **Given** a run id that is not a number
- **When** the report command is run
- **Then** it is rejected before any request is made
  > Without this the CLI would ask TestRail for run NaN and get a confusing 400 back.

### ✅ rejects an unknown search entity during argument parsing

Tags: `cli`, `regression`, `validation`

### ✅ rejects contradictory completion filters

Tags: `cli`, `validation`

### Talking to TestRail from the CLI

### ✅ accepts zero recent runs to skip execution-history coverage

Tags: `cli`, `coverage`, `regression`, `validation`

### ✅ uses the default project when the project argument is left out

Tags: `cli`, `configuration`

- **When** `coverage` is run with TESTRAIL_PROJECT_ID=5 and no project
- **And** without a default it asks for one

### ✅ prints a readable table by default

Tags: `cli`

- **Given** a TestRail with two projects
- **When** `projects` is run
  **Output**

  ```markdown
  ## Projects (2)

  | id  | name       | suite mode | completed |
  | --- | ---------- | ---------- | --------- |
  | 5   | Curve Core | single     |           |
  | 6   | Curve Pay  | single     |           |
  ```

- **Then** a markdown table comes back on stdout

### ✅ emits the underlying data with --json, for pipes and skills

Tags: `cli`, `json`

- **Given** the same TestRail
- **When** `projects --json` is run
  **Output**

  ```json
  {
    "entity": "projects",
    "count": 1,
    "raw": [
      {
        "id": 5,
        "name": "Curve Core",
        "suite_mode": 1,
        "is_completed": false
      }
    ],
    "columns": ["id", "name", "suite mode", "completed"],
    "rows": [[5, "Curve Core", "single", ""]],
    "complete": true,
    "warnings": []
  }
  ```

- **Then** stdout is valid JSON, not markdown
  > This is what lets an agent skill shell out and parse the result.
- **And** the raw TestRail entities are included, not just the rendered table

### ✅ classifies stability the same way the MCP server does

Tags: `cli`, `stability`

- **Given** a project where one case regressed and one is genuinely flaky
- **When** `stability 5 --json` is run
  **Verdicts**

  ```json
  {
    "projectId": 5,
    "runCount": 3,
    "from": "1970-01-01",
    "to": "1970-01-01",
    "minFlips": 2,
    "belowThreshold": 0,
    "insufficientEvidence": 0,
    "flaky": [
      {
        "caseId": 10,
        "title": "Login",
        "config": null,
        "timeline": ".X.",
        "flips": 2,
        "runs": 3,
        "failures": 1,
        "endedFailing": false
      }
    ],
    "regressed": [
      {
        "caseId": 20,
        "title": "Checkout",
        "config": null,
        "timeline": "..X",
        "flips": 1,
        "runs": 3,
        "failures": 1,
        "endedFailing": true
      }
    ],
    "recovered": [],
    "complete": true,
    "warnings": []
  }
  ```

- **Then** only the alternating case is flaky
- **And** the one that broke and stayed broken is regressed
  > Same core function as the MCP tool — the two frontends cannot disagree.

### ✅ passes TestRail's own error through with a non-zero exit

Tags: `cli`, `errors`

- **Given** a TestRail that knows nothing about the requested run
- **When** a report is requested for it
  **stderr**

  ```
  TestRail 404 on get_run/999: no route: get_run/999

  ```

- **Then** the exit code marks the failure, so CI notices
- **And** the message goes to stderr, leaving stdout clean for pipes
