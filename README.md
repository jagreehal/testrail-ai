# testrail-ai

TestRail shaped for agents. One core library and two frontends — a CLI and a
local MCP server — so you pick whichever fits how you work.

| Package                                   | What it is                                                                        |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| [`testrail-ai`](packages/testrail-ai)     | The engine. Fetch, join and analyse; returns typed data and, on its own, markdown |
| [`testrail-ai-mcp`](apps/testrail-mcp)    | MCP server, specification 2026-07-28. Ten tools, four resources, three prompts    |
| [`testrail-ai-cli`](apps/testrail-ai-cli) | CLI. Same commands, `--json` for pipes                                            |
| [`skills/`](skills)                       | Claude agent skills that drive the CLI, with no server process                    |

## Why ten tools

The other TestRail MCP servers mirror the REST API one tool per endpoint:
`getCase`, `getCases`, `addCase`, `updateCases`, `copyToSection`, and on to
forty-two. That costs twice. Every tool schema sits in the model's context on
every turn, and "why did last night's regression fail?" becomes a five-call
orchestration the model has to get right each time.

Here the join happens in code. `testrail_run_report` is one call that fetches the
run, its tests and its results, groups the failures by root cause and returns a
page of markdown.

## Quick start

```bash
pnpm install
cp .env.example .env     # fill in url, email, api key
pnpm build
pnpm test
```

### MCP server

```json
{
  "mcpServers": {
    "testrail": {
      "command": "npx",
      "args": ["-y", "testrail-ai-mcp"],
      "env": {
        "TESTRAIL_URL": "https://your-instance.testrail.io",
        "TESTRAIL_EMAIL": "you@example.com",
        "TESTRAIL_API_KEY": "your-api-key"
      }
    }
  }
}
```

### CLI

```bash
npm i -g testrail-ai-cli

testrail-ai projects
testrail-ai report 612                 # totals, pass rate, failure clusters
testrail-ai failures 612 --last-good   # what broke, and when it last worked
testrail-ai stability 5 --runs 10      # flaky vs regressed vs recovered
testrail-ai coverage 5 --refs CUR-1234 # what is not tested
testrail-ai --json report 612 | jq .passRate
```

### Agent skills

```bash
npx skills add testrail-ai
```

Installs `testrail-triage-run`, `testrail-regression-summary` and
`testrail-coverage-gap` into your agent. They shell out to the CLI, so they need
no MCP server running.

### Library

```ts
import { TestRailClient, getRunReport, formatRunReport } from 'testrail-ai';

const client = new TestRailClient(config);
const report = await getRunReport({ run_id: 612 }, { client });

report.passRate; // 94.1
report.clusters.length; // 7 distinct causes
formatRunReport(report); // …or the markdown
```

## Architecture

```
                    ┌──────────────────┐
                    │   testrail-ai    │   get*    → typed data
                    │      (core)      │   format* → markdown
                    └────────┬─────────┘
                    ┌────────┴─────────┐
            ┌───────▼───────┐  ┌───────▼───────┐
            │testrail-ai-mcp│  │testrail-ai-cli│
            └───────────────┘  └───────┬───────┘
                                       │
                               ┌───────▼──────┐
                               │   skills/    │
                               └──────────────┘
```

`get*` returns plain typed data; `format*` turns it into markdown. The MCP server
calls both. The CLI calls `get*` alone for `--json` and both for human output.
Neither frontend contains TestRail logic, which keeps the two from drifting. They
share the [input schemas](packages/testrail-ai/src/schemas.ts) too, so you add a
filter once and both frontends get it with the same validation.

For a shared remote deployment — Claude connector, per-person Google login,
team access list — that deployment lives in your repo, not this one. Wire
[`mcp-authz`](https://www.npmjs.com/package/mcp-authz) to `buildServer` from
`testrail-ai-mcp` through its `wrap` option, passing the exported
`GATE_PERMISSIONS` map so every tool, prompt and resource is priced. A reader
then has no `testrail_run` in `tools/list`, and a direct call to it is refused.
`apps/testrail-mcp/src/gate.story.test.ts` runs that wiring for real. See the
[`mcp-authz` node example](https://github.com/jagreehal/mcp-authz/tree/main/apps/node-example)
and `buildServer` notes in [`apps/testrail-mcp/README.md`](apps/testrail-mcp/README.md).

## Write access

Writes stay **off** unless you set `TESTRAIL_ALLOW_WRITES=true`. Every request
funnels through one gate in the client, keyed on TestRail's mutating verbs
(`add_`, `update_`, `delete_`, `close_`, `move_`, `copy_`, `push_`). A read-only
deployment stays read-only even through the `testrail_raw` escape hatch, which
refuses the call before building a request. No tool wraps `delete_*` at all.

## Testing

```bash
pnpm test          # deterministic tests, no network
pnpm test:smoke    # read-only integration check against a real instance
```

The tests are [executable
stories](https://github.com/jagreehal/executable-stories), so the run that proves
the behaviour also emits the markdown describing it. See
`packages/testrail-ai/docs/stories.md`. The code generates the spec, so the two
stay in step.

`test:smoke` forces `allowWrites: false` whatever the environment says, so you
can point it at production. It asserts that the write gate refuses, including an
attempt to smuggle a write through `testrail_raw`.

## Observability

Set `OTEL_EXPORTER_OTLP_ENDPOINT` and the MCP server traces itself via
[`autotel`](https://github.com/jagreehal/autotel) and
`autotel-mcp-instrumentation`, propagating W3C trace context through MCP's
`_meta`. Both imports are dynamic, so with no endpoint set Node loads neither.

Each tool call is a span, and every TestRail request under it is a client span
named by operation (`testrail get_tests`), with the endpoint, status code and
any retries recorded on it. Those spans come from the core client through
`@opentelemetry/api`, so a library user with an OpenTelemetry SDK of their own
gets them too; without one they cost nothing. Credentials are never recorded.

Tool results carry text anyone on the TestRail instance can write, so each one
is scanned for prompt-injection patterns (an instruction override in a result
comment, say). A hit is recorded on the tool span as
`mcp.security.injection.verdict` with its categories, ready to alert on. The
scan only observes: the result the model reads is unchanged.

For proxy, private-CA, health-check and shutdown guidance, see
[Production operations](docs/production.md). Security issues should be reported
privately as described in [SECURITY.md](SECURITY.md).

## Licence

MIT.
