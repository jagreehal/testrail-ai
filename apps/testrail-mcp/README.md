# testrail-ai-mcp

MCP server for TestRail, on specification **2026-07-28** with the TypeScript SDK
v2. Ten task-oriented tools, four resources, three prompts.

```bash
npx -y testrail-ai-mcp
```

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

Set `TESTRAIL_PROJECT_ID` as well if you work mostly in one project. Every tool
then uses it when `project_id` is left out, and the tool schemas and server
instructions name it, so the model does not have to look it up first.

## Tools

| Tool                     | Answers                                                 |
| ------------------------ | ------------------------------------------------------- |
| `testrail_search`        | "What is the id of…?" One tool, one `entity` enum       |
| `testrail_run_report`    | "How did run X go?" Totals, pass rate, failure clusters |
| `testrail_failures`      | "What is broken, and since when?"                       |
| `testrail_flaky`         | "Is this real or noise?" Flaky, regressed or recovered  |
| `testrail_coverage`      | "What are we not testing?"                              |
| `testrail_case`          | Full case detail, with recent history                   |
| `testrail_case_write`    | Create or update a case                                 |
| `testrail_run`           | Open, retarget or close a run                           |
| `testrail_report_result` | Post a batch of results                                 |
| `testrail_raw`           | Anything the other nine do not cover                    |

## Resources

Attach these up front and the model starts with the ids it needs instead of
spending a turn discovering them. Each carries a cache hint (SEP-2549) matched to
how often the data behind it changes.

| URI                                                        | TTL                                             |
| ---------------------------------------------------------- | ----------------------------------------------- |
| `testrail://projects`                                      | 5 min                                           |
| `testrail://meta`, statuses, priorities, case types, users | 1 hour                                          |
| `testrail://project/{id}`                                  | 1 min                                           |
| `testrail://run/{id}`                                      | none, since an open run changes as testers work |

## Prompts

`triage_run`, `regression_summary` and `coverage_gap`, all human-chosen workflows
with project-name completion.

## Transports

`testrail-ai-mcp` speaks stdio. There is an HTTP transport too, for the MCP
Inspector and for clients that prefer HTTP:

```bash
PORT=8100 node dist/http.js    # http://localhost:8100/mcp
```

It binds loopback and refuses non-localhost hosts, so run it on your own machine.
That entry point loads one TestRail credential at startup, so pointing a team at
it would run everyone's queries under a single service account, bypassing
TestRail's per-project permissions and naming one person in the audit trail.

## Serving a team (Google Workspace and similar)

TestRail authenticates with Basic Auth over an account email and API key. You
cannot exchange a Google identity token for a TestRail one outside Enterprise
SSO, so Google authenticates people to _your_ service and your service
authenticates to TestRail. This package is built for that split rather than
against it.

`buildServer` takes a config, and `createMcpHandler` hands its factory the
original `Request`. Build the config per request and each person's calls carry
their own TestRail credential:

```ts
import { createMcpHandler } from '@modelcontextprotocol/server';
import { loadConfig } from 'testrail-ai';
import { buildServer } from 'testrail-ai-mcp';

const handler = createMcpHandler(async (ctx) => {
  const email = await verifiedEmail(ctx.requestInfo); // your SSO, your check
  const creds = await credentialFor(email); // your secret store
  if (!creds) throw new Error(`No TestRail credential mapped for ${email}`);

  return buildServer(
    loadConfig({
      ...process.env,
      TESTRAIL_EMAIL: creds.email,
      TESTRAIL_API_KEY: creds.apiKey,
    }),
  );
});
```

`loadConfig` takes an env object rather than reading `process.env` itself, so
this path gets the same validation as the bundled entry points.

To decide per person which of these tools exist, pass `wrap`. It sees the server
before any tool is registered, which is the only point at which a permission
check can remove one: the SDK keeps a built server's tool list private, so
nothing applied afterwards can filter what it never saw.

```ts
import { gate } from 'mcp-authz';
import { buildServer, GATE_PERMISSIONS } from 'testrail-ai-mcp';

buildServer(config, {
  wrap: (server) => gate(server, principal, GATE_PERMISSIONS),
});
```

With tracing on, load it once per process and put the gate outside it:

```ts
import { gate } from 'mcp-authz';
import { buildServer, GATE_PERMISSIONS, loadTelemetry } from 'testrail-ai-mcp';

const instrument = await loadTelemetry(); // undefined without an OTLP endpoint

buildServer(config, {
  wrap: (server) => gate(instrument ? instrument(server) : server, principal, GATE_PERMISSIONS),
});
```

`GATE_PERMISSIONS` prices every tool, prompt and resource this package
registers. A reader with `testrail:read` never has `testrail_run` in
`tools/list`; a lead with `testrail:write` also sees the mutating tools; only
`testrail:admin` sees `testrail_raw`. A capability missing from the map throws
at registration, naming it, so adding a tool without pricing it fails loudly.
The test suite lists the server with `recordCapabilities` from `mcp-authz/testing`,
checks the map names exactly those capabilities, and snapshots a fingerprint of
each definition, so a changed description or input schema shows up in review.

`TESTRAIL_ALLOW_WRITES` and the gate are two axes on purpose. The env switch is
the blast-radius control for the credential (a read-only deploy stays read-only
even through `testrail_raw`). The gate is who may see which tools when writes
are on. Reading a case and writing one are separate tools, so a reader holds
`testrail_case` and never sees `testrail_case_write`.

List caches are `private` so a per-principal catalogue cannot bleed across
callers. Closing a run is irreversible — put `approval` on `testrail_run` in
your connector if a second person should confirm.

Two things stay yours, on purpose. Verifying the Google token is your identity
provider's job, and this package never sees it. Storing one TestRail key per
person is your secret manager's job, and a lookup miss should refuse before any
TestRail call rather than falling back to a shared account.

What you get for it: TestRail's own per-project permissions apply per person, a
read-only tester stays read-only even with `TESTRAIL_ALLOW_WRITES=true`, and
posted results carry the name of whoever asked for them.

Writes stay off unless you set `TESTRAIL_ALLOW_WRITES=true`. MIT.
