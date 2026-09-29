# testrail-ai-cli

TestRail from the terminal, running the same analysis the MCP server does. Use it
if you would rather not run a server, or from agent skills and CI jobs that only
need to shell out.

```bash
npm i -g testrail-ai-cli
export TESTRAIL_URL=https://your-instance.testrail.io
export TESTRAIL_EMAIL=you@example.com
export TESTRAIL_API_KEY=...
export TESTRAIL_PROJECT_ID=5   # optional: the project to use when one is left out
```

## Commands

```bash
testrail-ai projects                          # start here
testrail-ai search runs --project 5 --limit 10
testrail-ai search cases --project 5 --query login

testrail-ai report 612                        # totals, pass rate, failure clusters
testrail-ai report --project 5                # …or the latest run

testrail-ai failures 612 --last-good          # what broke, and when it last worked
testrail-ai stability 5 --runs 10             # flaky, regressed or recovered
testrail-ai coverage 5 --refs CUR-1234,CUR-1235
testrail-ai search cases --project 5 --section-path "Checkout > Payments"
testrail-ai case 103215

# With TESTRAIL_PROJECT_ID set, the project can be left out
testrail-ai stability
testrail-ai report
```

## `--json`

Every command takes `--json`, which emits the underlying data in place of the
markdown. Reach for it whenever something downstream reads the output.

```bash
testrail-ai --json report 612 | jq '.passRate'
testrail-ai --json stability 5 | jq '.regressed[].caseId'
testrail-ai --json coverage 5 | jq '.unreferenced | length'
```

Errors go to stderr and set a non-zero exit code, so stdout stays clean and your
CI job fails when the command does.

## Credentials

Flags beat environment. Pass `--url`, `--email` or `--api-key` to override
`TESTRAIL_URL`, `TESTRAIL_EMAIL` and `TESTRAIL_API_KEY` for a one-off.

MIT.
