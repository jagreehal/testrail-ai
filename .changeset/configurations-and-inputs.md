---
'testrail-ai': patch
'testrail-ai-mcp': patch
---

- Clients copy their config when created, so later changes to the object passed in have no effect.
- Stability keeps a separate history for each run configuration, and a failure's last good run must have the same configuration. Each stability row now includes `config`.
- Case history warns when a run has more tests than it reads and the case may be among the ones skipped.
- Run search and the project resource include runs inside test plans.
- Creating a run with `case_ids: []` creates an empty run.
- Input types accept the fields that have defaults as optional, so `getCaseDetail({ case_id })` type-checks.
