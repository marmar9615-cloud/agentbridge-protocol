# Roadmap

A living document. Anything in here is a direction, not a commitment.

## Phase 3A — npm release hardening (shipped 0.2.0 / 0.2.1)

- [x] Publishable npm packages on `@marmarlabs/agentbridge-*` scope
- [x] tsup build pipeline producing `dist/` outputs for all publishable packages
- [x] CI typechecks all 6 packages, builds, runs `pack:dry-run`
- [x] External-adopter smoke script (`npm run smoke:external`)
- [x] Release-check workflow, issue/PR templates, dependabot
- [x] Per-package READMEs and release docs
- [x] First public stable release on npm at v0.2.0; docs-cleanup patch at v0.2.1

## Phase 2 — Developer tooling (shipped 0.2.0)

- [x] CLI (`scan`, `validate`, `init`, `generate openapi`, `mcp-config`)
- [x] OpenAPI → manifest adapter
- [x] Formal manifest spec + JSON Schema artifact
- [x] Three example manifests in `spec/examples/`
- [x] MCP confirmation tokens + idempotency keys
- [x] MCP resources + prompts
- [x] Studio search/filter, JSON editor, summary preview, spec page
- [x] Release docs: CHANGELOG, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, CLAUDE.md

## Path to v1.0

Each line below is a release; the bar for declaring `v1.0.0` is the
checklist in [v1-readiness.md](v1-readiness.md). v0.3.0 is in flight
on the `feature/v030-production-foundations` branch and is **not**
the v1.0 release — it's the foundation.

### v0.3.0 — Production Foundations (shipped)

- [x] Stricter remote-target allowlist (`AGENTBRIDGE_ALLOWED_TARGET_ORIGINS`,
      exact-origin match, prefix-attack tests).
- [x] Configurable bounds (`AGENTBRIDGE_ACTION_TIMEOUT_MS`,
      `AGENTBRIDGE_MAX_RESPONSE_BYTES`,
      `AGENTBRIDGE_CONFIRMATION_TTL_SECONDS`) within safe ranges.
- [x] Stdout-hygiene test for the MCP server (subprocess test that
      asserts every stdout line is parseable JSON-RPC and that
      warnings stay on stderr).
- [x] [docs/v1-readiness.md](v1-readiness.md),
      [docs/production-readiness.md](production-readiness.md),
      [docs/threat-model.md](threat-model.md),
      [docs/security-configuration.md](security-configuration.md),
      [docs/trusted-publishing.md](trusted-publishing.md).
- [x] Draft `release-publish.yml` workflow (manual-dispatch,
      dry-run by default; activates once each npm package has a
      Trusted Publisher entry).

### v0.4.0 — HTTP MCP transport + auth (release-prepared)

- [x] Design doc + ADR
      ([designs/http-mcp-transport-auth.md](designs/http-mcp-transport-auth.md),
      [adr/0001-http-mcp-transport.md](adr/0001-http-mcp-transport.md)).
- [x] Authenticated HTTP MCP transport with the same confirmation
      gate, origin pinning, and audit redaction as the stdio path
      (PR #27 landed; reuses `createMcpServer()` factory).
- [x] Static bearer-token auth (Phase 1 per the design).
      Origin allowlist enforced. Loopback bind by default. Public
      bind fails closed without auth + Origin allowlist.
- [x] HTTP-transport-specific threat-model section updated
      ([T14 in threat-model.md](threat-model.md#t14-future-http-transport-risks)).
- [x] Lockstep `0.4.0` version bump, release notes
      ([releases/v0.4.0.md](releases/v0.4.0.md)),
      `examples/http-client-config/`, and HTTP smoke wired into
      `npm run smoke:external` (release polish — this PR).
- [ ] Caller-identity propagation into audit events (so events
      record *which agent / which user* invoked the action).
      Audit-event extension reserved for v0.4.x or v0.5.0.
- [ ] OAuth 2.1 resource-server mode. Designed-for, not yet
      implemented; reserved for a later v0.x release.
- [ ] Publish `@marmarlabs/agentbridge-*@0.4.0` via Trusted
      Publishing (only after maintainer approval).

### v0.5.0 — Signed manifests

- [ ] Publishers sign their manifest with a key committed to
      `/.well-known/agentbridge-keys.json`. Agents verify the
      signature offline before trusting any action.
- [ ] Scanner reports unsigned manifests as a downgrade. Backwards
      compatible: unsigned manifests still work in `v0.x` mode.
- [ ] CLI command to generate / rotate / verify keys.

### v0.6.0 — Policy engine + rate limits

- [ ] Pluggable policy hook accepting
      `(callerIdentity, action, input) → allow | deny | requireApprover`.
- [ ] Reference integrations for OPA and Cedar.
- [ ] First-class rate-limit and cost-cap primitives that policy
      can reference.
- [ ] `permissions[]` becomes authoritative — MCP server checks
      caller's scopes against the action's `permissions[]`.

### v0.7.0 — Persistent storage adapters

- [ ] `StorageAdapter` interface in `core` covering audit /
      confirmations / idempotency.
- [ ] Reference Postgres adapter (separate package).
- [ ] Reference S3 / object-store adapter (separate package).
- [ ] Local-JSON adapter remains the default for development;
      production deployments use a real adapter.
- [ ] Migration path from local JSON documented.

### v0.8.0 — SDK / API stabilization

- [ ] Every exported symbol in every `@marmarlabs/agentbridge-*`
      package annotated `@stable` or `@experimental`.
- [ ] TypeDoc-generated reference for every package.
- [ ] `MANIFEST_SPEC_VERSION` exported from `core`.
- [ ] Compatibility-policy section formalized in
      [v1-readiness.md §13](v1-readiness.md).

### v0.9.0 — Release-candidate hardening

- [ ] CodeQL or equivalent SAST in CI.
- [ ] Dependency vulnerability scan with a meaningful failure gate.
- [ ] Trusted Publishing exercised end-to-end (real publish via
      `release-publish.yml`, provenance verified).
- [ ] Final spec freeze for the v1 manifest.

### v1.0.0 — Stable production release

- [ ] All v1.0 release criteria in
      [docs/v1-readiness.md §3](v1-readiness.md) green.
- [ ] Stable manifest spec frozen at
      `agentbridge-manifest.v1.0.md`.
- [ ] Compatibility guarantees documented and in force.

## Phase 4 — Richer expressivity

- [ ] **Standardised risk taxonomy** beyond `low | medium | high` — `read`,
      `write-self`, `write-others`, `financial`, `irreversible`,
      `external-effect`. Lets agents reason about consequences more
      precisely.
- [ ] **Cross-app workflows.** Declare action chains spanning multiple
      AgentBridge surfaces with consistent confirmation semantics.
- [ ] **Streaming actions.** Long-running operations with progress
      events (file upload, batch processing).
- [ ] **Server-sent events for audit.** Live audit log feed for the
      Studio dashboard.
- [ ] **Manifest registry.** Optional public index of manifests so agents
      can discover surfaces by capability ("find me an app that can refund
      a Stripe charge").

## Phase 5 — Ecosystem

- [ ] **Browser extension** that auto-detects manifests and offers safe
      one-click actions.
- [ ] **VS Code extension** showing readiness score in the editor when
      you open an `agentbridge.config.ts`.
- [ ] **Auto-generation from Playwright probe.** When a site has no
      manifest, propose a starter from visible buttons and forms.
- [ ] **Reference manifests** for popular APIs (Stripe, Linear, Notion,
      Slack, GitHub) — give app teams a one-click on-ramp.
- [ ] **MCP capability registry** — well-known capability names so
      multiple AgentBridge surfaces can implement the same logical action
      (`stripe.refund_charge`, `linear.create_ticket`).

## Always

- Tighten the safety story.
- Better examples.
- Smaller scanner false-positive rate.
- Faster CLI startup.
- More tests.
