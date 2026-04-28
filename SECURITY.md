# Security policy

## Reporting a vulnerability

If you discover a security issue in AgentBridge — particularly anything that
could let an AI agent invoke a risky action without proper confirmation, or
that could leak secrets through the audit log — please report it privately.

**Email:** `marmar9615@icloud.com`
**Subject:** `[SECURITY] AgentBridge: <one-line summary>`

Please include:
- A clear description of the issue and its impact
- A minimal reproduction (manifest snippet, command, or test case)
- Affected version(s) — `git rev-parse HEAD` is fine
- Your contact for follow-up questions

We'll acknowledge within 72 hours, work with you on a fix, and credit you in
the release notes (unless you prefer otherwise).

**Do not open a public GitHub issue** for security findings until a fix is
available.

## Scope

In-scope:
- Confirmation gate bypasses (high-risk action executes without
  `confirmationApproved` + valid token)
- Origin-pinning bypasses (manifest action endpoint can be redirected
  off-origin)
- SSRF in scanner / MCP server
- Secret leakage through the audit log
- Token reuse / token forgery in the confirmation flow
- Idempotency-key collision / replay attacks
- JSON Schema validator bypasses leading to malformed input being executed
- Stdout-hygiene regressions in the MCP server (non-JSON-RPC bytes on
  stdout that would corrupt the protocol stream)
- URL-allowlist bypasses (`AGENTBRIDGE_ALLOWED_TARGET_ORIGINS`
  prefix-match, scheme-injection, etc.)

Out of scope (the MVP doesn't claim to defend against these):
- Production OAuth, RBAC, tenant isolation — explicitly left as `// PROD:` markers
- Denial-of-service against your local dev server
- Issues in third-party dependencies (please report upstream too)

## Threat model summary

The full catalogue (15 threats with current mitigations, remaining
gaps, v1.0 targets, and test coverage) lives in
[docs/threat-model.md](docs/threat-model.md). Highlights:

| Threat | Today's mitigation | Long-term mitigation |
|---|---|---|
| Agent misclicks a destructive action | Confirmation gate + token | Same + signed policy contracts |
| Poisoned manifest redirects calls | Origin pinning to `baseUrl` | Same + signed manifests + cert pinning |
| Attacker-supplied URL → SSRF | Loopback-only by default; opt-in `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS` exact-origin allowlist (v0.3.0) | Same + DNS-rebinding/IP-pinning option for high-assurance deployments |
| Audit log leaks secrets | Recursive redaction of common keys | Same + structured logging w/ tagged sensitive fields |
| Token replay across inputs | Token bound to `hash(url, action, input)` | Same + signed/encrypted tokens, server clock authority |
| Idempotency key collision | Conflict surfaced explicitly | Same + namespaced keys per caller identity |
| Supply-chain compromise (npm token) | Granular short-lived tokens revoked after each publish | npm Trusted Publishing + provenance (planned, see [docs/trusted-publishing.md](docs/trusted-publishing.md)) |

## Past advisories

None yet — this is a new project. Reports are welcome and will be tracked here.
