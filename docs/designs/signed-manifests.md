# Signed Manifests Design

> **Status.** Proposed (v0.5.0 design phase). No runtime change in
> this document or the PR that lands it. The implementation will
> follow in subsequent PRs against the same `v0.5.0` line.
>
> **Tracking issue.**
> [`docs/issues/v0.5.0-signed-manifests.md`](../issues/v0.5.0-signed-manifests.md)
> (mirrors GitHub issue
> [#31](https://github.com/marmar9615-cloud/agentbridge-protocol/issues/31)).
>
> **ADR.**
> [`docs/adr/0002-signed-manifests.md`](../adr/0002-signed-manifests.md).

## 1. Summary

AgentBridge currently ships unsigned manifests at
`/.well-known/agentbridge.json`. Agents fetch the manifest, validate
it against the schema in
[`packages/core`](../../packages/core/src/schemas.ts), and call the
declared actions through the MCP server. The server origin-pins
every outbound call to the manifest's `baseUrl`
([`assertSameOrigin`](../../apps/mcp-server/src/safety.ts)) and
gates risky actions behind a confirmation token. There is **no
publisher-level integrity check** on the manifest itself.

v0.5.0 adds an **opt-in cryptographic signature on the manifest
payload**, plus a published per-publisher key set, so an agent
(or the MCP server) can verify the manifest came from the claimed
publisher and has not been tampered with after publication.

The verifier sits *in front of* the existing safety stack — the
confirmation gate, origin pinning, target-origin allowlist, and
audit redaction continue to run unchanged. Verification is
**additive**: a verified manifest does not bypass any existing
control. An unverified manifest still works in v0.5.0; the
scanner and CLI can warn or fail at the operator's discretion.

## 2. Goals

- Bind a manifest to a publisher key the agent can verify offline.
- Detect tampering (CDN poisoning, MITM after TLS termination,
  storage compromise).
- Detect replay of stale manifests.
- Make verification **additive**: existing safety controls keep
  enforcing on top.
- Make signing **opt-in**: unsigned manifests still validate and
  still work in v0.5.0.
- Make verification **deterministic**: the same payload always
  produces the same canonical serialization, on Node 20 and 22, on
  Linux and macOS.
- Make key rotation routine, not an emergency procedure.
- Stay self-hosted: no central CA, no required network call to a
  third-party registry.
- Preserve all v0.4.0 invariants — confirmation gate, origin
  pinning, target-origin allowlist, audit redaction, stdio stdout
  hygiene, HTTP transport auth/origin checks.

## 3. Non-goals

- **No full WebPKI/X.509 dependency** for v0.5.0. We use raw public
  keys with publisher-controlled key sets. WebPKI integration may
  come later if it pulls its weight.
- **No central certificate authority** in v0.5.0. The publisher
  hosts its own key set at `/.well-known/agentbridge-keys.json`.
- **No blockchain anchoring.** Verification is a local cryptographic
  check; no third-party network call.
- **No removal of unsigned-manifest support yet.** v0.5.0 ships
  signing alongside the existing unsigned path. Mandatory signing
  is reserved for a later release with a documented migration.
- **No JWT / JWS framing for the whole manifest by default.**
  Inline JWS is one of the alternatives we evaluate
  (see [§7](#7-signature-envelope-options)); the recommendation is
  detached signature in a sidecar `signature` field, but JWS is a
  compatible later option.
- **No per-action signatures.** A signature covers the full
  manifest payload. Per-action signing adds complexity without
  closing a real gap (origin pinning already prevents endpoint
  redirection within a manifest).
- **No real destructive demo actions.** The demo continues to
  simulate refunds and other risky operations.

## 4. Threat model

### Threats this design addresses

| ID | Threat | Today's gap | Closed by |
|---|---|---|---|
| **T1.a** | Substituted manifest (CDN poisoning, stolen TLS cert, MITM after TLS termination) | None at protocol layer; relies on transport security and DNS | Signature verification against pinned publisher key |
| **T1.b** | Replay of stale manifest after rotation | None; agents can't tell fresh from stale | Signed `signedAt` + max-age (`expiresAt`) inside the signed payload |
| **T1.c** | Wrong publisher (manifest served at the right origin but signed by the wrong key) | Origin pinning protects endpoints, not the manifest | `kid` lookup against the per-publisher key set, `iss` claim binding |
| **T1.d** | Manifest re-signed under a revoked key | None | Key set lists active keys; revoked `kid`s are absent and verification fails |

These map to existing
[T1 (Malicious manifest)](../threat-model.md#t1-malicious-manifest)
in the threat model. T1 is downgraded from "open" to "mitigated for
signed manifests" once v0.5.0 ships.

### Threats this design does NOT address

- **Compromised publisher signing key.** If the key itself is
  stolen, the attacker can produce verifiable manifests until the
  key is rotated. v0.5.0 mitigates this with rotation and
  revocation; v1.0+ may add transparency-log anchoring.
- **Malicious-but-honest publisher.** A publisher who chooses to
  declare a `risk: "low"` action that is actually high-risk gets
  the signature anyway. Risk classification is a publisher
  responsibility (already documented as the boundary in
  [`docs/threat-model.md`](../threat-model.md)).
- **Compromised agent.** An agent that ignores verification
  results — or runs in a runtime that doesn't verify — gets no
  protection. Verification has to be enforced by the MCP server
  (which we control) or the agent runtime (which we don't).
- **Out-of-band manifest distribution.** A manifest copied to a
  channel without `/.well-known/agentbridge-keys.json` cannot be
  verified. The design specifies a key resolution model that
  works whenever the publisher origin is reachable.

### New attack surface introduced

- **Public key distribution.** The key set endpoint becomes part
  of the manifest's trust surface. We treat it the same as
  `/.well-known/agentbridge.json`: fetched over TLS, schema-
  validated, scoped to one origin.
- **Canonicalization mismatch.** A signer and verifier that
  disagree on canonical JSON produce false negatives (and
  potentially false positives if a sloppy verifier accepts
  reorderings). We mitigate by shipping a single canonicalizer
  with cross-language test vectors.
- **Time-based denial of service.** A manifest with a tight
  `expiresAt` in the past forces every agent to reject it.
  Mitigated by sane defaults (24h freshness window) and operator
  controls.

## 5. Manifest signing model

### 5.1 What is signed

The signed payload is the **whole manifest minus the signature
field itself**. Concretely:

```jsonc
{
  "name": "Acme Orders",
  "version": "1.4.2",
  "baseUrl": "https://orders.acme.example",
  "actions": [ /* … */ ],
  "resources": [ /* … */ ],
  // … all other manifest fields …
  "signature": {
    "alg": "EdDSA",
    "kid": "acme-orders-2026-04",
    "iss": "https://orders.acme.example",
    "signedAt": "2026-04-28T12:00:00Z",
    "expiresAt": "2026-04-29T12:00:00Z",
    "value": "BASE64URL(sig over canonicalize({manifest minus signature}))"
  }
}
```

The signing process:

1. Build the manifest object as it will be served.
2. **Strip** the `signature` field (if present from a prior pass).
3. Run the canonical-JSON serializer (see [§8](#8-canonicalization-strategy))
   to produce a deterministic byte string.
4. Sign the byte string with the publisher's private key.
5. Attach the resulting `signature` block.

The verifier reverses the process: parse the manifest, lift off
the `signature` block, canonicalize the rest, and check the
signature value against the publisher's public key for `kid`.

### 5.2 Why "manifest minus the signature field"

This shape gives us:

- **Round-trippable JSON.** The signed manifest is still a single
  JSON document. No detached `.sig` file means no second fetch.
- **Self-describing key reference.** `kid` is right next to the
  signature, so a verifier never has to guess which key to load.
- **Backward compatibility.** A v0.4.0 reader that doesn't
  understand `signature` ignores the extra field (the manifest
  schema is `additionalProperties: true`). Verification is
  **additive**.
- **Symmetric with JWS.** If we later wrap the whole thing in a
  JWS envelope, the body is still the same canonical payload.

### 5.3 Why not detached `.sig` sidecar

A separate `agentbridge.json.sig` file (or `manifest.signature`
endpoint) was considered. Trade-offs:

- (+) Keeps the manifest 100% byte-identical to v0.4.0.
- (−) Requires a second fetch with its own caching semantics.
- (−) Splits the trust surface: an attacker who can poison the
  manifest can usually poison the sidecar too, and a verifier
  that fetches one without the other is broken in subtle ways.

We prefer inline-with-stripped-`signature` because the second
fetch buys nothing and adds a new failure mode.

### 5.4 Why not full JWS envelope

A pure JWS-wrapped manifest (manifest serialized as the JWS payload,
delivered as a compact JWS string) was considered. Trade-offs:

- (+) Standard envelope, mature tooling.
- (+) `alg`/`kid` live in a defined header.
- (−) The manifest is no longer JSON until the agent decodes it.
  Every existing scanner, validator, and MCP-server code path that
  reads `/.well-known/agentbridge.json` would need a JWS-decoding
  shim.
- (−) Detached JWS (the natural compromise) is closer to our
  inline approach but adds compact-encoding rules without an
  obvious benefit at v0.5.0 scale.

The inline-`signature`-block design is **JWS-equivalent in
content** — same `alg`, `kid`, signed bytes — but stays inside
plain JSON. We can add a JWS envelope as an alternative encoding
in v0.6.x without breaking the inline format.

## 6. Algorithms and key formats

### 6.1 Default algorithm: Ed25519 (EdDSA)

| Property | Value |
|---|---|
| `alg` value | `"EdDSA"` (RFC 8037) |
| Curve | Ed25519 |
| Public key size | 32 bytes |
| Private key size | 32 bytes (seed) |
| Signature size | 64 bytes |
| JWK encoding | `{kty: "OKP", crv: "Ed25519", x: "BASE64URL(pubkey)"}` |
| Node API | `crypto.sign(null, message, privateKey)` (Node ≥ 16) |

**Why Ed25519:**

- Built into Node's `crypto` module — no new runtime dependency.
- Tiny keys, tiny signatures. The whole signature block is < 200
  bytes when base64-encoded, which keeps a typical manifest under
  a single TCP segment.
- Deterministic signatures (no nonce), so rerunning the signer on
  the same manifest produces byte-identical output. Useful for
  reproducible-build workflows.
- Modern, no padding/curve-choice traps.

### 6.2 Permitted algorithms

`alg` is an enum at the schema level. v0.5.0 ships with:

- `"EdDSA"` (Ed25519) — default.
- `"ES256"` (ECDSA on P-256, SHA-256) — accepted when present, for
  publishers using HSMs / KMS that don't expose Ed25519.

`"RS256"`, `"PS256"`, etc., are **not** in the v0.5.0 enum. We can
add them in a minor release without breaking the format. They are
larger and slower, with no advantage for this use case.

### 6.3 Public-key distribution

The publisher serves a key set at:

```
https://<host>/.well-known/agentbridge-keys.json
```

Schema (illustrative — the real Zod schema lives in
`packages/core/src/signing/keys.ts` when implementation lands):

```jsonc
{
  "issuer": "https://orders.acme.example",
  "version": "1",
  "keys": [
    {
      "kid": "acme-orders-2026-04",
      "alg": "EdDSA",
      "use": "manifest-sign",
      "publicKey": {
        "kty": "OKP",
        "crv": "Ed25519",
        "x": "BASE64URL(32-byte public key)"
      },
      "notBefore": "2026-04-01T00:00:00Z",
      "notAfter":  "2026-10-01T00:00:00Z"
    }
  ],
  "revokedKids": ["acme-orders-2025-10"]
}
```

Notes:

- The endpoint is a **plain JSON document** at a `.well-known`
  path, mirroring the manifest itself. Same fetch / caching /
  validation rules.
- `issuer` is the canonical origin and **must** match the
  manifest's `signature.iss`.
- `keys[]` is the active set. A `kid` not in `keys[]` is treated
  as unknown.
- `revokedKids` is an explicit revocation list. A `kid` listed
  here fails verification *even if* a verifier has it cached from
  a prior fetch.
- `notBefore`/`notAfter` are advisory verification windows; the
  authoritative freshness signal is the manifest's `signedAt` /
  `expiresAt`.

### 6.4 Pinning vs. trust-on-first-use

Two operator postures:

- **Pinned (recommended for production).** The agent or MCP server
  is configured with a publisher → `kid` (or `kid` set) pin. A
  manifest signed by anything else fails closed. The pin lives in
  configuration (env var or config file), not in the manifest.
- **TOFU (trust-on-first-use, for development).** The agent
  fetches `agentbridge-keys.json` once and pins on first
  successful verification. Subsequent rotations require explicit
  acknowledgement.

Both modes use the same key-set fetch and the same verifier. The
difference is configuration and what counts as a "first-time
acceptable" key.

## 7. Signature envelope options

For completeness, the alternatives we evaluated:

| Option | Description | Verdict |
|---|---|---|
| **A. Inline `signature` field on the manifest** (recommended) | Manifest stays JSON; signature lives in a sibling field. Canonicalization strips it before signing/verifying. | ✅ Chosen — fewest moving parts, no double-fetch, backward-compatible reading. |
| B. Detached sidecar (`agentbridge.json.sig`) | A separate file at the same `.well-known` path. | ❌ Adds a second fetch and a new desync mode. |
| C. JWS-wrapped manifest (compact form) | The whole manifest is the JWS payload. | ❌ Breaks every reader that expects plain JSON at the well-known path. Fine as an alternate encoding later. |
| D. Detached JWS | Compact JWS over canonical manifest bytes, served as a sidecar. | ❌ Same desync concern as (B), with extra encoding rules. |
| E. Hosted registry signature | A central registry signs every manifest on the publisher's behalf. | ❌ Conflicts with the self-hosted non-goal; introduces a single point of trust. |
| F. TLS-only "signing" (no payload signature) | Trust the certificate chain; use TLS as the signature. | ❌ Covers transport, not the artifact. Doesn't address replay or post-fetch tampering. A stolen/cached manifest still passes. |

## 8. Canonicalization strategy

### 8.1 Why canonicalization matters

Two JSON serializations of the same logical document can produce
different byte strings (key order, whitespace, number formatting,
Unicode escapes). The signer and the verifier must produce **the
same byte string** from the same logical document, on every
platform, every Node version, every locale. We cannot rely on
`JSON.stringify` directly.

### 8.2 Choice: RFC 8785 (JCS)

We use **JSON Canonicalization Scheme** (RFC 8785, "JCS"):

- Object keys sorted lexicographically.
- No insignificant whitespace.
- Numbers in normalized form (no trailing zeros, no `+`).
- Strings using minimal Unicode escaping (only what JSON requires).
- UTF-8 byte output.

Why JCS:

- **Deterministic across runtimes.** Multiple language
  implementations exist (Go, Rust, Python, Java) so non-JS agents
  can verify the same bytes.
- **Standardized.** RFC 8785 is the IETF-blessed canonicalization;
  no bespoke spec for us to maintain.
- **Small, audit-able.** A pure-JS implementation fits in a few
  hundred lines.

We will ship a minimal JCS implementation in
`packages/core/src/signing/canonical.ts` (no new runtime
dependency) and verify it against the RFC's test vectors plus our
own AgentBridge fixtures.

### 8.3 What is canonicalized

- The full manifest object **after** `signature` is stripped.
- All other top-level fields (`name`, `description`, `version`,
  `baseUrl`, `actions[]`, `resources[]`, `auth`, `contact`,
  `generatedAt`, plus any future additive fields).

`additionalProperties: true` on the schema means an agent that
encounters new fields *will canonicalize and verify them* — this
is intentional. A signature must cover everything an agent might
trust.

### 8.4 What if a publisher uses a non-JCS canonicalizer?

The signer is the publisher's own tooling. If it produces non-
canonical bytes, verification will fail. We protect against this
by:

- Shipping `signManifest()` in the SDK with JCS baked in. Most
  publishers will use it.
- Documenting the canonicalization algorithm and providing test
  vectors so non-JS publishers can build a compatible signer.

## 9. Key identity, issuer binding, and trust model

### 9.1 The `iss` claim

`signature.iss` is the canonical origin of the publisher
(`https://host[:port]`). The verifier asserts:

1. `iss === manifest.baseUrl` (origin compare). A signature whose
   issuer differs from the manifest's `baseUrl` fails.
2. `iss === fetched URL's origin`. The agent fetched the manifest
   from somewhere; the signature must claim the same origin.
3. `iss` must match the `issuer` field in the fetched
   `agentbridge-keys.json`.

These three checks together mean: a manifest signed for one
publisher cannot be served as another.

### 9.2 The `kid` claim

`kid` is a publisher-chosen string identifying which key in
`agentbridge-keys.json[].keys[]` produced the signature. Convention
(not enforced):

```
<service-slug>-<YYYY-MM>[-<purpose>]
e.g. "acme-orders-2026-04", "acme-orders-2026-10-rotation"
```

Verification requires `kid` to be present in `keys[]` (active) and
absent from `revokedKids` (not revoked).

### 9.3 The `alg` claim

`alg` is the JWS algorithm identifier. The verifier asserts:

- `alg === keys[kid].alg` (signature alg matches the key's alg).
- `alg` is in the v0.5.0 permitted set
  (`"EdDSA"`, `"ES256"` — see [§6.2](#62-permitted-algorithms)).

Algorithm confusion attacks (e.g. claiming `alg: none`) fail at
this step.

### 9.4 Trust model in one paragraph

**The publisher origin is the trust root.** The agent fetches
`https://host/.well-known/agentbridge.json` and
`https://host/.well-known/agentbridge-keys.json` over TLS. The
manifest's `signature.iss` must equal `host`. The signing key's
`kid` must be present in the key set's active list and absent
from `revokedKids`. The `alg` must match the key's `alg`. The
canonical-JSON bytes of `manifest minus signature` must verify
against the public key. Every check is local and offline-capable
(after the keys are fetched).

## 10. Key rotation and revocation

### 10.1 Rotation as a routine event

A publisher rotates by:

1. Generate a new key pair (`agentbridge keys generate
   --kid acme-orders-2026-10`).
2. Add the public key to `agentbridge-keys.json[].keys[]`.
3. Sign new manifests with the new private key.
4. Optionally, leave the old key in `keys[]` for an overlap window
   so cached manifests still verify.
5. Once the overlap window closes, remove the old `kid` from
   `keys[]`.

Rotation does not require any agent to re-pin if the agent uses
the publisher's key set as its source of truth. A pinned-`kid`
deployment must update its pin during the overlap window.

### 10.2 Revocation

A compromised key is **revoked** by:

1. Adding the `kid` to `revokedKids`.
2. Removing the `kid` from `keys[]`.
3. Re-issuing recent manifests under a fresh `kid`.

Revocation is **publisher-driven**. Agents that fetch the key set
will see the revocation and fail closed on any manifest signed
with the revoked `kid`, regardless of `expiresAt`.

### 10.3 Cache invalidation

The MCP server caches the key set for the same TTL as the manifest
(`AGENTBRIDGE_KEYS_CACHE_TTL_SECONDS`, proposed default 300s, range
60s–3600s, configurable per [§13.6](#136-mcp-server-impact)). A
revoked-but-cached `kid` becomes invalid once the cache expires;
operators can force-refresh by restarting the server.

For high-assurance deployments, the operator can set TTL to its
minimum and pin a specific `kid`. A pinned `kid` that is later
revoked at the publisher fails verification immediately on the
next key-set fetch (we always check `revokedKids` before `keys[]`).

## 11. Freshness, expiry, and replay protection

### 11.1 Required claims

`signature.signedAt` (ISO 8601, UTC) is required.
`signature.expiresAt` (ISO 8601, UTC) is required and **must be ≤
`signedAt + AGENTBRIDGE_MAX_MANIFEST_AGE`** (proposed default 24h,
range 1h–7d).

The verifier asserts:

- `now ≥ signedAt - skew` (skew default 60s).
- `now ≤ expiresAt + skew`.
- `expiresAt > signedAt`.

### 11.2 Why both timestamps

`signedAt` alone tells the verifier when the signer claims it
signed. `expiresAt` alone tells the verifier when to stop trusting
without a re-sign. Together they:

- Bound replay windows.
- Force publishers to re-sign on rotation rather than reusing an
  ancient signature.
- Let an MCP server display "this manifest expires in N minutes"
  to operators.

### 11.3 Why not nonces

A nonce-based replay defense (server tracks every seen `signature`
hash) was considered. Trade-offs:

- (+) Detects exact replay.
- (−) Requires durable state across MCP server processes — the
  exact thing we don't have until v0.7 (storage adapters).
- (−) Doesn't help when the attacker re-signs the same payload
  with the same key (the attack we already mitigate via expiry).

We choose timestamp-based freshness. A future v0.7+ release with
durable storage may add a nonce ledger as defense in depth.

### 11.4 Clock skew handling

Clocks drift. The verifier accepts a configurable skew
(`AGENTBRIDGE_SIGN_SKEW_SECONDS`, default 60, range 0–600). A
manifest whose `signedAt` is up to 60 seconds in the future
(per the verifier's clock) still passes. Same on expiry: a
manifest whose `expiresAt` is up to 60 seconds in the past still
passes. Skew is bounded so an attacker can't arbitrarily extend
freshness by claiming a future `signedAt`.

## 12. Verification behavior and failure modes

The verifier returns a discriminated result:

```ts
type VerifyResult =
  | { ok: true;  kid: string; iss: string }
  | { ok: false; reason: VerifyFailure }

type VerifyFailure =
  | "missing-signature"
  | "malformed-signature"
  | "unsupported-algorithm"
  | "unknown-kid"
  | "revoked-kid"
  | "key-set-fetch-failed"
  | "issuer-mismatch"
  | "origin-mismatch"
  | "before-signed-at"
  | "expired"
  | "canonicalization-failed"
  | "signature-invalid"
```

### 12.1 Behavior matrix

| Failure | Default v0.5.0 behavior | `--require-signature` mode |
|---|---|---|
| `missing-signature` | scanner downgrade (warn); MCP server proceeds; CLI `validate` exits 0 with note | MCP server **refuses** the action call; CLI `validate --require-signature` exits 1; scanner deducts as `error` |
| `malformed-signature` | scanner `error`; MCP server **refuses**; CLI `validate` exits 1 | same |
| `unsupported-algorithm` | scanner `error`; MCP server **refuses** | same |
| `unknown-kid` | scanner `error`; MCP server **refuses** | same |
| `revoked-kid` | scanner `error`; MCP server **refuses**; emits explicit "revoked" audit event | same |
| `key-set-fetch-failed` | scanner `warning`; MCP server **refuses** verification (but unsigned-mode call paths still work for unsigned manifests) | MCP server **refuses** |
| `issuer-mismatch` | scanner `error`; MCP server **refuses** | same |
| `origin-mismatch` | scanner `error`; MCP server **refuses** | same |
| `before-signed-at` | scanner `error`; MCP server **refuses**; "clock skew likely" hint | same |
| `expired` | scanner `error`; MCP server **refuses**; "ask publisher to re-sign" hint | same |
| `canonicalization-failed` | scanner `error`; MCP server **refuses** | same |
| `signature-invalid` | scanner `error`; MCP server **refuses**; explicit audit event | same |

### 12.2 Verification does not bypass other safety controls

This is the most important property of the design.

- A **verified** manifest still goes through the confirmation gate
  for risky actions. Verification confirms publisher; it does not
  confirm operator intent.
- A **verified** manifest still has every action endpoint origin-
  pinned to its `baseUrl`. Verification confirms the manifest's
  bytes; it does not authorize cross-origin endpoints.
- A **verified** manifest still must pass the outbound
  target-origin allowlist (`AGENTBRIDGE_ALLOWED_TARGET_ORIGINS`).
  Verification confirms the publisher; it does not whitelist the
  target.
- A **verified** manifest's actions are still subject to
  audit redaction. Sensitive fields are redacted regardless of
  signature status.
- The HTTP transport's auth + Origin allowlist apply in front of
  verification — clients still have to authenticate to the MCP
  server before the server fetches the manifest at all.

### 12.3 Audit events

Verification adds a new audit-event extension (additive,
backwards-compatible — `core` schema accepts unknown fields):

```jsonc
{
  // existing fields …
  "signatureStatus": "verified" | "unsigned" | "invalid" | "skipped",
  "signatureKid":    "acme-orders-2026-04",
  "signatureIssuer": "https://orders.acme.example"
}
```

For `invalid`, the audit event also records `signatureFailureReason`
(matching the `VerifyFailure` enum). The signature *value* is
**never** logged.

## 13. Schema and code impact

### 13.1 Manifest schema (`packages/core/src/schemas.ts`)

Add an optional `signature` field to `AgentBridgeManifestSchema`:

```ts
export const ManifestSignatureSchema = z.object({
  alg: z.enum(["EdDSA", "ES256"]),
  kid: z.string().min(1),
  iss: z.string().url(),
  signedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  value: z.string().min(1), // base64url
});

export const AgentBridgeManifestSchema = z.object({
  // … existing fields …
  signature: ManifestSignatureSchema.optional(),
});
```

`additionalProperties: true` means older readers ignore
`signature` — backwards compatible with v0.4.x agents.

The JSON Schema in `spec/agentbridge-manifest.schema.json` gains
the same optional `signature` definition.

### 13.2 Manifest spec doc (`spec/agentbridge-manifest.v0.1.md`)

Add a new section after "Auth field" documenting the optional
`signature` block. Keep the existing v0.1 manifest spec version —
adding an optional field is non-breaking.

The first stable spec version that *requires* signatures will be
`agentbridge-manifest.v1.0.md` (see
[v1-readiness §4](../v1-readiness.md#4-stable-manifest-spec-criteria)).

### 13.3 Key-set schema (`packages/core/src/signing/keys.ts`, new)

A new module exposes:

- `AgentBridgeKeySetSchema` (Zod).
- `validateKeySet(input): VerifyResult-like discriminated union`.
- Type aliases for `ManifestKey`, `KeySet`.

### 13.4 SDK impact (`packages/sdk`)

Add `packages/sdk/src/signing.ts` (new) exposing:

```ts
export interface SignManifestOptions {
  privateKey: KeyObject | Uint8Array;   // Node KeyObject or raw seed
  kid: string;
  iss: string;
  alg?: "EdDSA" | "ES256";   // default "EdDSA"
  signedAt?: Date;            // default new Date()
  expiresAt?: Date;           // default signedAt + 24h
}

export function signManifest(
  manifest: AgentBridgeManifest,
  opts: SignManifestOptions,
): AgentBridgeManifest;       // returns a copy with .signature attached

export function createSignedManifest(
  config: CreateAgentBridgeManifestConfig,
  opts: SignManifestOptions,
): AgentBridgeManifest;
```

`createAgentBridgeManifest` is unchanged. `createSignedManifest` is
the convenience wrapper publishers will reach for.

### 13.5 Scanner impact (`packages/scanner`)

Add new structured checks (see
[`packages/scanner/src/score.ts`](../../packages/scanner/src/score.ts)
for the existing pattern). Scanner regression fixtures are touched
in a separate Codex stream — this design only specifies the new
check IDs:

| `id` | Severity (default) | Severity (`--require-signature`) | Category | Deduction |
|---|---|---|---|---|
| `manifest.signature.missing` | `info` (or `warning`) | `error` | `safety` | 0 / 5 / 15 |
| `manifest.signature.invalid` | `error` | `error` | `safety` | 25 |
| `manifest.signature.expired` | `error` | `error` | `safety` | 20 |
| `manifest.signature.unknown-kid` | `error` | `error` | `safety` | 25 |
| `manifest.signature.revoked-kid` | `error` | `error` | `safety` | 30 |
| `manifest.signature.issuer-mismatch` | `error` | `error` | `safety` | 25 |
| `manifest.signature.algorithm-unsupported` | `error` | `error` | `safety` | 20 |
| `manifest.signature.canonicalization-failed` | `error` | `error` | `safety` | 25 |
| `manifest.signature.key-set-fetch-failed` | `warning` | `error` | `safety` | 5 / 20 |

A passed check is reported when verification succeeds:

| `id` | Severity | Category |
|---|---|---|
| `manifest.signature.verified` | `info` | `safety` |

These IDs are stable identifiers — once shipped, renaming any of
them is a major bump per [v1 readiness §13](../v1-readiness.md#13-compatibility-guarantees).

### 13.6 MCP server impact (`apps/mcp-server`)

Two additive code paths:

1. **Verification helper** in
   [`apps/mcp-server/src/safety.ts`](../../apps/mcp-server/src/safety.ts)
   (or a sibling `signing.ts`): `verifyManifestSignature(manifest,
   issuerOrigin) → VerifyResult`. Pure function, easy to test.
2. **Wire it into `fetchManifest`** in
   [`apps/mcp-server/src/tools.ts`](../../apps/mcp-server/src/tools.ts):
   after schema validation, run verification. If the server is in
   `--require-signature` mode and verification fails, throw with
   the `VerifyFailure` reason. If verification succeeds, attach
   `signatureStatus` / `signatureKid` to the audit event for the
   eventual call.

New env vars (added to
[`docs/security-configuration.md`](../security-configuration.md)
when implementation lands):

| Env var | Default | Range | Purpose |
|---|---|---|---|
| `AGENTBRIDGE_REQUIRE_SIGNATURE` | unset | `true` / unset | When `true`, refuse unsigned/invalid manifests. |
| `AGENTBRIDGE_KEYS_CACHE_TTL_SECONDS` | `300` | `60–3600` | TTL on cached `agentbridge-keys.json`. |
| `AGENTBRIDGE_SIGN_SKEW_SECONDS` | `60` | `0–600` | Allowed clock skew when checking `signedAt` / `expiresAt`. |
| `AGENTBRIDGE_MAX_MANIFEST_AGE_SECONDS` | `86400` | `3600–604800` | Upper bound the verifier enforces on `expiresAt - signedAt`. |
| `AGENTBRIDGE_PINNED_KIDS` | unset | comma-separated | Production pinning: only accept these `kid`s for the matching publisher. |

All existing env vars are unchanged. Verification cannot be a
backdoor around `AGENTBRIDGE_ALLOWED_TARGET_ORIGINS` — outbound
reach is gated *after* verification, not before.

### 13.7 Studio / demo-app impact

- **Studio.** Display a signature badge per manifest in the scan
  view. Show `kid`, issuer, signed-at, expires-in. Add a
  "verified" / "unsigned" / "invalid" pill. No new persistent
  storage; the verification result is recomputed per scan.
- **Demo-app.** Optionally sign its development manifest using a
  generated dev key set. The demo's `lib/manifest.ts` gets a
  branch that, if `AGENTBRIDGE_DEMO_SIGN=true`, signs the manifest
  on first request. The default unchanged demo behavior is
  unsigned, so existing developer workflows don't break.

### 13.8 CLI impact (`packages/cli`)

New commands (additive — existing commands unchanged):

| Command | Purpose |
|---|---|
| `agentbridge keys generate --kid <id> [--alg EdDSA] [--out <path>]` | Generate a key pair. Public key is JWK-encoded; private key is JWK or raw seed. |
| `agentbridge keys list <keyset.json>` | List active and revoked keys with `notBefore` / `notAfter`. |
| `agentbridge keys rotate <keyset.json> --kid <new-id> [--retire <old-id>]` | Add a new key, optionally move an existing one to `revokedKids`. |
| `agentbridge sign <manifest.json> --key <private.jwk> --kid <id> [--alg EdDSA] [--expires-in 24h]` | Produce a signed manifest. |
| `agentbridge verify <manifest.json> [--keys <keyset.json> \| --keys-url <url>]` | Verify a manifest against a key set. Exits 0 / 1. |
| `agentbridge validate <manifest.json> [--require-signature]` | Existing command gains an optional flag. |

Output is human-readable by default, JSON when stdout is not a
TTY (matches the existing `agentbridge scan` convention).

### 13.9 OpenAPI converter impact (`packages/openapi`)

The converter does not produce signatures. A converted manifest is
unsigned by default; the operator runs `agentbridge sign`
afterward. Documented in
[docs/openapi-import.md](../openapi-import.md).

## 14. Backward compatibility

- **v0.4.x agents.** The manifest schema's
  `additionalProperties: true` means a v0.4.x agent that fetches a
  v0.5.0 signed manifest sees a known shape with one extra field
  it ignores. Behavior is identical to today.
- **v0.4.x MCP servers.** Same — the server validates the manifest
  and ignores `signature`.
- **Signed manifests fetched by v0.4.x scanner.** Same. The new
  `manifest.signature.*` checks only exist in v0.5.0+.
- **v0.5.0 agents fetching unsigned manifests.** Behavior depends
  on the operator's mode:
  - Default: works, with a scanner downgrade.
  - `--require-signature`: refused.
- **Spec version.** The manifest spec stays at `v0.1`. Adding an
  optional field is non-breaking. The first version that *requires*
  signatures will be `v1.0`, which we cannot ship until at least
  the v0.9 release (per the v1 readiness checklist).

## 15. Migration plan

### v0.5.0 (this design's release)

- Signing and verification ship as **opt-in**.
- Publishers can sign with the SDK or CLI.
- Scanner downgrades unsigned manifests as `info` (or `warning` if
  the operator passes `--require-signature`).
- MCP server verifies when present; refuses verified-invalid
  manifests; allows unsigned by default.

### v0.6.x – v0.8.x

- Watch real adoption. Tighten scanner downgrade severity if a
  meaningful share of public manifests sign.
- Add `--require-signature` to common deployment recipes once at
  least the reference manifests sign cleanly.

### v0.9.x

- Document the migration plan to mandatory signing as part of v1
  spec freeze.

### v1.0

- Mandatory signatures on the **stable** spec
  (`agentbridge-manifest.v1.0.md`) — but only after a documented
  deprecation window for unsigned manifests. Unsigned manifests
  remain valid against `v0.x` schema.

## 16. Testing plan

### 16.1 Unit tests (`packages/core/src/tests/signing.test.ts`, new)

- Canonicalization: every RFC 8785 example, plus AgentBridge-
  specific fixtures (deeply nested actions, Unicode strings,
  numeric edge cases, key-order variants).
- Sign + verify round-trip on Ed25519 and ES256.
- Tamper detection: flip one byte of `value`, of a non-`signature`
  field, of a stripped-then-restored field.
- Failure mode coverage: every `VerifyFailure` enum value is
  exercised at least once.
- Algorithm confusion: a manifest claiming `alg: none` (a string
  not in the enum) fails Zod parsing **and** the verifier.

### 16.2 SDK tests (`packages/sdk/src/tests/signing.test.ts`, new)

- `signManifest` produces a manifest that round-trips through the
  scanner with `manifest.signature.verified` passed.
- `createSignedManifest` is equivalent to
  `createAgentBridgeManifest` followed by `signManifest`.
- Default `expiresAt` is `signedAt + 24h`.
- `iss` defaults to `manifest.baseUrl` when not specified.
- Ed25519 keys can be passed as `KeyObject` or raw seed (Buffer).

### 16.3 Scanner tests (`packages/scanner/src/tests/signing.test.ts`, new — Codex coordination required)

> Coordinated with the Codex scanner-regression stream. The
> design ships the check IDs above as the contract; the actual
> test fixtures land alongside the implementation PR.

- Each new check ID fires on the right input (missing, invalid,
  expired, etc.).
- `--require-signature` flips `info` checks to `error`.
- Severity / deduction / category match the table in
  [§13.5](#135-scanner-impact-packagesscanner).

### 16.4 MCP server tests (`apps/mcp-server/src/tests/signing.test.ts`, new)

- `fetchManifest` runs verification and:
  - Default mode: returns `signatureStatus: "unsigned"` for an
    unsigned manifest, returns `signatureStatus: "verified"` for a
    valid signed manifest, throws for an invalid signed manifest.
  - `--require-signature` mode: throws for both unsigned and
    invalid.
- Verification does NOT bypass:
  - Confirmation gate (existing test extended to cover signed
    risky actions).
  - Origin pinning (cross-origin endpoint inside a verified
    manifest still rejected).
  - Target-origin allowlist (verified manifest at a non-
    allowlisted origin still rejected).
  - Audit redaction (sensitive fields still redacted in audit
    events for verified manifests).
- HTTP transport: when bearer auth fails, the request is rejected
  *before* verification runs.
- Audit events carry `signatureStatus` / `signatureKid` /
  `signatureIssuer`. The signature `value` is never present in
  any audit event under any code path.

### 16.5 CLI tests (`packages/cli/src/tests/cli.test.ts`, extend)

- `agentbridge sign` produces a valid signed manifest.
- `agentbridge verify` returns exit 0 on valid, exit 1 on each
  failure mode.
- `agentbridge keys generate / list / rotate` produce well-formed
  key sets.
- `agentbridge validate --require-signature` exits 1 on unsigned.

### 16.6 Cross-language test vectors

A small `spec/signing/test-vectors.json` ships canonicalization
inputs and expected signature bytes for a fixed Ed25519 keypair.
This lets non-JS implementers verify their canonicalizer.

### 16.7 Smoke / E2E

- `scripts/external-adopter-smoke.mjs` extended to sign the demo
  manifest with a generated dev key when `AGENTBRIDGE_DEMO_SIGN=true`
  is set, then run the CLI scan and assert the
  `manifest.signature.verified` passed-check appears.
- `npm run smoke:external` continues to pass with no env vars set
  (signing remains opt-in).

### 16.8 Negative tests (security-critical)

- A manifest signed with a key not in `keys[]` fails verification.
- A manifest signed with a `kid` in `revokedKids` fails.
- A manifest whose signed bytes match but whose `iss` claims a
  different origin fails.
- A manifest whose `expiresAt` is in the past beyond skew fails.
- A manifest whose `signedAt` is in the future beyond skew fails.
- A manifest whose `signature.alg` does not match the key's `alg`
  fails (algorithm confusion).
- A manifest with `signature` field reordered after signing
  (different canonical bytes) fails.

## 17. Open questions

1. **Key-set discovery path.** `/.well-known/agentbridge-keys.json`
   is consistent with the manifest path. Alternative:
   `/.well-known/agentbridge.json` could embed a `keys` field. The
   decision against embedding: keys rotate more often than
   actions, and a separate file means cache invalidation can be
   independent. ✅ Resolution: separate file.
2. **Multi-key signatures.** Should a manifest carry signatures
   from N publishers (e.g., a CDN co-signs)? Defer to a future
   release; v0.5.0 is single-signer. The schema's `signature`
   field can become `signatures[]` later in a non-breaking way if
   we treat the singular form as syntactic sugar.
3. **Transparency log integration.** Should signed manifests be
   anchored to a transparency log (Sigstore / Rekor-like) for
   non-repudiation? Defer; v0.5.0 ships local verification only.
4. **JWS as alternate encoding.** Should we also accept
   `application/jose` at the manifest endpoint? Defer; v0.5.0
   inline-JSON form is the canonical one.
5. **Browser verification.** Several agent runtimes are
   browser-based. Web Crypto supports Ed25519 in modern browsers.
   Worth a small `packages/core/src/signing/web.ts` for browser
   verifiers? Likely yes for v0.6+.
6. **Keys file caching policy semantics.** Should we honor
   `Cache-Control` from the publisher's HTTP response in addition
   to our own TTL? Pragmatic answer: yes, but cap to the configured
   TTL (publisher cannot ask us to cache for a year). Document
   precisely in implementation PR.
7. **Hostname vs origin in `iss`.** RFC 7519 uses a string identifier
   for `iss` that historically is sometimes a hostname, sometimes an
   origin. We use full origin (scheme + host + port) so it always
   matches `manifest.baseUrl` byte-for-byte. ✅ Resolution: origin.

## 18. Decision log

- **Inline `signature` field, not detached `.sig`.** Avoids a
  second fetch and a desync class.
- **JCS canonicalization.** Standardized, deterministic across
  runtimes, small to ship.
- **Ed25519 default.** Built into Node `crypto`, tiny, deterministic,
  no padding/curve traps.
- **Optional `signature` at v0.5.0.** Backwards compatible with
  every v0.4.x agent and scanner.
- **Verification is additive.** The confirmation gate, origin
  pinning, target-origin allowlist, audit redaction, stdio stdout
  hygiene, and HTTP transport auth checks all continue to run.
- **`/.well-known/agentbridge-keys.json` is the key set
  discovery path.** Mirrors the manifest's well-known location.
- **No central CA, no blockchain.** Self-hosted publisher controls
  its own keys. Matches v1.0 non-goal #1 in
  [v1-readiness §2](../v1-readiness.md#2-v100-non-goals).
- **`signedAt` + `expiresAt` for freshness, no nonce ledger.**
  Nonce-based replay defense requires durable cross-process state
  (v0.7+ scope).

## 19. References

- [`docs/threat-model.md`](../threat-model.md) — T1 (Malicious
  manifest) is the threat this design closes.
- [`docs/v1-readiness.md`](../v1-readiness.md) — criterion #7 is
  signed-manifest design completion.
- [`docs/security-configuration.md`](../security-configuration.md)
  — gains new env vars when implementation lands.
- [`docs/roadmap.md`](../roadmap.md) — v0.5.0 line.
- [`docs/releases/v0.4.0.md`](../releases/v0.4.0.md) — current
  shipped release.
- [`spec/agentbridge-manifest.v0.1.md`](../../spec/agentbridge-manifest.v0.1.md)
  — current manifest spec; gains an optional `signature` section.
- [`packages/core/src/schemas.ts`](../../packages/core/src/schemas.ts)
  — current Zod schema; gains optional `ManifestSignatureSchema`.
- [`apps/mcp-server/src/safety.ts`](../../apps/mcp-server/src/safety.ts)
  — origin pinning lives here; verification helper will live next
  to it.
- [`apps/mcp-server/src/tools.ts`](../../apps/mcp-server/src/tools.ts)
  — `fetchManifest` is the call site that gains verification.
- RFC 8785 — JSON Canonicalization Scheme (JCS).
- RFC 8037 — Edwards-curve algorithms for JOSE.
- RFC 8032 — Ed25519 / Ed448 signatures.
- RFC 7517 — JSON Web Key.
