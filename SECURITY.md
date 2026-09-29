# Security policy

## Supported versions

Security fixes are released for the latest published version only. Upgrade to
the newest release before reporting a problem that may already be fixed.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's **Report a vulnerability** flow
on the repository's Security tab so credentials, reproduction details and a
proposed fix remain private. Include the affected package and version, impact,
and the smallest safe reproduction you can provide.

We will acknowledge a report, investigate it, coordinate remediation with the
reporter and publish an advisory when users have a fix available.

## Deployment guidance

- Use a least-privilege TestRail API key and rotate it according to your
  organisation's policy. Never commit `.env`, MCP client configuration or
  `TESTRAIL_CREDENTIAL_MAP` values.
- Leave `TESTRAIL_ALLOW_WRITES` unset or `false` unless the deployment genuinely
  needs mutations. TestRail run closure is irreversible.
- Use the stdio package for one local user. For a shared remote deployment, use
  [`mcp-authz`](https://www.npmjs.com/package/mcp-authz) with `buildServer` from
  `testrail-ai-mcp`, passing `gate(server, principal, GATE_PERMISSIONS)`
  through its `wrap` option so an unpermitted tool is absent from that request's
  `tools/list` and refused if called. A capability missing from the map stops the
  boot rather than defaulting open or closed. Prefer per-person TestRail
  credentials. The deployment is yours to
  run; this repo ships no hosted endpoint. `TESTRAIL_ALLOW_WRITES` remains the
  blast-radius switch for the credential; the gate decides who may see mutating
  tools when writes are on.
- Keep TLS verification enabled. For private certificate authorities, configure
  Node with `NODE_EXTRA_CA_CERTS`; do not disable certificate verification.
- Treat traces and logs as sensitive. Do not record authorization headers,
  bearer tokens, API keys, request bodies or TestRail response bodies.

See [Production operations](docs/production.md) for network and release checks.
