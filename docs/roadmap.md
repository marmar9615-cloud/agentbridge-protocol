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

## Phase 3 — Production readiness

- [ ] **Signed manifests.** Publishers sign their manifest with a key
      committed to a `.well-known/agentbridge-keys.json`. Agents verify the
      signature offline before trusting any action.
- [ ] **HTTP MCP transport.** stdio is great for desktop clients;
      production agents need an authenticated HTTP transport.
- [ ] **Per-action OAuth scopes.** Wire `permissions[]` into a real
      enforcement check — the MCP server validates the agent's bearer
      token against the action's required scopes before invoking.
- [ ] **Policy engine integration.** OPA / Cedar hook so customers can
      declare per-tenant policies (cost caps, rate limits, business hours,
      N-of-M approver workflows).
- [ ] **Distributed audit storage.** Replace the JSON file with a
      pluggable adapter (Postgres, S3, Datadog).

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
