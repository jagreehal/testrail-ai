# testrail-ai — behaviour

## src/analysis/case-detail.story.test.ts

### Reading a case

### ✅ renders rich text as text, structured steps as a table, and other fields as JSON

Tags: `case-detail`

- **Given** a case with HTML custom fields, a Steps template and non-text custom fields
- **When** it is read without history
- **Then** HTML is stripped and empty fields are dropped
- **And** non-text custom fields survive as JSON, but nulls and the steps array do not
- **And** no run is fetched when history was not asked for
  **Rendered**

  ```markdown
  # C101 — Login with SSO

  | field    | value                                                 |
  | -------- | ----------------------------------------------------- |
  | section  | Authentication (7)                                    |
  | priority | Critical                                              |
  | type     | type:9                                                |
  | refs     | JIRA-12                                               |
  | estimate | 5m                                                    |
  | template | 2                                                     |
  | updated  | 2026-02-02T02:40:00.000Z                              |
  | link     | https://example.testrail.io/index.php?/cases/view/101 |

  ## preconds

  A user with an SSO account

  ## steps (structured)

  | #   | step       | expected          |
  | --- | ---------- | ----------------- |
  | 1   | Open login | Login page shown  |
  | 2   | Click SSO  | Redirected to IdP |

  ## Other custom fields

  | field             | value |
  | ----------------- | ----- |
  | custom_automated  | true  |
  | custom_components | [1,2] |
  ```

### ✅ walks recent runs for history, skipping runs without the case and results that fail to load

Tags: `case-detail`, `history`

- **Given** three recent runs: one ran the case, one did not include it, one has unreadable results
- **When** history is included (the default)
- **Then** only runs that contained the case appear, with the latest result where it loaded
  **History**

  ```json
  [
    {
      "runId": 1,
      "runName": "Nightly",
      "status": "failed",
      "defects": "BUG-7",
      "comment": "Timed out"
    },
    {
      "runId": 3,
      "runName": "Release",
      "status": "passed",
      "defects": "",
      "comment": ""
    }
  ]
  ```

### ✅ warns when the case may be in the part of a run it could not read

Tags: `case-detail`, `history`, `pagination`

- **Given** a run with more than 2000 tests, none of the first 2000 being C101
- **Then** the empty history is marked incomplete, naming the run

### ✅ degrades when the section is unreadable and the case has no project

Tags: `case-detail`, `resilience`

- **Given** a sparse case whose section lookup fails
- **When** it is read with history
- **Then** the section falls back to its id, and history is empty without a project to search
- **And** the report says what it could not read

### ✅ still reads the case when its suite cannot be read for history

Tags: `case-detail`, `history`, `resilience`

- **Given** a case whose suite lookup is forbidden
- **When** it is read with history
- **Then** the case comes back with no history, and no runs are listed

### ✅ rejects an invalid case id before calling TestRail

Tags: `case-detail`, `validation`

## src/analysis/coverage.story.test.ts

### Finding coverage gaps

### ✅ separates unreferenced cases, uncovered requirements and never-executed cases

Tags: `coverage`

- **Given** four cases, two with requirement refs, and two recent runs
- **When** coverage is checked against three named requirements, matched case-insensitively
- **Then** only JIRA-9 has no covering case
- **And** blank refs count as unreferenced
- **And** an untested result is not execution
- **And** distribution is sorted by count
  **Rendered**

  ```markdown
  # Coverage — project 5

  4 cases analysed.

  ## Distribution

  | priority | cases |
  | -------- | ----- |
  | Medium   | 3     |
  | Critical | 1     |

  | type   | cases |
  | ------ | ----- |
  | type:1 | 3     |
  | type:7 | 1     |

  ## Cases with no requirement reference (2 of 4)

  | case | title  | priority |
  | ---- | ------ | -------- |
  | 3    | Case 3 | Medium   |
  | 4    | Case 4 | Medium   |

  ## Requirements with no covering case (1 of 3)

  - JIRA-9

  ## Never executed in the last 2 runs (2 of 4)

  | case | title  | priority | updated    |
  | ---- | ------ | -------- | ---------- |
  | 2    | Case 2 | Medium   | 2026-02-02 |
  | 4    | Case 4 | Medium   | 2026-02-02 |
  ```

### ✅ reports what a run skipped, and skips the recent-runs walk when asked

Tags: `coverage`, `run-gaps`

- **Given** a run containing cases 1 and 2, with 2 still untested
- **When** coverage is compared to that run with recent_runs 0
- **Then** cases 3 and 4 are missing from the run and case 2 is untested in it
- **And** no recent runs were fetched, and no requirement section is rendered

### ✅ warns instead of claiming completeness when cases or tests were capped

Tags: `coverage`, `pagination`, `regression`

- **Given** more cases than the limit, and a run and a recent run with more than 2000 tests
- **Then** each cap is named

### ✅ says so plainly when there is no gap

Tags: `coverage`

### ✅ caps long tables and says how many rows it left out

Tags: `coverage`, `format`

- **Then** both the unreferenced and never-executed tables stop at 50

### ✅ refuses a project with no cases, and invalid input before any request

Tags: `coverage`, `validation`

## src/analysis/failures.story.test.ts

### Failure detail

### ✅ carries the latest comment, defects, per-step outcome and attachments for each failure

Tags: `failures`

- **Given** a run with one failure that has a rich result and one with no result at all
- **When** failures are fetched
  **Rendered**

  ```markdown
  # 2 non-passing tests in run 612

  Regression — https://example.testrail.io/index.php?/runs/view/612

  | case | title  | status  | assigned   | elapsed | defects |
  | ---- | ------ | ------- | ---------- | ------- | ------- |
  | 20   | Login  | failed  | user:3     | 1m 5s   | CUR-9   |
  | 21   | Logout | blocked | unassigned |         |         |

  ## Result comments

  **C20 — Login**

  Failed at step 2 of 2.
  ```

  Timed out & gave up

  ```

  | # | step | expected | actual | status |
  | --- | --- | --- | --- | --- |
  | 1 | Open page | Page loads |  | passed |
  | 2 | Submit | Signed in | Spinner forever | failed |

  _2 attachments — fetch with `get_attachments_for_test/10`._

  ```

- **Then** only failing statuses were asked for
- **And** the newest result supplies the evidence
- **And** the markdown leads with the failing step and points at the attachments
  > A failure with no comment, steps or attachments gets no evidence block of its own.

### ✅ says plainly when nothing in the run is failing

Tags: `failures`

### ✅ warns when the result history was capped, since comments may be missing

Tags: `failures`, `pagination`

### Failure report completeness

### ✅ warns when more failures exist than the requested limit

Tags: `failures`, `pagination`, `regression`

### Finding the last good run

### ✅ walks back through earlier runs of the same suite until each case is seen passing

Tags: `failures`, `last-good`

- **Given** two failures: one passed in the previous run, one never passed in the lookback
- **When** failures are fetched with include_last_good
  **Rendered**

  ```markdown
  # 2 non-passing tests in run 612

  Regression — https://example.testrail.io/index.php?/runs/view/612

  | case | title  | status  | assigned   | elapsed | defects | last passed in       |
  | ---- | ------ | ------- | ---------- | ------- | ------- | -------------------- |
  | 20   | Login  | failed  | user:3     |         |         | run 611 (2023-11-13) |
  | 21   | Logout | blocked | unassigned |         |         | not in lookback      |

  ## Result comments
  ```

- **Then** only earlier runs of the same suite are searched, bounded by the lookback
- **And** each failure names the run it last passed in, or says it was not found

### ✅ only counts a pass under the same configuration as the failing run

Tags: `configurations`, `failures`, `last-good`

- **Given** a Chrome run failing C20, which passed on Safari yesterday and on Chrome the day before
- **Then** the last good run is the Chrome one

### ✅ stops walking back as soon as every failure has been placed

Tags: `failures`, `last-good`, `performance`

- **Then** a run without a suite searches the whole project, and the second run is never fetched

### ✅ warns when a lookback run had more passing tests than it could read

Tags: `failures`, `last-good`, `pagination`

## src/analysis/run-report.story.test.ts

### Reporting on a run

### ✅ warns when the test list is capped instead of claiming a complete report

Tags: `pagination`, `regression`, `run-report`

### ✅ groups failures sharing a cause into one cluster

Tags: `run-report`

- **Given** a run where three tests failed with the same timeout, differing only in duration
- **When** the run is reported on
  **Clusters**

  ```json
  [
    {
      "signature": "timeout after <n>ms",
      "size": 3
    }
  ]
  ```

- **Then** one cluster is reported, not three separate failures
  > Three tests, one bug. This is the difference between a readable report and a wall of noise.
- **And** a sample comment is carried so the reader sees the real message

### ✅ keeps genuinely different failures in separate clusters

Tags: `run-report`

- **Given** two failures with unrelated causes
- **When** the run is reported on
- **Then** they stay apart

### ✅ separates unexplained failures instead of lumping them into one fake cluster

Tags: `run-report`

- **Given** a run where most non-passing tests have no result comment
  > On a real 986-test run this was 46 of 58 failures. Clustering them produced one meaningless group that buried the seven real clusters.
- **When** the run is reported on
- **Then** only the explained failure forms a cluster
- **And** the unexplained ones are reported separately
- **And** the report is rendered
  **Output**

  ```markdown
  # Manual Regression

  Run 612 · open · created 2026-02-02 by user:16
  https://example.testrail.io/index.php?/runs/view/612

  **42.9% passing** — 3 passed, 3 failed, 1 blocked, 0 retest, 0 untested (7 total)

  ## Status breakdown

  | status  | count |
  | ------- | ----- |
  | failed  | 2     |
  | blocked | 1     |

  ## Failure clusters (1 distinct from 1 explained failures)

  ### 1× — timeout after <n>ms

  | test | case | title | status | defects |
  | ---- | ---- | ----- | ------ | ------- |
  | 1    | 101  | Login | failed |         |

  Sample comment:
  ```

  Timeout after 30000ms

  ```


  ## No result comment (2 of 3 non-passing)

  These failed or were blocked with no explanation recorded, so there is nothing to diagnose from TestRail alone — someone has to be asked, or the run re-executed.

  | status | count |
  | --- | --- |
  | failed | 1 |
  | blocked | 1 |

  | case | title | status |
  | --- | --- | --- |
  | 102 | Checkout | failed |
  | 103 | Search | blocked |
  ```

- **And** the gap is named as a gap in the record, not as a cause

### Pass rate arithmetic

### ✅ measures against what actually ran, not what was planned

Tags: `run-report`

- **Given** an in-progress run: 4 passed, 1 failed, and 95 still untested
  **Counts**

  | passed | failed | untested |
  | ------ | ------ | -------- |
  | 4      | 1      | 95       |

- **When** the pass rate is calculated
  - **Pass rate:** 80.0%
- **Then** it is 80% — four of the five tests that ran
  > Counting untested as failures would show 4%, making an in-progress run look catastrophic. Counting them as passes would hide the failure entirely.
- **And** the untested tests are still reported in the totals

### ✅ reports no pass rate at all when nothing has run

Tags: `edge-case`, `run-report`

- **Given** a run where every test is untested
- **When** the run is reported on
- **Then** the pass rate is null rather than a misleading 0%
- **And** the rendered report shows a dash

### ✅ counts tests on a custom status in the totals and the pass rate

Tags: `custom-status`, `run-report`

- **Given** one test passed, one on a custom status, one on a custom status that means not yet run
- **When** the run is reported on
- **Then** three tests in total, and half of those that ran passed

### Choosing which run to report on

### ✅ falls back to the latest run in a project when no run is named

Tags: `run-report`

- **Given** a project whose most recent run is 612
- **When** a report is asked for by project alone
- **Then** the latest run is used

### ✅ asks for one or the other rather than guessing

Tags: `edge-case`, `run-report`

- **Given** neither a run id nor a project id
- **When** a report is requested
- **Then** it explains what is missing

### Rendering the report

### ✅ produces markdown that renders — headings and tables keep their blank lines

Tags: `formatting`, `run-report`

- **Given** a report with a heading followed by a table
  > An earlier version stripped every blank line, which silently broke all markdown rendering.
- **When** the report is rendered
  **Output**

  ```markdown
  # Manual Regression

  Run 612 · open · created 2026-02-02 by user:16
  https://example.testrail.io/index.php?/runs/view/612

  **42.9% passing** — 3 passed, 3 failed, 1 blocked, 0 retest, 0 untested (7 total)

  ## Status breakdown

  | status | count |
  | ------ | ----- |
  | passed | 1     |
  ```

- **Then** a blank line separates the heading from its table
- **And** the run link is present for a human to verify against

## src/analysis/runs.story.test.ts

### Listing recent runs, plan runs included

### ✅ asks TestRail for plan runs, and stops there when it returns them

Tags: `plans`, `runs`

- **Given** an instance that honours include_plan_runs
- **When** the three most recent runs are listed
- **Then** the plan run is among them, and no plan is read in detail
  > The plan list goes out alongside the runs, so a project without plan runs pays no extra round trip.

### ✅ reads the plans itself when an older instance ignores the flag

Tags: `compatibility`, `plans`, `runs`

- **Given** an instance that returns only standalone runs, and a plan with two runs
- **When** the three most recent runs of suite 20 are listed
- **Then** plan runs merge in newest first, without duplicates or other suites
  **Runs returned**

  | id  | created_on |
  | --- | ---------- |
  | 6   | 60         |
  | 4   | 40         |
  | 1   | 10         |

### ✅ keeps a lookback window before its cut-off, and reports a cap

Tags: `plans`, `runs`

- **Given** plan runs on both sides of a cut-off
- **When** one run created before 50 is asked for
- **Then** the later plan run is left out, and the cap is reported

### ✅ keeps the standalone runs and says so when the plans cannot be read

Tags: `plans`, `resilience`, `runs`

- **Given** an API key that cannot list plans
- **When** the runs are listed
- **Then** the standalone runs come back with a warning naming what is missing

### ✅ says so when there are more plans than it reads

Tags: `pagination`, `plans`, `runs`

- **Given** a project with more test plans than the fallback reads
- **When** the runs are listed
- **Then** the result names the plans it did not read

### ✅ adds nothing for a project without plans

Tags: `plans`, `runs`

- **Given** standalone runs and no plans
- **When** the runs are listed
- **Then** the runs come back as TestRail listed them

## src/analysis/search.story.test.ts

### Search completeness and validation

### ✅ reports when a non-case search was capped

Tags: `pagination`, `regression`, `search`

### ✅ rejects an unknown entity before loading metadata or calling TestRail

Tags: `regression`, `search`, `validation`

### Searching cases

### ✅ asks TestRail to filter by requirement and label rather than fetching everything

Tags: `search`

- **Given** a project whose cases are linked to Jira tickets and tagged with labels
- **When** someone asks which cases cover JIRA-1234 under labels 3 or 7
- **Then** both filters travel in the request, so TestRail does the narrowing
  > Filtering client-side would mean paging through every case in the project to answer a question about one ticket.

### Searching every entity

### ✅ finds projects whose name contains the query, ignoring case

Tags: `projects`, `search`

- **Given** projects in TestRail, some matching "CORE" and some not
- **When** searching projects for "CORE"
  **Rendered**

  ```
  ## Projects (2)

  | id | name | suite mode | completed |
  | --- | --- | --- | --- |
  | 1 | Core | single |  |
  | 2 | Legacy core | baselines | yes |
  ```

- **Then** only matching rows come back, rendered as table cells

### ✅ finds suites whose name contains the query, ignoring case

Tags: `search`, `suites`

- **Given** suites in TestRail, some matching "CORE" and some not
- **When** searching suites for "CORE"
  **Rendered**

  ```
  ## Suites (1)

  | id | name | description |
  | --- | --- | --- |
  | 7 | Core smoke | Fast checks |
  ```

- **Then** only matching rows come back, rendered as table cells

### ✅ finds sections whose name contains the query, ignoring case

Tags: `search`, `sections`

- **Given** sections in TestRail, some matching "CORE" and some not
- **When** searching sections for "CORE"
  **Rendered**

  ```
  ## Sections (2)

  | id | name | path |
  | --- | --- | --- |
  | 30 | Core login | Core login |
  | 31 | Core logout | Core login > Core logout |

  _Pass a path as section_path to list a section's cases._
  ```

- **Then** only matching rows come back, rendered as table cells

### ✅ finds runs whose name contains the query, ignoring case

Tags: `runs`, `search`

- **Given** runs in TestRail, some matching "CORE" and some not
- **When** searching runs for "CORE"
  **Rendered**

  ```
  ## Runs (2)

  | id | name | created | passed | failed | blocked | untested | status |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | 600 | Core regression | 2023-11-14 | 9 | 1 | 0 | 2 | open |
  | 602 | Core release | 2023-11-14 | 4 | 0 | 0 | 0 | open |

  _Use the run report with a run id for the breakdown._
  ```

- **Then** only matching rows come back, rendered as table cells

### ✅ finds plans whose name contains the query, ignoring case

Tags: `plans`, `search`

- **Given** plans in TestRail, some matching "CORE" and some not
- **When** searching plans for "CORE"
  **Rendered**

  ```
  ## Test plans (1)

  | id | name | created | status |
  | --- | --- | --- | --- |
  | 40 | Core release | 2023-11-14 | closed |
  ```

- **Then** only matching rows come back, rendered as table cells

### ✅ finds milestones whose name contains the query, ignoring case

Tags: `milestones`, `search`

- **Given** milestones in TestRail, some matching "CORE" and some not
- **When** searching milestones for "CORE"
  **Rendered**

  ```
  ## Milestones (2)

  | id | name | due | status |
  | --- | --- | --- | --- |
  | 50 | Core 1.0 |  | open |
  | 51 | Core 2.0 | 2023-11-14 | complete |
  ```

- **Then** only matching rows come back, rendered as table cells

### ✅ finds tests whose name contains the query, ignoring case

Tags: `search`, `tests`

- **Given** tests in TestRail, some matching "CORE" and some not
- **When** searching tests for "CORE"
  **Rendered**

  ```
  ## Tests (1)

  | id | case | title | status | assigned to |
  | --- | --- | --- | --- | --- |
  | 900 | 20 | Core login works | failed | user:3 |
  ```

- **Then** only matching rows come back, rendered as table cells

### ✅ lists every row when there is no query

Tags: `search`

### ✅ points a run search at the run report, and says when it was capped

Tags: `pagination`, `runs`, `search`

### ✅ names cases by priority and type, and lets TestRail match their titles

Tags: `cases`, `search`

- **Then** the query becomes a server-side filter and nothing is dropped client-side

### Pushing every filter down to TestRail

### ✅ sends each case filter as a query parameter

Tags: `cases`, `filters`, `search`

- **When** every case filter is set, with ISO dates
- **Then** each one is in the URL, dates as unix seconds

### ✅ turns a relative offset into a timestamp that far back

Tags: `filters`, `search`

### ✅ refuses a date it cannot read instead of silently dropping the filter

Tags: `filters`, `search`, `validation`

### ✅ filters tests by status in the request

Tags: `filters`, `search`, `tests`

### Finding cases by section path

### ✅ lists a section by its path instead of its id

Tags: `cases`, `search`, `sections`

- **Given** a single-suite project with Checkout > Payments > Cards
- **When** cases are searched with section_path 'checkout > payments > cards'
- **Then** the path resolves to section 3, matched without case

### ✅ starts the path with the suite name when the project has several suites

Tags: `cases`, `search`, `sections`

- **Then** the suite's own section tree is read, and the case search stays in that section

### Search that needs an id it was not given

### ✅ refuses tests without a run_id, before any request

Tags: `search`, `validation`

### Capped searches

### ✅ tells a capped case search to narrow the filters

Tags: `cases`, `pagination`, `search`

### ✅ renders an empty result as none

Tags: `search`

## src/analysis/stability.story.test.ts

### Test stability classification

### ✅ treats a single pass-to-fail transition as a regression, not flakiness

Tags: `stability`

- **Given** a case that passed in one run and failed in the next
  **Timeline**

    <details>
    <summary>snapshot</summary>

  ```json
  ".X"
  ```

    </details>

- **When** its history is classified
  **Classification**

  ```json
  {
    "flips": 1,
    "runs": 2,
    "failures": 1,
    "endedFailing": true
  }
  ```

- **Then** exactly one transition is counted
- **And** the case is recorded as ending in a failed state
- **But** one transition is below the flaky threshold of two

### ✅ treats a single fail-to-pass transition as a recovery

Tags: `stability`

- **Given** a case that failed and then passed
- **When** its history is classified
- **Then** one transition is counted, ending in a passing state

### ✅ requires genuine alternation before calling a case flaky

Tags: `stability`

- **Given** a case that passed, failed, then passed again
- **When** its history is classified
  **Classification**

  ```json
  {
    "flips": 2,
    "runs": 3,
    "failures": 1,
    "endedFailing": false
  }
  ```

- **Then** two transitions are counted across three settled runs
- **And** that is what qualifies it as flaky rather than regressed

### ✅ does not count untested, blocked or retest runs as instability

Tags: `stability`

- **Given** a case that passed, was skipped three times, then passed again
  > Untested/blocked/retest mean "we do not know yet", not "it failed".
- **When** its history is classified
- **Then** no transitions are counted
- **And** only the two settled runs are considered
- **But** none of the unsettled runs are counted as failures

### ✅ reports a consistently failing case as broken, not flaky

Tags: `stability`

- **Given** a case that failed in all three runs
- **When** its history is classified
- **Then** there are no transitions, so it is not flaky
- **And** all three runs are recorded as failures

### ✅ handles a case with no history at all

Tags: `edge-case`, `stability`

- **Given** a case that has never appeared in a run
- **When** its history is classified
- **Then** every count is zero and nothing throws

### Stability report over a project

### ✅ separates flaky, regressed and recovered cases in one pass

Tags: `stability`

- **Given** a project with three runs and three cases behaving differently
  **Expected behaviour**

  | Case        | Run 1 | Run 2 | Run 3 | Verdict                             |
  | ----------- | ----- | ----- | ----- | ----------------------------------- |
  | 10 Login    | pass  | fail  | pass  | flaky — alternates                  |
  | 20 Checkout | pass  | pass  | fail  | regressed — broke and stayed broken |
  | 30 Search   | fail  | fail  | pass  | recovered — fixed                   |

- **When** stability is analysed across those runs
  **Verdicts**

  ```json
  {
    "flaky": [10],
    "regressed": [20],
    "recovered": [30]
  }
  ```

- **Then** only the alternating case is reported as flaky
- **And** the case that broke and stayed broken is reported as regressed
- **And** the case that was fixed is reported as recovered
- **And** the timeline reads oldest to newest

### ✅ says so plainly when nothing changed state

Tags: `stability`

- **Given** a project where every case passed in both runs
- **When** stability is analysed and formatted
- **Then** all three buckets are empty
- **And** the report says nothing changed rather than printing empty tables
  **Output**

  ```markdown
  No case changed pass↔fail state. Across 2 runs (1970-01-01 → 1970-01-01) of project 5.
  ```

### ✅ keeps each configuration to its own history

Tags: `configurations`, `stability`

- **Given** one case passing on Chrome, failing on Safari, then passing on Chrome
- **Then** a browser difference is not reported as flakiness
  **Output**

  ```markdown
  No case changed pass↔fail state. Across 3 runs (1970-01-01 → 1970-01-01) of project 5.

  _1 case had fewer than two settled results, too few to judge._
  ```

### ✅ does not claim nothing changed when a case alternated below the threshold

Tags: `stability`

- **Given** a case that went pass, fail, pass, with min_flips 3
  **Output**

  ```markdown
  No case met the reporting criteria. Across 3 runs (1970-01-01 → 1970-01-01) of project 5.

  _1 case alternated fewer than 3 times, so is not listed._
  ```

- **Then** it says the case fell below the threshold

### ✅ still shows what fell below the threshold when something else is listed

Tags: `stability`

- **Given** with min_flips 3, one case going .X.X and another going .X..
  **Output**

  ```markdown
  # Stability — 1 flaky, 0 regressed, 0 recovered

  Across 4 runs (1970-01-01 → 1970-01-01) of project 5.

  _1 case alternated fewer than 3 times, so is not listed._

  ## Flaky (1)

  _At least 3 pass↔fail transitions over 3+ settled runs — genuinely alternating._

  | case | title   | flips | settled runs | failures | timeline |
  | ---- | ------- | ----- | ------------ | -------- | -------- |
  | 10   | Case 10 | 3     | 4            | 2        | .X.X     |

  _Timeline is oldest → newest: `.` passed, `X` failed, `-` untested/blocked/retest._
  ```

- **Then** one case is flaky, and the other is counted rather than dropped

### ✅ follows a configuration by its ids, so a rename keeps one history

Tags: `configurations`, `stability`

- **Given** Chrome passing, then the same configuration renamed and failing, with Safari alongside
- **Then** Chrome is one history, a regression, shown under the newest run name
- **And** Safari, with a single result, is counted as too little evidence

### ✅ refuses to guess from a single run

Tags: `edge-case`, `stability`

- **Given** a project with only one run
- **When** stability is requested
- **Then** it fails loudly instead of reporting everything as stable

### Stability report formatting

### ✅ leads with the counts a reader acts on

Tags: `formatting`, `stability`

- **Given** a report with one flaky, one regressed and one recovered case
- **When** the report is formatted as markdown
  **Output**

  ```markdown
  # Stability — 1 flaky, 1 regressed, 0 recovered

  Across 3 runs (1970-01-01 → 1970-01-01) of project 5.

  ## Flaky (1)

  _At least 2 pass↔fail transitions over 3+ settled runs — genuinely alternating._

  | case | title | flips | settled runs | failures | timeline |
  | ---- | ----- | ----- | ------------ | -------- | -------- |
  | 10   | Login | 2     | 3            | 1        | .X.      |

  ## Regressed (1)

  _Passed, then failed, and stayed failed. These are the ones to act on._

  | case | title    | settled runs | timeline |
  | ---- | -------- | ------------ | -------- |
  | 20   | Checkout | 3            | ..X      |

  _Timeline is oldest → newest: `.` passed, `X` failed, `-` untested/blocked/retest._
  ```

- **Then** the heading carries all three counts
- **And** the regressed section explains why it is the urgent one
- **But** empty sections are omitted rather than printed blank

## src/client.story.test.ts

### Write protection

### ✅ refuses every mutating verb when writes are disabled

Tags: `safety`

- **Given** TestRail's mutating endpoint verbs
  **Classified as writes**

  | Endpoint                |
  | ----------------------- |
  | add_result_for_case/1/2 |
  | update_case/5           |
  | delete_run/9            |
  | close_run/9             |
  | move_cases_to_section/3 |
  | copy_cases_to_section/3 |
  | push_something/1        |
  | add%5fresult/1          |
  | UPDATE_CASE/5           |

- **When** each is classified
- **Then** all are recognised as writes
- **But** read endpoints are not

### ✅ blocks a write before any request reaches TestRail

Tags: `safety`

- **Given** a client with writes disabled
- **When** a write endpoint is called
- **Then** it is rejected
- **And** crucially, no HTTP request was made at all
  > The gate runs before the request is built, so a read-only deployment cannot leak a write.

### ✅ allows writes through once they are explicitly enabled

Tags: `safety`

- **Given** a client with TESTRAIL_ALLOW_WRITES set
- **When** the same write is called
- **Then** it reaches TestRail and returns the result

### Pagination

### ✅ follows _links.next until TestRail runs out of pages

Tags: `pagination`

- **Given** a project whose cases span three pages
- **When** the collection is listed
  **Requests made**

  ```json
  ["get_cases/5&limit=250", "get_cases/5&limit=250&offset=2", "get_cases/5&limit=250&offset=4"]
  ```

- **Then** every page is fetched and concatenated in order
- **And** the caller is told the list is complete
- **And** exactly three requests were made — no extra page after the last

### ✅ stops at the row cap and says it was capped

Tags: `pagination`

- **Given** a project with more cases than the caller asked for
- **When** the caller asks for at most 2 rows
- **Then** only 2 rows come back
- **And** the truncation is reported rather than hidden
  > A silent cap reads as "that is everything", which is how people miss data.

### ✅ handles the bare arrays older TestRail instances return

Tags: `compatibility`, `pagination`

- **Given** an endpoint that answers with a bare array, not an envelope
  > Older TestRail builds — and a few endpoints even on new ones — do this.
- **When** the collection is listed
- **Then** the array is used as-is instead of failing on a missing key

### ✅ enforces the row cap for bare-array responses

Tags: `compatibility`, `pagination`, `regression`

### ✅ does not call an exactly-full final page truncated

Tags: `pagination`, `regression`

### ✅ keeps concurrent fake clients isolated

Tags: `regression`, `testing`

### ✅ fails clearly when the expected collection key is missing

Tags: `edge-case`, `pagination`

- **Given** a response with neither the collection nor an array
- **When** the collection is listed
- **Then** the error names the key we wanted and what we got instead

### ✅ rejects invalid public row limits before making a request

Tags: `pagination`, `validation`

### Error handling

### ✅ surfaces TestRail's own error message, not just a status code

Tags: `errors`

- **Given** TestRail rejecting a request with a specific reason
- **When** the request is made
- **Then** the reported message includes what TestRail actually said
- **And** the status and endpoint are attached for the caller to branch on

### ✅ retries a rate limit and honours Retry-After

Tags: `errors`, `resilience`

- **Given** TestRail Cloud rate-limiting the first attempt
- **When** a request is made
- **Then** the 429 is retried rather than surfaced as a failure
  > 429 is routine on TestRail Cloud; treating it as an error would make the tools flaky.

### ✅ retries a transient gateway error on a read, but never on a write

Tags: `errors`, `resilience`

- **Given** TestRail's load balancer answering 502 once before recovering
- **When** a read hits it
- **Then** the read is retried rather than failing the whole report
- **And** a write hits the same error
- **And** the write is surfaced instead, attempted exactly once
  > TestRail may have applied the POST before the gateway gave up; replaying it would double-post results.

### ✅ retries transport failures on reads, but never risks replaying a write

Tags: `errors`, `resilience`, `safety`

### ✅ understands HTTP-date Retry-After and caps excessive waits

Tags: `errors`, `resilience`

### ✅ classifies timeouts and malformed successful responses

Tags: `errors`, `resilience`

### ✅ rejects absolute and control-character endpoints before fetching

Tags: `security`, `validation`

### ✅ tolerates the empty body some write endpoints return

Tags: `compatibility`, `errors`

- **Given** an endpoint that answers 200 with no body
  > close_run does this on older TestRail builds.
- **When** the request is made
- **Then** an empty object comes back instead of a JSON parse error

### URL construction

### ✅ builds TestRail's peculiar query-string API paths

Tags: `compatibility`

- **Given** a TestRail instance URL
  > The whole /api/v2/... path is the VALUE of index.php's first parameter.
- **When** a browser link for a run is requested
- **Then** it points at the run view, not the API

### ✅ strips a trailing slash so the path does not double up

Tags: `compatibility`, `edge-case`

- **Given** a configured URL with a trailing slash
- **When** a link is built
- **Then** there is exactly one slash before index.php

## src/config.story.test.ts

### Secure configuration

### ✅ requires TLS anywhere except a loopback development server

Tags: `configuration`, `security`

### ✅ refuses credentials, query strings and fragments in the base URL

Tags: `configuration`, `security`

### ✅ bounds resource and timeout controls

Tags: `configuration`, `resilience`

### ✅ reads an optional default project

Tags: `configuration`

## src/format.story.test.ts

### Converting TestRail rich text to readable plain text

### ✅ turns block-level HTML into line breaks

Tags: `formatting`

- **Given** rich text stored as HTML fragments
- **When** it is converted
- **Then** paragraphs are separated by a blank line, as markdown expects
- **And** list items become markdown bullets
- **And** unclosed <p> still breaks — valid HTML that TestRail really emits
- **But** nesting never produces more than one blank line

### ✅ keeps the line breaks in content pasted from Jira

Tags: `formatting`

- **Given** a Gherkin scenario pasted from Jira, one <span> per line

  > Jira code blocks carry no block-level tag at all — each line is a styled span.
  > **Stored HTML**

  ```html
  <p>
    <span data-ds--code--row="" style="white-space: pre;"><strong>Given</strong> a publisher</span
    ><span data-ds--code--row="" style="white-space: pre;"><strong>When</strong> I import</span
    ><span data-ds--code--row="" style="white-space: pre;"><strong>Then</strong> it is skipped</span>
  </p>
  ```

- **When** it is converted
  **Result**

  ```
  Given a publisher
  When I import
  Then it is skipped
  ```

- **Then** each Gherkin line survives on its own line
  > Before this was handled the whole scenario collapsed onto one unreadable line.

### ✅ decodes HTML entities exactly once

Tags: `formatting`

- **Given** text containing the entities TestRail emits
- **When** it is converted
- **Then** named and numeric entities both decode
- **But** a double-encoded tag must not decode into a real one
  > Decoding &amp; last is what prevents &amp;lt;script&amp;gt; becoming markup.

### ✅ drops inline styling but never the content

Tags: `formatting`

- **Given** a paragraph carrying TestRail's editor styling
- **When** it is converted
- **Then** only the words remain

### ✅ is safe on empty and missing values

Tags: `edge-case`, `formatting`

- **Given** a field that is null, undefined or empty
- **When** it is converted
- **Then** an empty string comes back rather than a crash

### Truncating without lying

### ✅ marks a cut in prose and stays inline in table cells

Tags: `formatting`

- **Given** text longer than the budget
- **When** it is truncated for prose
- **Then** the reader is told how much was removed
  > A silent cut reads as fact; a marked one reads as a cut.
- **And** short text is left alone
- **And** the same text is clipped for a table cell
- **And** it ends in an ellipsis and contains no newline

### Grouping failures by cause

### ✅ collapses the same bug reported with different numbers

Tags: `clustering`

- **Given** two failures that are the same bug with different timings
  **Messages**

  | Message                                             |
  | --------------------------------------------------- |
  | Timeout after 30000ms at foo.ts:12:5 (trace 0xAB12) |
  | Timeout after 45000ms at foo.ts:98:2 (trace 0xFF99) |

- **When** their messages are normalised
  **Normalised**

  ```json
  "timeout after <n>ms at foo.ts:<line>:<col> (trace <hex>)"
  ```

- **Then** they reduce to the same signature
  > Digit runs are replaced wholesale — `30000ms` and `45000ms` must not split one bug in two.
- **But** a genuinely different failure keeps its own signature

### ✅ collapses uuids and timestamps too

Tags: `clustering`

- **Given** two runs of the same failure with different ids and times
- **When** their messages are normalised
- **Then** the run-specific parts do not keep them apart

### ✅ groups a mixed set of failures into distinct clusters

Tags: `clustering`

- **Given** three failures, two of which share a cause
- **When** they are clustered
- **Then** two clusters come back, not three
- **And** the shared cause holds both of its failures

### ✅ labels an empty message rather than clustering on nothing

Tags: `clustering`, `edge-case`

- **Given** a failure with no comment
- **When** its message is normalised
- **Then** it is labelled explicitly

### Rendering tables

### ✅ escapes content that would otherwise break the layout

Tags: `formatting`

- **Given** a cell containing a pipe and a newline
- **When** the table is rendered
  **Rendered**

  ```markdown
  | a    | b           |
  | ---- | ----------- |
  | x\|y | line1 line2 |
  ```

- **Then** the table is still exactly three lines
- **And** the pipe is escaped so it does not create a column

### ✅ says "none" instead of rendering an empty table

Tags: `edge-case`, `formatting`

- **Given** no rows
- **When** the table is rendered
- **Then** a readable placeholder appears

### Reading dates the way people write them

### ✅ accepts ISO dates and relative offsets

Tags: `input`

- **Given** TestRail's filters, which take unix seconds
- **When** an ISO date is supplied
- **Then** it converts
- **And** a relative offset like '7d' is supplied
- **And** it resolves to seven days ago
- **And** no value means no filter, not epoch zero

### ✅ rejects prose loudly rather than silently returning everything

Tags: `input`, `safety`

- **Given** an unparseable value like 'last month'
- **When** it is converted
- **Then** it throws with guidance on the accepted formats
  > Silently dropping the filter would return the whole project and look like a valid answer.

### Structured test steps

### ✅ shows only the columns the instance actually populates

Tags: `steps`

- **Given** a case with steps but no recorded outcomes
  **Rendered**

  ```markdown
  | #   | step        | expected     |
  | --- | ----------- | ------------ |
  | 1   | Click login | Form appears |
  ```

- **Then** only step and expected are shown
- **When** the same steps carry actual results and statuses
  **Rendered**

  ```markdown
  | #   | step        | expected     | actual     | status |
  | --- | ----------- | ------------ | ---------- | ------ |
  | 1   | Click login | Form appears | Blank page | failed |
  ```

- **And** the actual and status columns appear

### ✅ strips HTML inside steps and ignores anything that is not a list

Tags: `edge-case`, `steps`

- **Given** a step whose content is HTML
- **When** the table is rendered
- **Then** the markup is gone but the words remain
- **But** a missing or empty step list renders nothing at all
- **And** anything that is not a list decodes to no steps, and a cell that is not text to blank

### ✅ reports which step numbers failed

Tags: `steps`

- **Given** a four-step test where step 2 failed and step 4 was blocked
- **When** the failing steps are identified
- **Then** they are reported 1-indexed, as a human counts them
- **But** an untested step is not a failure
  > Step 3 was untested and is deliberately absent.

## src/meta.story.test.ts

### Reference-data ownership

### ✅ never shares cached users or statuses between credentialed clients

Tags: `cache`, `regression`, `security`

### ✅ coalesces concurrent loads for the same client

Tags: `cache`, `concurrency`

### ✅ treats a forbidden user directory as optional

Tags: `permissions`, `resilience`

### ✅ names the people a report shows when the key cannot list everyone

Tags: `permissions`, `users`

- **Given** a key that cannot list users, but can read one: user 3 exists, user 4 does not
- **When** a report names users 3, 4, 3 and nobody
- **Then** Alice is named, the unknown id stays an id, and each is asked for once
- **And** a later report reuses what was learned, without asking again

### ✅ does not hide an upstream user-directory outage

Tags: `errors`, `regression`, `resilience`

## src/write/write.story.test.ts

### Building a case payload

### ✅ sends only the fields the caller actually supplied

Tags: `safety`, `writes`

- **Given** an update that changes only the title
- **When** the payload is built
  **Payload**

  ```json
  {
    "title": "New title"
  }
  ```

- **Then** the payload contains exactly one key
  > TestRail treats a present key as an instruction. Sending undefined fields would blank out the steps, refs and estimate the caller never mentioned.

### ✅ maps friendly names onto TestRail custom fields

Tags: `writes`

- **Given** steps, preconditions and expected results
- **When** the payload is built
  **Payload**

  ```json
  {
    "custom_steps": "do it",
    "custom_preconds": "be ready",
    "custom_expected": "it worked"
  }
  ```

- **Then** they land under TestRail's custom_ names

### ✅ supports the structured steps a Steps-template case needs

Tags: `writes`

- **Given** a case using template 2, with structured steps
  > Sending structured steps to a Text-template case is accepted by the API and silently renders nothing — hence the explicit template_id.
- **When** the payload is built
  **Payload**

  ```json
  {
    "template_id": 2,
    "custom_steps_separated": [
      {
        "content": "Click login",
        "expected": "Form appears"
      },
      {
        "content": "Submit",
        "expected": ""
      }
    ]
  }
  ```

- **Then** the steps go under custom_steps_separated
- **And** every row carries an expected value, even when it was omitted

### ✅ passes instance-specific custom fields straight through

Tags: `writes`

- **Given** a field that only exists on this TestRail instance
- **When** the payload is built
- **Then** it is sent verbatim alongside the known fields

### ✅ refuses custom-field entries that can overwrite standard fields

Tags: `safety`, `validation`, `writes`

### Write target validation

### ✅ rejects invalid ids before any TestRail request

Tags: `safety`, `validation`, `writes`

### Building a run payload

### ✅ pairs a case list with include_all false

Tags: `writes`

- **Given** a run scoped to three specific cases
- **When** the payload is built
  **Payload**

  ```json
  {
    "name": "Smoke",
    "include_all": false,
    "case_ids": [1, 2, 3]
  }
  ```

- **Then** include_all is forced false
  > TestRail ignores case_ids unless include_all is false — the run would silently include everything.

### ✅ keeps an explicitly empty case list

Tags: `writes`

- **Given** a run created with case_ids: []
- **Then** it stays an empty run rather than becoming one with every case

### ✅ carries refs and config ids

Tags: `writes`

- **Given** a run linked to a requirement and a configuration
- **When** the payload is built
- **Then** both reach TestRail

### Guarding the write paths

### ✅ refuses to create a case without a title

Tags: `validation`, `writes`

- **Given** a create with no title
- **When** it is attempted
- **Then** it fails before reaching TestRail

### ✅ refuses an update that would change nothing

Tags: `validation`, `writes`

- **Given** an update with no fields set
- **When** it is attempted
- **Then** it fails rather than sending an empty payload
  > An empty update is always a caller mistake; sending it wastes a round trip and hides the bug.

### ✅ explains why "untested" cannot be posted as a result

Tags: `validation`, `writes`

- **Given** an attempt to mark two cases untested
- **When** the results are posted
- **Then** it is rejected with the reason, naming the offending cases
  > TestRail would answer an opaque 400. Untested is the absence of a result, not a result — you remove the result instead.
- **And** no request was made

### ✅ maps status names to TestRail ids when posting

Tags: `writes`

- **Given** a batch of results using human status names
- **When** they are posted
  **Sent to TestRail**

  ```json
  {
    "results": [
      {
        "case_id": 10,
        "status_id": 5,
        "comment": "broke",
        "defects": "CUR-1"
      }
    ]
  }
  ```

- **Then** 'failed' becomes status_id 5
- **And** the outcome comes back with the status name resolved again

### ✅ reports closing a run as the irreversible act it is

Tags: `safety`, `writes`

- **Given** a run being closed
- **When** the close succeeds
- **Then** the outcome names the run and links to it

### Carrying out writes

### ✅ creates a case in a section and reports what it set

Tags: `writes`

### ✅ updates only the case fields supplied

Tags: `safety`, `writes`

### ✅ creates a run from every run field

Tags: `runs`, `writes`

### ✅ refuses to create a run without a name

Tags: `runs`, `validation`, `writes`

### ✅ updates a run, and refuses an update that changes nothing

Tags: `runs`, `writes`

### ✅ posts every optional result field that was supplied, and none that were not

Tags: `results`, `writes`

### Writes while writes are disabled

### ✅ refuses every write in the client, before any request leaves

Tags: `safety`, `writes`

- **Given** a client with writes left at their default: off
- **When** each write is attempted
- **Then** each is refused as a write, naming the endpoint
- **And** nothing reached TestRail
