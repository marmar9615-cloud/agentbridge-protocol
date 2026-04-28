# AgentBridge v1.0.0 readiness

This document defines what "production-ready v1.0.0" means for the
AgentBridge project. It is a living checklist, not a marketing claim.
We use it to decide whether a given release line can call itself
`v1.0.0`.

> **Status.** Current published release is `v0.3.0` (Production
> Foundations). **`v0.4.0` (HTTP MCP transport + auth) is
> release-prepared** on `release/v0.4.0-http-polish` — design,
> ADR, transport abstraction, HTTP transport implementation,
> docs, examples, smoke, and lockstep version bump are all in
> place. Publishing happens through the Trusted Publishing
> workflow only after maintainer approval. See
> [releases/v0.4.0.md](releases/v0.4.0.md),
> [designs/http-mcp-transport-auth.md](designs/http-mcp-transport-auth.md),
> and [adr/0001-http-mcp-transport.md](adr/0001-http-mcp-transport.md).
> Neither v0.3.0 nor v0.4.0 alone delivers v1.0; both are steps
> toward it.

## 1. Current status

| Surface | State (v0.3.0 published / v0.4.0 release-prepared) |
|---|---|
| Manifest spec | v0.1, stable for the v0.x line. Not yet declared frozen for v1. |
| Public package APIs | Stable shape; not yet annotated with `@stable` / `@experimental` boundaries. |
| MCP transport | stdio default on npm. **HTTP transport implemented opt-in in v0.4.0** (release-prepared, not yet on npm); see [designs/http-mcp-transport-auth.md](designs/http-mcp-transport-auth.md) and [releases/v0.4.0.md](releases/v0.4.0.md). |
| Authorization | None over stdio (caller identity implicit). **HTTP transport ships static bearer-token auth in v0.4.0** with constant-time compare, query-string-token rejection, exact-origin allowlist, loopback-by-default bind. OAuth 2.1 resource-server mode designed-for, not yet implemented. |
| Persistence | Local JSON files for audit, confirmations, idempotency. No pluggable storage adapter. |
| Outbound URL gate | Loopback by default; opt-in `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS` (strict) and `AGENTBRIDGE_ALLOW_REMOTE` (broad) escape hatches. |
| Confirmation tokens | Single-use, input-bound, default 5-minute TTL (configurable 30s–1h). |
| Origin pinning | Enforced before every outbound call. |
| Audit redaction | Recursive, key-name-based. |
| npm publishing | Manual, with temporary granular tokens. No Trusted Publishing yet. No build provenance. |

## 2. v1.0.0 non-goals

These are deliberately excluded from the v1.0 scope to keep the bar
realistic:

- A managed cloud service. AgentBridge stays a self-hosted set of
  packages.
- A built-in policy DSL. We expose hooks; integrators bring their own
  policy engine (OPA, Cedar, etc.) — see Phase 6 in [roadmap.md](roadmap.md).
- Multi-region / multi-master coordination of confirmation tokens.
- Native browser-extension distribution.
- A managed manifest registry.

## 3. v1.0.0 release criteria

To call any release `v1.0.0`, every one of these must be true:

| # | Criterion | State |
|--:|---|---|
| 1 | npm Trusted Publishing enabled for all six packages | not yet — see [trusted-publishing.md](trusted-publishing.md) |
| 2 | npm provenance visible on every published version | not yet |
| 3 | No long-lived publish tokens required for normal releases | not yet (we still publish manually) |
| 4 | Package `repository` / `homepage` / `bugs` metadata verified per package | partial |
| 5 | Manifest schema version frozen for v1.x | not yet |
| 6 | Backwards-compatibility policy documented (this file's §13) | yes (this doc) |
| 7 | Signed-manifest design complete (implementation may follow) | not yet |
| 8 | HTTP MCP transport implemented OR explicitly deferred to v1.x with a date | **implemented opt-in in v0.4.0** (`apps/mcp-server/src/transports/http.ts`); release-prepared on `release/v0.4.0-http-polish`; not yet on npm |
| 9 | OAuth / authorization design complete (implementation may follow) | **static bearer auth implemented in v0.4.0** ([releases/v0.4.0.md](releases/v0.4.0.md)); OAuth 2.1 resource-server mode designed-for-future, not yet implemented |
| 10 | Production storage adapter shipped or interface declared | not yet |
| 11 | Configurable, exact-origin remote allowlist | **yes** (v0.3.0) |
| 12 | Security threat model published | **yes** (v0.3.0; see [threat-model.md](threat-model.md)) |
| 13 | Incident response / security reporting process documented | partial — see [SECURITY.md](../SECURITY.md) |
| 14 | CLI and SDK APIs documented at `@stable` / `@experimental` granularity | not yet |
| 15 | Examples validated in CI | partial (manifests yes; client configs no) |
| 16 | External install smoke test in CI | yes |
| 17 | Release workflow documented and end-to-end tested | partial (docs yes; Trusted Publishing dispatch not yet exercised) |

## 4. Stable manifest spec criteria

Before declaring `agentbridge-manifest.v1.0.md`:

- [ ] Every required field has a stable name and JSON Schema shape.
- [ ] Optional fields are marked optional in the schema and the human
      spec; removal of an optional field after v1 is a breaking
      change.
- [ ] `risk` taxonomy is stable. Either keep `low | medium | high`
      or commit to the richer taxonomy in [roadmap.md](roadmap.md)
      Phase 4.
- [ ] `humanReadableSummaryTemplate` placeholder syntax (`{{key}}`) is
      formally specified, including escaping rules.
- [ ] `permissions[]` semantics are documented: are they advisory or
      authoritative? (Currently advisory.)
- [ ] `auth` block discriminator is closed under the documented set
      (`none`, `bearer`, `oauth2`, etc.).
- [ ] Forward-compatibility rule: agents tolerate unknown top-level
      fields and unknown action fields without erroring.
- [ ] Test fixtures cover every example in `spec/examples/`.

## 5. Stable package API criteria

Before declaring any `@marmarlabs/agentbridge-*` package v1.0:

- [ ] Every exported symbol is annotated `@stable` or `@experimental`
      via TSDoc, and `@experimental` symbols never count as part of
      the public API.
- [ ] Removal of a `@stable` symbol is a major bump.
- [ ] Type signatures of `@stable` exports follow SemVer.
- [ ] Each package has a documented "what's public, what's internal"
      section in its README.
- [ ] `core` exports a `MANIFEST_SPEC_VERSION` constant.

## 6. MCP server production criteria

Before the MCP server line can claim production-readiness:

- [x] Risky actions cannot execute without `confirmationApproved` AND
      a valid token. (v0.2.0)
- [x] Action endpoints are origin-pinned to manifest `baseUrl`.
      (v0.2.0)
- [x] Outbound URL allowlist is exact-origin opt-in (not just
      "anything if `AGENTBRIDGE_ALLOW_REMOTE=true`"). (**v0.3.0**)
- [x] Stdout carries only valid JSON-RPC; warnings go to stderr.
      Verified by [`stdio-hygiene.test.ts`](../apps/mcp-server/src/tests/stdio-hygiene.test.ts).
      (**v0.3.0**)
- [x] Action timeout, max response bytes, and confirmation TTL are
      configurable within bounded ranges. (**v0.3.0**)
- [x] Authenticated HTTP MCP transport (in addition to stdio).
      **Implemented opt-in in v0.4.0**
      ([apps/mcp-server/src/transports/http.ts](../apps/mcp-server/src/transports/http.ts);
      release-prepared on `release/v0.4.0-http-polish`).
- [ ] Caller identity propagation (so audit events record *which agent
      / which user* invoked the action, not just `source: "mcp"`).
      Designed for v0.4.0 ([§11](designs/http-mcp-transport-auth.md#11-audit-model));
      audit-event extension reserved for v0.4.x or v0.5.0.
- [ ] Per-action permission/scope enforcement (today `permissions[]`
      is advisory).
- [ ] Rate limiting + cost accounting hooks.
- [ ] Per-tenant data isolation (today there is one shared local
      audit/confirmation/idempotency store).

## 7. Security criteria

- [x] Every change to safety-relevant code requires a test. (Convention.)
- [x] Confirmation gate / origin pinning / loopback default / audit
      redaction are documented as non-negotiable invariants in
      [CLAUDE.md](../CLAUDE.md), [AGENTS.md](../AGENTS.md), and
      [SECURITY.md](../SECURITY.md).
- [x] Threat model published (see [threat-model.md](threat-model.md)).
      (**v0.3.0**)
- [x] Production-readiness guidance published (see
      [production-readiness.md](production-readiness.md)).
      (**v0.3.0**)
- [x] Security configuration documented (see
      [security-configuration.md](security-configuration.md)).
      (**v0.3.0**)
- [ ] Coordinated disclosure timeline documented.
- [ ] Public security advisories use a stable URL pattern.
- [ ] Dependency review / supply-chain scan in CI.
- [ ] Signed manifests (publisher-key verification) shipped or
      definitively deferred with a v1.x date.

## 8. Release / supply-chain criteria

- [ ] All published packages built by GitHub Actions on
      `release-publish.yml`, not from a developer's laptop.
- [ ] Packages publish via npm Trusted Publishing (OIDC). No
      `NPM_TOKEN` secret required.
- [ ] Each published version carries npm provenance.
- [ ] `package.json` `repository.url` matches the actual GitHub repo
      for every package. (Verified by `npm pack --dry-run` warnings —
      currently npm corrects `https://...` to `git+https://...`; we
      should commit the corrected form.)
- [ ] CHANGELOG.md updated for every user-visible change.
- [ ] `release-check.yml` green on Node 20.x and 22.x within 24h of
      tagging.

## 9. Storage criteria

The MVP persists three things to local JSON files:

- audit log (`data/audit.json`)
- pending confirmations (`data/confirmations.json`)
- idempotency keys (`data/idempotency.json`)

For v1.0:

- [ ] A `StorageAdapter` interface in `core` covering append-audit,
      read-audit, get/put/delete confirmation, get/put/delete
      idempotency.
- [ ] A reference Postgres adapter in a separate package.
- [ ] A reference S3 / object-store adapter in a separate package.
- [ ] The local-JSON adapter remains the default for development.
- [ ] Atomic writes / transaction semantics documented per adapter.
- [ ] Migration path documented for upgrading from local JSON.

## 10. Policy criteria

- [ ] `permissions[]` becomes authoritative — the MCP server checks
      the caller's scopes against the action's `permissions[]` before
      invoking. (Requires §6 caller identity.)
- [ ] Pluggable policy hook accepting `(callerIdentity, action, input)
      → allow | deny | requireApprover`.
- [ ] Sample integrations: OPA and Cedar.
- [ ] Cost cap and rate-limit primitives that policy can reference.

## 11. Documentation criteria

- [ ] Every public CLI command has a doc page.
- [ ] Every public package has a TypeDoc-generated reference.
- [ ] Every example under `examples/` has a README and is referenced
      from the relevant doc.
- [ ] [`docs/quickstart.md`](quickstart.md) covers a working
      end-to-end install of AgentBridge v1.0 in under 10 minutes.
- [ ] Migration guide for v0.x → v1.0 lives at
      `docs/migrations/v0-to-v1.md`.

## 12. Test / CI criteria

- [x] Vitest suites for all packages, all green on Node 20.x and 22.x
      in CI.
- [x] External-adopter smoke test in CI (verified by
      `release-check.yml`).
- [x] Stdout-hygiene test for the MCP server. (**v0.3.0**)
- [x] Allowlist tests covering loopback, broad-remote, exact-origin
      allowlist, prefix attacks, and non-http schemes. (**v0.3.0**)
- [ ] Spec example tests cover *every* example manifest under
      `spec/examples/` and `examples/*-config/`.
- [ ] A "publish dry-run" CI job that proves the trusted-publishing
      workflow would succeed end-to-end without actually publishing.
- [ ] CodeQL or equivalent SAST in CI.
- [ ] Dependency vulnerability scan with a meaningful failure gate.

## 13. Compatibility guarantees

These take effect at v1.0:

- The manifest schema version (in `core`) increments only on breaking
  changes to required fields or to the validation rules of existing
  fields. Adding a new optional field is non-breaking.
- Every published `@stable` symbol in any `@marmarlabs/agentbridge-*`
  package follows SemVer. Renaming or deleting a `@stable` export is
  a major bump.
- The MCP server's tool list, tool input schemas, and confirmation
  protocol (token shape, two-call gate, idempotency key semantics)
  are part of the v1.0 contract. Adding a new tool is non-breaking;
  removing an existing tool is a major bump.
- Environment variables (`AGENTBRIDGE_*`) are part of the v1.0
  contract. Removing or renaming one is a major bump; adding a new
  one is non-breaking.
- Local JSON storage file shapes are *not* part of the contract; the
  storage adapter interface (§9) is the contract.

## 14. Versioning policy

- AgentBridge follows [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html).
- Pre-1.0 (`0.x.y`): minor bumps may break compatibility; patches
  should not.
- Post-1.0 (`1.x.y`): only major bumps may break compatibility.
- The six publishable packages bump in lockstep so consumers can
  always reason about "the AgentBridge v1.2 set."
- Per-package patch releases out of lockstep are allowed for
  documentation-only fixes (as v0.2.1 did).

## 15. Migration policy

- Every breaking change ships with a migration guide under
  `docs/migrations/`.
- Removed APIs are deprecated for at least one minor release before
  removal. Deprecation is logged with an explicit `console.warn` (not
  silent).
- The CLI's `agentbridge` binary maintains its command surface across
  minors. Adding a new subcommand is non-breaking; removing one is a
  major bump.
- The MCP server's confirmation protocol is upgraded with explicit
  protocol-version negotiation; old clients continue to work for at
  least one major.

## See also

- [production-readiness.md](production-readiness.md) — what
  AgentBridge is and isn't safe for *today*.
- [threat-model.md](threat-model.md) — full threat catalogue and
  current vs. v1 mitigations.
- [security-configuration.md](security-configuration.md) — every
  knob an operator can turn.
- [trusted-publishing.md](trusted-publishing.md) — the supply-chain
  plan.
- [roadmap.md](roadmap.md) — the version-by-version sequencing that
  gets us to v1.0.
