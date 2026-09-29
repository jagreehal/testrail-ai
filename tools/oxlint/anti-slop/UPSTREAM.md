# Upstream

- **Source:** https://github.com/dmmulroy/anti-slop
- **Commit:** `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b` (2026-09-10, "Merge pull request #36 from K-Mistele/contrib/effect-tag-match-rules")
- **Copied from:** `skills/install-anti-slop/assets/anti-slop/` at that commit, which matches the commit's `src/` apart from rule tests.
- **Installed at:** `tools/oxlint/anti-slop/` (generic plugin `index.ts`; the Effect plugin in `effect/` is copied but not registered, since this repository does not depend on Effect).
- **Nested provenance:** `vendor/eslint-stylistic/UPSTREAM.md` and its `LICENSE` travel with `require-readable-spacing`.

## Local configuration

Configured in `.oxlintrc.json`. Every generic rule is at `error`, plus `oxc/no-accumulating-spread`.

One deliberate option: `anti-slop/no-runtime-typeof` runs with `allowInTypeGuards: true`, so a `typeof` check is allowed inside a type-predicate function and nowhere else. The fake TestRail in `packages/testrail-ai/src/test-support.ts` uses it to tell a computed route from a fixed reply.

No rule source has been changed.
