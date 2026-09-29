---
'testrail-ai': patch
---

- Coverage refuses a `run_id` from another project, or from another suite when `suite_id` is set.
- Stability reports `belowThreshold`, the number of cases that alternated fewer than `min_flips` times. When nothing is listed but some cases alternated, the report says so instead of claiming nothing changed.
- The README quick-start calls `getStability(args, { client })`.
