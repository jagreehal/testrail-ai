---
name: testrail-coverage-gap
description: >
  Audits what a TestRail project leaves untested: requirements with no covering
  case, cases with no requirement reference, cases that stopped executing, and
  what to write next. Use this skill for "coverage gaps", "what are we not
  testing", "do we have tests for CUR-1234", or "what should I test next". Do
  not use for why a run failed, which is testrail-triage-run, or for a status
  summary of recent runs, which is testrail-regression-summary.
---

# Find TestRail coverage gaps

Uses the `testrail-ai` binary. No MCP server required.

## Prerequisites

`TESTRAIL_URL`, `TESTRAIL_EMAIL` and `TESTRAIL_API_KEY` set.

Commands below are written as `testrail-ai`. If that is not on PATH, prefix
each one with `npx -y ` and it works with nothing installed.

## Steps

**1. Run the coverage analysis:**

```bash
testrail-ai coverage <project-id> --recent-runs 5
```

**2. If the user named specific requirements** (JIRA keys, ticket ids), check
those by hand. TestRail's own UI hides this gap: a requirement with no covering
case at all.

```bash
testrail-ai coverage <project-id> --refs CUR-1234,CUR-1235
```

**3. If a specific run matters,** find what it skipped:

```bash
testrail-ai coverage <project-id> --run <run-id>
```

**4. Read a few of the flagged cases** before recommending deletion. A stale
title can hide a test worth keeping.

```bash
testrail-ai case <case-id> --no-history
```

## Report back

**Biggest gap:** the single most important thing this project leaves untested,
and why you picked it over the others.

**Uncovered requirements:** if you passed `--refs`, list the keys with no case.
Lead with this section whenever it has anything in it, since a reader can act on
it today.

**Untraceable cases:** how many cases carry no requirement reference. Say whether
that reads as a process problem or as legacy cases nobody has revisited.

**Dead cases:** cases that exist but have not executed in the recent runs. For
each, make a call: revive, automate, or delete. A case that has not run in months
is inventory.

**Distribution:** is the priority spread plausible, or is everything Medium? A
suite where nothing is Critical went unprioritised.

**Write next:** three to five concrete cases worth adding, each with a title, the
gap it closes, and a suggested priority.

## Notes

- Ground every claim in the tool's numbers. If the data does not support a
  conclusion, say so rather than filling the space.
- `coverage` reads up to `--limit` cases (500 by default) and one request per
  recent run. On a large project, raise the limit on purpose and expect a few
  seconds.
- "Never executed" is scoped to the runs you asked about. Five runs on a project
  that runs monthly is five months; on a project that runs nightly it is a week.
  Say which window you used.
