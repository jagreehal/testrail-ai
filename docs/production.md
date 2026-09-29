# Production operations

## Release gate

Run the same gate used by CI before publishing:

```bash
pnpm install --frozen-lockfile
pnpm quality
pnpm test:smoke
```

`pnpm quality` builds, then runs oxlint with type-aware rules (tsgolint) and the
vendored anti-slop rules (`tools/oxlint/anti-slop`), `tsc`, every package's
story tests under per-package coverage thresholds, Prettier, and a check that
the built packages import and their binaries start. `tests/consumer` compiles
against the built packages with strict `nodenext` resolution, along with every
`ts` block in the READMEs, and snapshots each entry point's exports, so an API
change shows up in review and a stale example fails the build. Each test run
regenerates `docs/stories.md`; CI fails if that differs from what is committed.

On a pull request, CI also:

- fails on any high-severity advisory in production dependencies (`pnpm audit`)
- posts one executable-stories comment per package, with the HTML report as an
  artifact, through `jagreehal/executable-stories-action`
- uploads coverage reports
- requires a changeset (`changeset.yml`), except on Dependabot and release PRs

Merging to `main` runs the same CI, then the release job. With changesets
pending it opens a "Version Packages" PR; merging that publishes to npm through
trusted publishing with provenance.

Development dependencies are pinned exactly (runtime dependencies keep a caret
range so consumers can dedupe them), the lockfile is frozen in CI, and `minimumReleaseAge` in
`pnpm-workspace.yaml` refuses any release younger than three days. Dependabot
waits the same three days.

`test:smoke` is read-only by construction: it forces writes off and confirms
that task tools, resources, prompts and the raw escape hatch cannot mutate the
configured TestRail instance.

`test:smoke:write` exercises the write tools against one project set aside for
it. It needs the project's id and its exact name, and refuses before writing
anything unless both match:

```bash
TESTRAIL_SMOKE_WRITE_PROJECT=11 TESTRAIL_SMOKE_WRITE_PROJECT_NAME=Jag pnpm --filter testrail-ai-mcp test:smoke:write
```

It creates a section, a case, a run and a result, closes the run, and deletes
the section. Never point it at a project other people use.

## Enterprise networks

The packages use Node's native `fetch`. On Node 24, enable its environment proxy
adapter and use the conventional proxy variables:

```bash
NODE_USE_ENV_PROXY=1
HTTPS_PROXY=http://proxy.example:8080
NO_PROXY=localhost,127.0.0.1,.internal.example
```

For a private certificate authority, set `NODE_EXTRA_CA_CERTS` to a PEM bundle.
There is deliberately no insecure TLS switch. Library consumers needing a
special transport can inject `fetch` through `TestRailClient`'s runtime seam.

## Health and shutdown

The loopback HTTP MCP entry exposes `/health`. This is a liveness check and does
not spend TestRail rate limit on every probe. Node entry points stop accepting
traffic and drain connections on `SIGTERM` or `SIGINT`, with a ten-second upper
bound for shutdown.

## Observability

Set `OTEL_EXPORTER_OTLP_ENDPOINT` for MCP tracing and optionally
`OTEL_SERVICE_NAME`. Keep body capture disabled: case fields, user directories,
failure comments and attachments may contain personal or confidential data.

## Credential model

- Local stdio and loopback HTTP hold one user's TestRail credential.
- A remote deployment built with `mcp-authz` validates a bearer token and an
  explicit access policy before resolving a shared or per-person credential. It
  reaches these tools through `buildServer`'s `wrap` option and the exported
  `GATE_PERMISSIONS` map, so the permission check happens at registration rather
  than inside each handler. List caches are private so a per-principal catalogue
  cannot be shared across callers.
- Per-person credentials preserve TestRail permissions and audit attribution.
- Metadata caches are owned by each client, so identities never share cached
  user directories.
