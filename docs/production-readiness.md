# AgentBridge production readiness

This is a practical, non-marketing assessment of what AgentBridge is
ready for *today* (as of `v0.3.0`) and what it is not. If you are
deciding whether to put AgentBridge in front of real customer,
admin, or financial actions, read this first.

> **Bottom line.** AgentBridge is **not** production security
> infrastructure yet. The v1.0 criteria in
> [v1-readiness.md](v1-readiness.md) are the bar; v0.3.0 is one
> milestone toward them. Use AgentBridge in production only inside a
> controlled environment with the safeguards listed below.

## What AgentBridge is currently safe for

Today, AgentBridge is appropriate for:

- **Local development.** Author a manifest, run the demo, exercise
  the confirmation flow against `http://localhost:3000`.
- **Internal prototypes.** Wire your internal API into an
  AgentBridge manifest, run the MCP server on a developer's laptop,
  and let an agent drive the prototype against a non-production
  environment.
- **Staging environments under explicit allowlists.** Use
  `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS` to pin the MCP server to one
  or two staging hosts. Confirmation tokens, origin pinning, and
  audit redaction all enforce the contract.
- **CI tests of agent flows.** Validate that an agent calls the
  expected actions and respects the confirmation gate. The simulated
  destructive demo actions are a good test target.
- **Manifest authoring and scanning workflows.** The CLI and Studio
  tools are stable enough to use as part of a regular review.

## What AgentBridge is not yet safe for

Today, AgentBridge should **not** be used for:

- **Calling real financial systems** (payments, transfers, refunds
  against a live processor). The demo actions are simulated for a
  reason.
- **Acting on behalf of real end users without a separately enforced
  human-in-the-loop.** The confirmation gate runs *inside* the MCP
  server, but identity propagation and per-user authorization are
  not yet implemented. The confirmation-required summary is a
  *protocol* signal, not yet an enforced UX gate.
- **Multi-tenant deployments.** There is one shared local audit /
  confirmation / idempotency store. Cross-tenant isolation is not
  guaranteed.
- **Production distributed deployments.** The MCP server speaks
  stdio, persists to JSON files, and assumes a single-process
  identity. HTTP MCP transport, OAuth, and pluggable storage are on
  the v1.0 path but not shipped.
- **Open-internet-facing AgentBridge MCP servers.** Loopback is the
  default for a reason. The `AGENTBRIDGE_ALLOW_REMOTE=true` escape
  hatch broadens the trust boundary substantially and is intended for
  testing, not for production.

If your use case lives in the second list, do not work around it.
File a roadmap issue or wait for the v1.0 series.

## Operating modes

### Local development mode (default)

- Loopback URLs only.
- Confirmation tokens with a 5-minute TTL.
- Local JSON files under `data/` (or `AGENTBRIDGE_DATA_DIR`).
- stdio MCP transport launched by your client (Codex, Claude
  Desktop, Cursor, custom).

This is the well-tested mode. No additional configuration required.

### Controlled remote mode (production-recommended for v0.3.0)

- Set `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS=https://app.example.com,
  https://admin.example.com` in the MCP server's environment.
- Origins are matched on `URL.origin` (scheme + host + port). Prefix
  attacks (`https://example.com.evil.test`) are rejected.
- Loopback URLs remain allowed, so local agents can still talk to a
  dev instance.
- Tune timeouts and TTLs per
  [security-configuration.md](security-configuration.md):
  - `AGENTBRIDGE_ACTION_TIMEOUT_MS` (default 10000, range 1000–120000)
  - `AGENTBRIDGE_MAX_RESPONSE_BYTES` (default 1000000, range 1024–10485760)
  - `AGENTBRIDGE_CONFIRMATION_TTL_SECONDS` (default 300, range 30–3600)
- Set `AGENTBRIDGE_DATA_DIR` to a writable, persistent location
  outside the repo checkout.

### Broad-remote mode (testing only)

- `AGENTBRIDGE_ALLOW_REMOTE=true` permits **any** http(s) origin.
- The server emits a one-time stderr warning so the operator knows
  the trust boundary is wide open.
- Use only for ad-hoc testing or scripted scans against a known set
  of hosts. **Production-recommended is to use the explicit allowlist
  instead.**

### MCP stdio mode

- The server speaks JSON-RPC over stdio.
- Stdout carries protocol traffic only. Warnings, errors, and
  diagnostic logs go to stderr (verified by
  [`stdio-hygiene.test.ts`](../apps/mcp-server/src/tests/stdio-hygiene.test.ts)).
- The MCP client launches the server as a subprocess. **The
  command/args configuration in your MCP client is a trust
  boundary** — anyone who can edit it can launch a different
  binary. Treat it like a Git hook or a launchd plist.

### MCP HTTP mode (planned)

Not implemented in v0.3.0. The roadmap targets v0.4.0 for an
authenticated HTTP MCP transport with the same confirmation gate
and origin pinning as the stdio path. See
[roadmap.md](roadmap.md) and the "Future HTTP transport risks"
section of [threat-model.md](threat-model.md).

## Required boundaries today

If you deploy AgentBridge in any non-local mode, you are responsible
for the boundaries the project does not yet enforce:

| Boundary | Where to enforce it today |
|---|---|
| **Authentication** of the agent / user calling the MCP server | Outside the server (e.g., only run the server inside a single-user user account; restrict who can launch it) |
| **Authorization** per action (which user can call which action) | Inside your action endpoints — they already get the request and can apply your auth model |
| **Tenant isolation** | Outside the server (one MCP server process per tenant; separate `AGENTBRIDGE_DATA_DIR` per tenant) |
| **Network egress** | OS-level (firewall rules; container network policies) |
| **Audit log retention / shipping** | Outside the server (tail `data/audit.json` and ship to your SIEM; the local file is capped at 500 events) |

## Confirmation gate

The MCP server refuses to invoke any medium- or high-risk action
without:

1. An explicit `confirmationApproved: true` argument, AND
2. A valid `confirmationToken` returned by an earlier first call,
   AND
3. The same `(url, actionName, hash(input))` as that first call.

Tokens are single-use, expire (default 5 minutes), and are stored
in `data/confirmations.json` (or
`AGENTBRIDGE_DATA_DIR/confirmations.json`). Reusing a token with
different input is a hard failure. See
[`confirmations.ts`](../apps/mcp-server/src/confirmations.ts) and
the test suite in
[`call-action.test.ts`](../apps/mcp-server/src/tests/call-action.test.ts).

## Origin pinning

Every outbound action call is checked against the manifest's
`baseUrl`. A poisoned manifest cannot redirect calls to a third-party
host because [`assertSameOrigin`](../apps/mcp-server/src/safety.ts)
rejects mismatched origins before the fetch.

This is independent of the URL allowlist (which gates which manifest
URLs the server will fetch in the first place).

## Remote URL restrictions

See [security-configuration.md](security-configuration.md) for the
authoritative list of supported env vars. Summary:

- Default: loopback only.
- Strict, recommended for production: `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS`
  with a comma-separated list of full origins.
- Broad escape hatch: `AGENTBRIDGE_ALLOW_REMOTE=true` (with stderr
  warning).
- The strict allowlist always wins when both are set.

## Audit log limitations

- Local JSON, capped at the most-recent 500 events.
- Atomic writes (`tmp + rename`) to prevent partial-file corruption.
- Sensitive keys (`authorization`, `cookie`, `password`, `token`,
  `secret`, `api_key`, `apikey`) are recursively redacted before
  persistence.
- **Not** shipped to a SIEM, **not** distributed across processes,
  **not** queryable beyond `readAuditEvents({ url, limit })`.

If your environment requires longer retention, durable storage, or
cross-process consistency, you must mirror the audit log somewhere
durable yourself. The pluggable storage adapter is on the v1.0 path
(see [v1-readiness.md §9](v1-readiness.md)).

## Local JSON storage limitations

The `data/` directory holds:

- `audit.json` — last 500 audit events.
- `confirmations.json` — pending confirmations (cap 200, expire on
  read).
- `idempotency.json` — last 500 idempotency records (24h TTL).

This is a local development store. It is not safe for:

- Multiple MCP server processes writing concurrently.
- A multi-tenant deployment.
- Backup / point-in-time recovery beyond a flat-file copy.

For controlled production use, set `AGENTBRIDGE_DATA_DIR` to a
per-tenant, per-process directory, and run a single MCP server
process per directory.

## How to run in a controlled environment

A reasonable pattern for an internal staging deployment of v0.3.0:

1. **Create a dedicated OS user** (e.g. `agentbridge`). Run the MCP
   server as that user only.
2. **Pin target origins.** Set
   `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS=https://staging.app.internal`.
3. **Pin the data directory.** Set `AGENTBRIDGE_DATA_DIR=/var/lib/
   agentbridge/staging`. Make it owned by the dedicated user, mode
   `0700`.
4. **Tail and ship the audit log.** Run a sidecar that tails
   `audit.json` into your SIEM. Truncation past 500 events is
   normal — your SIEM is the source of truth, not the file.
5. **Apply network egress rules** that allow the MCP server process
   to talk only to the allowlisted origins.
6. **Pin the package version.** Lock `@marmarlabs/agentbridge-mcp-
   server` and `-cli` to an exact version (`0.3.0`) and let a
   release process bump them, not `npx -y` resolution at startup.
7. **Test the confirmation flow** end-to-end before allowing any
   risky action. The first call to a high-risk action must return
   `confirmationRequired`; the second must require both
   `confirmationApproved: true` and the same `confirmationToken`.

## Recommended production architecture (planned for v1.0)

This is the target shape, **not what v0.3.0 delivers**. Documented
here so contributors can build toward it.

```
┌──────────────────┐       authenticated HTTP/MCP        ┌──────────────────┐
│  Agent           │ ─────────────────────────────────▶ │  AgentBridge MCP │
│  (Codex / Claude │                                    │  server          │
│   / custom)      │ ◀───────────────────────────────── │  (HTTP transport)│
└──────────────────┘                                    └────────┬─────────┘
                                                                 │
                                                       OAuth scopes
                                                       per-tenant policy
                                                                 │
                                                   ┌─────────────┴─────────────┐
                                                   │                           │
                                          ┌────────▼────────┐         ┌────────▼─────────┐
                                          │  Action backend │         │ Pluggable storage│
                                          │  (your app)     │         │ (Postgres / S3)  │
                                          └─────────────────┘         └──────────────────┘
                                                                                │
                                                                                ▼
                                                                          ┌─────────┐
                                                                          │  SIEM   │
                                                                          └─────────┘
```

Pieces required to reach this shape:

- HTTP MCP transport with bearer-token auth (Phase 4 / v0.4.0).
- Caller-identity propagation into audit events.
- `permissions[]` becomes authoritative, scoped against caller's
  bearer token.
- Pluggable storage adapter shipped in core, with reference Postgres
  and S3 adapters.
- Signed manifests (Phase 5 / v0.5.0) so agents can verify the
  publisher offline.

## Pre-flight checklist before using AgentBridge with real
customer / admin / financial actions

Use this as the gate before pointing AgentBridge at anything real.
Every box must be checked.

- [ ] All actions that touch real systems are reviewed and have
      explicit `risk` and `requiresConfirmation` set.
- [ ] No action endpoint accepts unauthenticated requests at the
      app level. (AgentBridge does not authenticate the caller for
      you yet.)
- [ ] `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS` is set; the broad
      `AGENTBRIDGE_ALLOW_REMOTE=true` escape is **not** in use.
- [ ] `AGENTBRIDGE_DATA_DIR` is set to a per-tenant location with
      restrictive permissions.
- [ ] The audit log is being shipped to durable storage.
- [ ] The MCP server runs under a dedicated OS user / container.
- [ ] Network egress is restricted to the allowlisted origins at the
      OS layer.
- [ ] The package version is pinned (no `npx -y` of `latest` at
      startup).
- [ ] A human reviewer is in the loop for every medium and
      high-risk action — confirmed by a real test of the
      confirmation flow.
- [ ] An incident contact is on file (see [SECURITY.md](../SECURITY.md))
      and an internal runbook for "agent took an unexpected action"
      exists.
- [ ] The dependency tree was reviewed in the last 30 days.
- [ ] You accept that signed manifests, OAuth scope enforcement,
      and HTTP MCP transport are not yet shipped, and you have
      compensating controls.

If any box is unchecked, AgentBridge is **not** the right fit for
that use case in this release.

## See also

- [v1-readiness.md](v1-readiness.md) — the bar to clear before
  AgentBridge can claim production-readiness without caveats.
- [threat-model.md](threat-model.md) — every threat we know about
  and how it's mitigated today.
- [security-configuration.md](security-configuration.md) — exact
  env-var names, defaults, and bounds.
