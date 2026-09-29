# testrail-ai

The engine behind [`testrail-ai-mcp`](../../apps/testrail-mcp) and
[`testrail-ai-cli`](../../apps/testrail-ai-cli). Use it on its own if you are
building something else.

Two separate layers. `get*` fetches, joins and analyses, returning plain typed
data; `format*` turns that data into markdown. Take the data layer and skip
anyone else's presentation choices.

```bash
npm i testrail-ai
```

```ts
import { TestRailClient, loadConfig, getStability } from 'testrail-ai';

const client = new TestRailClient(loadConfig());
const stability = await getStability({ project_id: 5, runs: 10 }, { client });

stability.flaky; // alternating pass↔fail
stability.regressed; // passed, then failed, and stayed failed
stability.recovered; // fixed
```

## What it does

| Function        | Answers                                                         |
| --------------- | --------------------------------------------------------------- |
| `search`        | "What is the id of…?" across eight entity types                 |
| `getRunReport`  | Totals, pass rate, failures clustered by root cause             |
| `getFailures`   | What is failing, with per-step evidence and when it last passed |
| `getStability`  | Flaky, regressed or recovered, three different things           |
| `getCoverage`   | Untraceable cases, dead cases, uncovered requirements           |
| `getCaseDetail` | One case, rich text rendered rather than dumped                 |
| `createCase` …  | The write paths, behind the client's write gate                 |

## Notes

**Response types stay loose on purpose.** Every entity carries an index signature
and marks nullable fields nullable, because TestRail returns an open-ended set of
`custom_*` keys that differ per instance. We checked the published community
schemas against a live instance: they assert `Result.status_id`,
`Test.assignedto_id`, `Test.milestone_id` and `Run.plan_id` as non-null, and all
four come back `null` in practice.

**Pass rate is measured against tests that ran**, not against the suite. An
in-progress run is not a failing run.

**Every tool reads a status the same way.** `statusKind` sorts each status into
passed, failed, unsettled (blocked, retest, a non-final custom status) or
untested (including a custom status flagged `is_untested`). The run report
lists what is not passing, coverage counts what ran, and stability compares only
passed and failed, all from that one classification.

**Every report says whether it is the whole answer.** Reports carry `complete`
and `warnings`: a row cap, plans that could not be read, or a section or suite
lookup that failed each become a warning instead of a silent gap.

**Runs inside test plans count.** Stability, coverage, the latest run and the
last good run all include plan runs. On instances that ignore
`include_plan_runs`, the plans are read directly and their runs merged in.

**Failure clustering strips run-specific noise** (ids, hex, uuids, timestamps,
line numbers and every digit run) so one bug collapses into one cluster and two
bugs stay apart.

## Testing helpers

```ts
import { fakeTestRail, page } from 'testrail-ai/testing';
```

A fake TestRail stubbed at `fetch`, so your tests exercise the real client with
no network: real URL construction, real pagination, real write gate.

MIT.
