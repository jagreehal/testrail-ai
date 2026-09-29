---
name: testrail-triage-run
description: >
  Triages one TestRail run: clusters its failures by root cause, separates real
  regressions from flaky noise, and gives a release verdict. Use this skill for
  "triage run 612", "why did last night's regression fail", "what broke in
  TestRail", or "does this run block the release". Do not use for a trend across
  several runs or a stakeholder update, which is testrail-regression-summary, or
  for finding what nobody tests, which is testrail-coverage-gap.
---

# Triage a TestRail run

Uses the `testrail-ai` binary. No MCP server required.

## Prerequisites

These three variables set:

```
TESTRAIL_URL, TESTRAIL_EMAIL, TESTRAIL_API_KEY
```

Every command below is written as `testrail-ai`. If that is not on PATH,
prefix each one with `npx -y ` and it works with nothing installed.

If a command exits non-zero complaining about configuration, stop and tell the
user which variable is missing. Never guess at credentials.

## Steps

**1. Find the run** if the user gave a name in place of an id:

```bash
testrail-ai search runs --project <id> --query "<name>" --limit 10
```

**2. Get the report.** One call gives you totals, pass rate, and failures grouped
by root cause.

```bash
testrail-ai report <run-id>
```

**3. Get the failure detail,** with the last run each case passed in. That bounds
the change that broke it.

```bash
testrail-ai failures <run-id> --last-good
```

**4. Read individual cases** where the failure is unclear:

```bash
testrail-ai case <case-id>
```

**5. Check whether the failures are noise** before calling anything a regression:

```bash
testrail-ai stability <project-id> --runs 10
```

That splits **flaky** (alternating pass and fail), **regressed** (passed, then
failed, and stayed failed) and **recovered**. Treat flaky as noise; the other two
are real.

## Report back

**Verdict:** one line. Is this run releasable, and if not, what blocks it.

**Clusters:** group by root cause. Test names belong inside the cluster. For each
one give the test count, the shared symptom, and your best guess at the cause.
Say when you are guessing.

**Regressions and known failures:** read the `stability` output. A case in the
`Regressed` section broke in the last few runs and needs someone on it. A case
that has failed for months is old debt.

**Unexplained failures:** the report has a "No result comment" section. You
cannot diagnose those from TestRail, so name them and say who to ask.

**Actions:** a short list. Each one names a specific case id and who acts.

Cite cases as `C123`. Include the run URL the tool prints so a human can verify.
Skip the pass/fail numbers in your prose, since the table already gives them.

## Notes

- Add `--json` to any command for structured data in place of markdown, when you
  need to compute over the output rather than read it.
- `failures --last-good` reads several extra runs and takes longer. Skip it when
  the user wants to know what is failing right now.
