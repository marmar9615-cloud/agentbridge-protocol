# npm Trusted Publishing for AgentBridge

A plan for moving AgentBridge releases off long-lived npm tokens
and onto npm Trusted Publishing (OIDC from GitHub Actions), with
build provenance attached to every published tarball. This is a
v1.0 release-criterion (see [v1-readiness.md §3](v1-readiness.md))
and a v0.3.0 *foundations* item.

> **Status (v0.3.0).** Not yet enabled. v0.2.0, v0.2.1, and v0.2.2
> were published manually with temporary granular tokens. This
> document describes the path forward and ships the **draft
> workflow** [`release-publish.yml`](../.github/workflows/release-publish.yml)
> that will execute it once each npm package is configured.

## Why Trusted Publishing

- **No long-lived publish tokens.** A publish token that exists for
  weeks is a credential to lose. Trusted Publishing exchanges a
  short-lived OIDC token from GitHub Actions for an even
  shorter-lived npm publish credential, scoped to one publish.
- **Provenance.** Each published version carries an attestation
  recorded at the [npmjs.com sigstore](https://docs.npmjs.com/generating-provenance-statements).
  Consumers (and our CI) can verify a tarball was built from
  `marmar9615-cloud/agentbridge-protocol` by the documented
  workflow on the documented commit, not from a developer's
  laptop.
- **Reproducible release process.** Every release runs the same
  steps (`npm ci`, `typecheck`, `test`, `build`, `pack-check`,
  `publish`) on a clean GitHub-hosted runner. No "I forgot to
  rebuild" surprises.

## What needs to happen

This is a one-time setup per package, plus the draft workflow we
ship in this PR.

### Per-package npm UI configuration

For each of these six packages, an npm maintainer must add a
trusted publisher entry in the npm web UI:

- `@marmarlabs/agentbridge-core`
- `@marmarlabs/agentbridge-sdk`
- `@marmarlabs/agentbridge-scanner`
- `@marmarlabs/agentbridge-openapi`
- `@marmarlabs/agentbridge-cli`
- `@marmarlabs/agentbridge-mcp-server`

Steps in the npm UI for each package:

1. Sign in to npmjs.com as an account with publish rights.
2. Navigate to the package settings: `https://www.npmjs.com/package/<NAME>/access`
   → "Trusted publishers".
3. Add a new trusted publisher with:
   - **Publisher type:** GitHub Actions
   - **Repository owner:** `marmar9615-cloud`
   - **Repository name:** `agentbridge-protocol`
   - **Workflow filename:** `release-publish.yml`
   - **Environment name:** *(leave blank for now; we can add a
     protected environment later if we want manual approval gates)*
4. Save and verify the entry appears under "Trusted publishers."

Until this is done for all six packages, the workflow's publish
step will fail with an authentication error. The dry-run mode of
the workflow works without any of this setup.

### What we ship in this PR

- This document.
- `.github/workflows/release-publish.yml` — manual-dispatch only,
  dry-run by default. See below for what it does and how to use
  it.
- Updates to [`docs/release-checklist.md`](release-checklist.md)
  and [`docs/npm-publishing.md`](npm-publishing.md) pointing
  toward Trusted Publishing as the v1.0 path.

### What we do NOT ship in this PR

- Actual Trusted Publisher records on npm (those are a manual UI
  step you have to perform).
- Any execution of the workflow against the live registry.
- Any `NPM_TOKEN` secret in the repository.
- A published v0.3.0 (the workflow is dry-run-only by default; the
  v0.3.0 publish, if/when it happens, will still be a deliberate
  user-initiated act).

## How to use the draft workflow (after npm setup)

The workflow is at
[`.github/workflows/release-publish.yml`](../.github/workflows/release-publish.yml)
and is `workflow_dispatch`-only (it never runs on push or PR).

### Inputs

- **`version`** — the tag/version being published (e.g. `0.3.0`).
  This is currently informational; the workflow asserts that every
  publishable `package.json` is on this exact version. If they
  don't match, it fails fast.
- **`dry_run`** — `true` (default) or `false`. Dry-run mode runs
  every step short of `npm publish` and prints what *would* be
  published.

### Steps

1. Checkout with full history.
2. Setup Node 22.x with the npm registry configured for OIDC.
3. `npm ci`, `npm run typecheck:clean`, `npm test`, `npm run build`,
   `npm run pack:dry-run`.
4. Assert every publishable `package.json` is on the requested
   version.
5. If `dry_run=true`, print the publish plan and stop.
6. If `dry_run=false`, publish in dependency order:
   - `core`
   - `sdk`, `scanner`, `openapi`
   - `cli`, `mcp-server`
   Each `npm publish --access public --provenance` runs without an
   `NPM_TOKEN` secret. The OIDC exchange happens transparently.
7. Print the resulting `npm view @marmarlabs/<pkg>@<version>` for
   each package as a final sanity check.

### First run

1. Make sure each of the six packages has a Trusted Publisher
   entry in the npm UI pointing at this workflow file.
2. Bump versions in every publishable `package.json` to the new
   version (e.g. via the existing release prep flow). Push to
   `main`.
3. Wait for `ci.yml` to be green on `main`.
4. Manually trigger `release-check.yml` and wait for green.
5. Manually trigger `release-publish.yml` with
   `version=<X.Y.Z>` and `dry_run=true`. Verify the printed plan.
6. Re-trigger `release-publish.yml` with the same `version` and
   `dry_run=false`. The workflow publishes all six packages.
7. Verify provenance shows up at
   `https://www.npmjs.com/package/@marmarlabs/agentbridge-core/v/<X.Y.Z>`
   under "Provenance" — there should be a green check linking back
   to the workflow run that built it.

### What can go wrong

- **`npm error 403 — trusted publisher not configured`.** A
  package is missing its npm UI entry. Add it and re-run.
- **Version mismatch.** A `package.json` in the workspace is on a
  different version than the workflow input. Bump it and push.
- **Test failure.** Same as any CI red — fix the cause, push, re-
  trigger.
- **Tarball-content mismatch.** `pack:dry-run` asserts each
  tarball includes `dist/`, `README.md`, `LICENSE` and excludes
  `src/`, tests, tsconfigs. If a package strays from that shape
  the publish stops.

## Migrating from manual publish

The legacy manual-publish flow stays documented in
[`docs/npm-publishing.md`](npm-publishing.md) as a fallback for
releases that for some reason can't go through the workflow.
Ground rules:

- After v1.0 ships via Trusted Publishing, every subsequent
  release should use the workflow.
- A manual publish is acceptable only when the workflow is broken
  and the release cannot wait. In that case, document why in the
  release notes.
- Any manual publish must:
  - Use a granular token created right before the publish,
    revoked right after.
  - Use `--userconfig /tmp/<file>` (mode `0600`) and shred the
    file after.
  - Match the same dependency-order publish plan the workflow uses.

## Revoking the v0.2.x tokens

The granular tokens used for v0.2.0 / v0.2.1 / v0.2.2 should
already be revoked (per the post-publish reminder in the previous
release loops). To verify:

1. Sign in to npmjs.com.
2. Visit `https://www.npmjs.com/settings/<your-account>/tokens`.
3. Confirm any token labeled for an AgentBridge release is no
   longer listed (or is "Revoked").

## See also

- npm docs:
  [Generating provenance statements](https://docs.npmjs.com/generating-provenance-statements).
- npm docs:
  [Trusted publishers](https://docs.npmjs.com/trusted-publishers).
- [v1-readiness.md §3 / §8](v1-readiness.md) — the
  release-criterion this work satisfies.
- [threat-model.md T11 / T12](threat-model.md) — the supply-chain
  threats this mitigates.
