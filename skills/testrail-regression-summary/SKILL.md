---
name: testrail-regression-summary
description: >
  Summarises recent TestRail activity for someone who will not open TestRail:
  pass-rate trend across runs, what is broken, what is noise, and a ship or hold
  call. Use this skill for a release readiness note, a sprint QA update,
  "regression summary", "QA status", "how is testing going", or "are we good to
  ship". Do not use for diagnosing one run in depth, which is
  testrail-triage-run, or for gaps in what gets tested, which is
  testrail-coverage-gap.
---

# TestRail regression summary

Uses the `testrail-ai` binary. No MCP server required.

## Prerequisites

`TESTRAIL_URL`, `TESTRAIL_EMAIL` and `TESTRAIL_API_KEY` set. If configuration is
missing, say which variable and stop.

Commands below are written as `testrail-ai`. If that is not on PATH, prefix
each one with `npx -y ` and it works with nothing installed.

## Steps

**1. List the recent runs** and their headline counts:

```bash
testrail-ai search runs --project <id> --limit 10
```

**2. Report on the most recent run** in detail:

```bash
testrail-ai report <newest-run-id>
```

**3. Separate signal from noise** across the window:

```bash
testrail-ai stability <project-id> --runs 10
```

**4. Get the trend as data** when you want to compute pass rates across runs in
place of eyeballing them:

```bash
testrail-ai --json report <run-id> | jq '{run: .runId, rate: .passRate}'
```

## Report back

Write for someone who will not open TestRail. Under 400 words.

**Where we are:** two or three sentences. Is the pass rate improving, flat, or
degrading across the runs you looked at?

**What is broken:** reproducible failures from the `Regressed` section and the
failure clusters. Name them by case id and describe the user-visible impact
rather than repeating the test name.

**What is noise:** cases from the `Flaky` section, with how often they flip. Say
outright that these give no evidence of a regression and that they cost the team
signal.

**Trend table:** run, date, pass rate, failures.

**Recommendation:** ship, hold, or conditional. State the condition.

## Notes

- This tool measures pass rate against tests that **ran**, leaving out the rest
  of the suite. An in-progress run with 95 untested cases shows a high rate over
  a small denominator. Say so, rather than implying full coverage.
- If the newest run has a large "No result comment" section, tell the reader the
  run's outcome is partly unknown. Never present it as clean.
