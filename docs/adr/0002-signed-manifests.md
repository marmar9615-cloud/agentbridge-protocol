# ADR 0002 — Add optional signed AgentBridge manifests

- **Status.** Proposed (v0.5.0 design phase).
- **Date.** 2026-04-28.
- **Deciders.** AgentBridge maintainers; tracked in
  [issue #31](https://github.com/marmar9615-cloud/agentbridge-protocol/issues/31)
  and
  [`docs/issues/v0.5.0-signed-manifests.md`](../issues/v0.5.0-signed-manifests.md).
- **Companion design doc.**
  [`docs/designs/signed-manifests.md`](../designs/signed-manifests.md).

## Context

AgentBridge currently ships unsigned manifests at
`/.well-known/agentbridge.json`. Agents fetch the manifest,
validate it against the schema in
[`packages/core`](../../packages/core/src/schemas.ts), and call the
declared actions through the MCP server. The MCP server origin-pins
every outbound call to the manifest's `baseUrl`
([`assertSameOrigin`](../../apps/mcp-server/src/safety.ts)) and
gates risky actions behind a confirmation token. There is **no
publisher-level integrity check** on the manifest itself.

Three constraints frame the decision:

1. **Existing safety controls must continue to enforce.** The
   confirmation gate, origin pinning, target-origin allowlist,
   audit redaction, stdio stdout hygiene, and HTTP transport
   auth/origin checks are non-negotiable. Verification is the
   newest in a stack of controls — not a replacement for any of
   them.
2. **Manifests must remain plain JSON at the well-known path.** A
   v0.4.x agent that doesn't know about signing must still be able
   to read a v0.5.0 signed manifest and ignore the new field.
   Otherwise we break every existing reader on the upgrade.
3. **No central authority.** AgentBridge is and stays a self-hosted
   set of packages
   ([v1-readiness §2](../v1-readiness.md#2-v100-non-goals)). The
   trust root is the publisher's own origin, not a third-party CA
   or registry.

The full threat catalogue is in
[`docs/threat-model.md`](../threat-model.md); T1 ("Malicious
manifest") is the open threat this decision closes for the signed
case.

## Decision

AgentBridge will add **optional cryptographically signed manifests**
in the v0.5.0 release line, alongside the existing unsigned path,
with the following non-negotiable properties:

1. **Signing is opt-in.** v0.4.x manifests remain valid against the
   v0.5.0 schema. Unsigned manifests still work. The default
   posture is "verify if signed, scanner downgrade if unsigned."
2. **Signature lives inline in the manifest.** A new optional
   `signature` block on the manifest carries `alg`, `kid`, `iss`,
   `signedAt`, `expiresAt`, and a base64url signature `value`. The
   signed payload is the manifest object **with the `signature`
   field stripped**, run through the canonical-JSON serializer.
   Detached `.sig` sidecars and full JWS-wrapped manifests are
   rejected for v0.5.0 (see ADR alternatives).
3. **Canonicalization is RFC 8785 (JCS).** A standardized,
   deterministic serializer with multi-language reference
   implementations.
4. **Default algorithm is Ed25519 (`alg: "EdDSA"`).** Built into
   Node's `crypto` module, deterministic, small, no
   padding/curve-choice traps. ES256 is permitted as a secondary
   for HSM/KMS-bound publishers. RSA variants are deferred.
5. **Public keys are published by the publisher.** The publisher
   serves a key set at `/.well-known/agentbridge-keys.json`. The
   publisher's origin is the trust root; no central CA, no
   transparency log dependency in v0.5.0.
6. **Verification is additive.** A verified manifest still goes
   through the confirmation gate, origin pinning, target-origin
   allowlist, audit redaction, and HTTP transport auth checks. A
   signed manifest does not bypass any control.
7. **High-assurance deployments can require signatures.** The MCP
   server gains `AGENTBRIDGE_REQUIRE_SIGNATURE=true` and the CLI's
   `validate` gains `--require-signature`. Default is permissive
   (unsigned ⇒ scanner downgrade) so adopters can roll out signing
   without breaking their pipelines.
8. **Audit events distinguish signed and unsigned.** Events gain
   `signatureStatus`, `signatureKid`, and `signatureIssuer` fields.
   The signature `value` is **never** logged.
9. **Key rotation is a routine event.** Publishers add new `kid`s
   to `keys[]` and move retired ones to `revokedKids`. Agents
   refresh on the configured TTL; a revoked `kid` fails closed
   immediately on refresh.

The full design — schema additions, verification failure-mode
matrix, env vars, scanner check IDs, CLI commands, test plan — is
in [`docs/designs/signed-manifests.md`](../designs/signed-manifests.md).

## Consequences

### Positive

- The trust gap behind T1 (Malicious manifest) is closed for the
  signed case. CDN poisoning, MITM after TLS termination, and
  stale-manifest replay become detectable.
- Existing safety story extends cleanly. Verification sits *in
  front of* the confirmation gate / origin pinning / target-origin
  allowlist; the existing code paths are unchanged.
- v1.0 criterion #7 ("Signed-manifest design complete") becomes
  satisfiable once this PR merges; implementation closes it.
- Backwards compatible. v0.4.x agents and scanners continue to
  work against v0.5.0 manifests.
- Self-hosted trust model. No central authority, no required
  network call to a third party.
- Canonicalization is standard (RFC 8785), so non-JS publishers
  can build compatible signers.

### Neutral

- New optional schema field (`signature`). The manifest spec stays
  at v0.1; adding an optional field is non-breaking.
- New env vars (`AGENTBRIDGE_REQUIRE_SIGNATURE`,
  `AGENTBRIDGE_KEYS_CACHE_TTL_SECONDS`,
  `AGENTBRIDGE_SIGN_SKEW_SECONDS`,
  `AGENTBRIDGE_MAX_MANIFEST_AGE_SECONDS`,
  `AGENTBRIDGE_PINNED_KIDS`). Additive, on the same `AGENTBRIDGE_*`
  namespace.
- Audit events grow by three optional fields. Backwards-compatible
  for readers; documented in `core`'s schemas when implementation
  lands.

### Negative

- Increased surface area. New cryptographic code paths, a new
  well-known endpoint to fetch and cache, a canonicalizer to
  audit. Each is a potential vulnerability we must test rigorously
  per the design's [§16 testing plan](../designs/signed-manifests.md#16-testing-plan).
- More configuration knobs operators must understand. Mitigated by
  conservative defaults (verify if signed, downgrade if unsigned),
  a documented production recipe, and CLI commands that produce
  copy-pasteable key sets.
- Key custody moves onto the publisher. A publisher who loses or
  leaks a private key has to rotate. Documented in the design's
  [§10 rotation and revocation](../designs/signed-manifests.md#10-key-rotation-and-revocation).
- Clock skew becomes part of the trust model. Mitigated with a
  bounded skew env var (default 60s, max 600s).

## Alternatives considered

### A. No signing — rely on TLS only

Trust the publisher's TLS certificate and DNS. No manifest-level
signature.

- **Rejected** because TLS covers the wire, not the artifact. A
  cached, replayed, or post-fetch-tampered manifest passes TLS but
  is exactly the threat T1 describes. TLS is necessary; not
  sufficient.

### B. Detached `.sig` sidecar

Serve a separate `agentbridge.json.sig` file alongside the
manifest.

- **Rejected.** Adds a second fetch with its own caching
  semantics, splits the trust surface, and introduces a desync
  class (manifest updated, sidecar stale). The inline `signature`
  field gives the same security with one fetch.

### C. JWS-wrapped manifest

Encode the entire manifest as a JWS compact-serialization payload.

- **Rejected for v0.5.0.** The well-known endpoint stops being
  plain JSON, breaking every existing v0.4.x reader. A future
  release can add a `application/jose` alternate encoding without
  breaking the inline form.

### D. Hosted manifest signing registry

A central AgentBridge service signs manifests on the publisher's
behalf.

- **Rejected.** Conflicts with v1.0 non-goal #1
  ([v1-readiness §2](../v1-readiness.md#2-v100-non-goals)):
  AgentBridge stays self-hosted. A central registry would also
  introduce a single point of trust.

### E. Blockchain / transparency-log anchoring

Anchor every signed manifest to a public transparency log
(Sigstore Rekor, Certificate Transparency-like).

- **Deferred, not rejected.** Useful as defense in depth and
  non-repudiation, but introduces a network dependency for
  verification and a new operational surface. v0.5.0 ships local
  verification; v0.6+ can add transparency-log integration as an
  additive feature.

### F. Per-action signatures

Sign each action individually instead of (or in addition to) the
whole manifest.

- **Rejected.** Origin pinning already prevents endpoint
  redirection within a manifest. Per-action signing would add
  complexity (which action signed under which key, partial-trust
  manifests, etc.) without closing a real gap.

## Links

- Tracking issue:
  [#31](https://github.com/marmar9615-cloud/agentbridge-protocol/issues/31)
  /
  [`docs/issues/v0.5.0-signed-manifests.md`](../issues/v0.5.0-signed-manifests.md).
- Design doc:
  [`docs/designs/signed-manifests.md`](../designs/signed-manifests.md).
- Roadmap: [`docs/roadmap.md`](../roadmap.md) (v0.5.0 line).
- v1 readiness: [`docs/v1-readiness.md`](../v1-readiness.md)
  criterion #7.
- Threat model: [`docs/threat-model.md`](../threat-model.md) T1
  (Malicious manifest).
- Production readiness:
  [`docs/production-readiness.md`](../production-readiness.md) —
  the "Recommended production architecture (planned for v1.0)"
  section names signed manifests as a Phase 5 / v0.5.0 milestone.
- Security configuration:
  [`docs/security-configuration.md`](../security-configuration.md)
  — gains the `AGENTBRIDGE_REQUIRE_SIGNATURE` /
  `AGENTBRIDGE_KEYS_CACHE_TTL_SECONDS` /
  `AGENTBRIDGE_SIGN_SKEW_SECONDS` /
  `AGENTBRIDGE_MAX_MANIFEST_AGE_SECONDS` /
  `AGENTBRIDGE_PINNED_KIDS` table when implementation lands.
- Predecessor ADR: [`docs/adr/0001-http-mcp-transport.md`](0001-http-mcp-transport.md)
  — the same "design-first, runtime-later" pattern used for the
  v0.4.0 HTTP transport.
- RFC 8785 — JSON Canonicalization Scheme (JCS).
- RFC 8037 — Edwards-curve algorithms for JOSE.
- RFC 8032 — Ed25519 / Ed448 signatures.
- RFC 7517 — JSON Web Key.
