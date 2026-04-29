# @marmarlabs/agentbridge-scanner

Score how agent-ready a URL is. Returns a 0–100 readiness score,
structured `checks[]`, and grouped recommendations.

Used by the [AgentBridge CLI](https://www.npmjs.com/package/@marmarlabs/agentbridge-cli),
[AgentBridge Studio](https://github.com/marmar9615-cloud/agentbridge-protocol/tree/main/apps/studio),
and the [MCP server](https://www.npmjs.com/package/@marmarlabs/agentbridge-mcp-server).

## Install

```bash
npm install @marmarlabs/agentbridge-scanner
```

`playwright` is an optional dependency — install it separately if you
want browser-based interactivity probes:

```bash
npm install playwright
```

## What's inside

- `scanUrl(url, options?)` — fetch the manifest at `${url}/.well-known/agentbridge.json`
  (with fallbacks), validate it, and run a battery of structured checks.
- `ScanResult` type — `{ score, checks[], passed[], summary }`.
- `Check` type — `{ severity, category, path, message, recommendation }`.

## Quick example

```ts
import { scanUrl } from "@marmarlabs/agentbridge-scanner";

const result = await scanUrl("http://localhost:3000");
console.log(`score: ${result.score}/100`);
for (const check of result.checks) {
  console.log(`[${check.severity}] ${check.path}: ${check.message}`);
}
```

## Categories

Checks are grouped into:
- `safety` — confirmation gates, risk classification, idempotency, **signed-manifest verification (v0.5.0)**
- `schema` — manifest shape, JSON Schema validity, examples
- `docs` — descriptions, summaries, contact info
- `developerExperience` — discoverability, latency, error responses

## Signed-manifest checks (v0.5.0, optional)

The scanner can verify a manifest's signature against a publisher
key set you supply. **The default scanner behavior is unchanged** —
unsigned manifests still score the same and signed manifests trigger
no signature check unless you opt in via the `signature` option.

```ts
import { scanUrl } from "@marmarlabs/agentbridge-scanner";

const keySet = await loadYourKeySetSomehow(); // e.g. from /.well-known/agentbridge-keys.json

const result = await scanUrl("https://orders.acme.example", {
  signature: {
    keySet,                                        // required to verify
    expectedIssuer: "https://orders.acme.example", // optional strict check
    requireSignature: false,                       // default: missing signature → info, no deduction
    now: new Date(),                               // optional override for testing
    clockSkewSeconds: 60,                          // forwarded to the verifier
  },
});

const verified = result.passed.find((c) => c.id === "manifest.signature.verified");
const invalid = result.checks.find((c) => c.id === "manifest.signature.invalid");
```

`scoreManifest(manifest, options?)` accepts the same `signature` block.

For a copy-pasteable reporting walkthrough, see
[`examples/scanner-signature-reporting`](https://github.com/marmar9615-cloud/agentbridge-protocol/tree/main/examples/scanner-signature-reporting).
It demonstrates unsigned default output, `requireSignature`, verified
signatures, tampering, and expiry using the public key set from the
signed-manifest example.

### Check IDs

Stable identifiers — once shipped, renaming any of them is a major
bump per
[`docs/v1-readiness.md` §13](https://github.com/marmar9615-cloud/agentbridge-protocol/blob/main/docs/v1-readiness.md#13-compatibility-guarantees).
All sit under category `safety`.

| Check | Severity (default) | Severity (`requireSignature`) | Deduction | When |
|---|---|---|---|---|
| `manifest.signature.verified` (passed) | info | info | 0 | Signature verified successfully |
| `manifest.signature.missing` | info | error | 0 / 15 | Manifest carries no `signature` block |
| `manifest.signature.unverified-no-key-set` | info | info | 0 | Signature present but no `keySet` was supplied — verification skipped |
| `manifest.signature.malformed` | error | error | 25 | Signature block fails schema validation, including inverted/zero-length time window |
| `manifest.signature.key-set-malformed` | warning | warning | 0 | Operator-supplied key set fails schema validation (manifest readiness unaffected) |
| `manifest.signature.unsupported-algorithm` | error | error | 20 | Algorithm outside `EdDSA` / `ES256` |
| `manifest.signature.unknown-kid` | error | error | 25 | `kid` not in `keySet.keys[]` |
| `manifest.signature.revoked-kid` | error | error | 30 | `kid` listed in `keySet.revokedKids[]` |
| `manifest.signature.issuer-mismatch` | error | error | 25 | `signature.iss` ≠ `keySet.issuer` / `manifest.baseUrl` origin / `expectedIssuer` |
| `manifest.signature.before-signed-at` | error | error | 20 | `now` < `signedAt − skew` |
| `manifest.signature.expired` | error | error | 20 | `now` > `expiresAt + skew` |
| `manifest.signature.canonicalization-failed` | error | error | 25 | Manifest contains values that cannot be canonicalized (circular references, etc.) |
| `manifest.signature.invalid` | error | error | 25 | Signature did not verify against the supplied public key |
| `manifest.signature.key-type-mismatch` | error | error | 20 | Key entry alg ≠ signature alg, or JWK kty/crv mismatch alg |

### Out of scope for this release

- **No remote key fetch.** The scanner does not fetch
  `/.well-known/agentbridge-keys.json` — your code does that and
  passes the result in via `signature.keySet`. A runtime helper for
  remote fetch lands in a later v0.5.0 PR.
- **No MCP server / CLI enforcement.** This package only emits
  scanner check IDs. The MCP server's `--require-signature` mode
  and the CLI's verify / require-signature commands ship in
  subsequent v0.5.0 PRs.
- **Verification is additive.** Even when a manifest verifies, the
  existing safety controls — confirmation gate, origin pinning,
  target-origin allowlist, audit redaction, stdio stdout hygiene,
  HTTP transport auth/origin checks — all continue to enforce on
  top.

> ⚠️ **Private keys never belong inside a manifest or a key set.**
> The scanner's key-set input is the **public** half only;
> `AgentBridgeKeySetSchema` rejects JWKs that include the private
> scalar `d`.

## Scanner regression fixtures

The repo includes scanner fixtures in
[`examples/scanner-regression`](https://github.com/marmar9615-cloud/agentbridge-protocol/tree/main/examples/scanner-regression)
that pin public scanner behavior:

- `manifest.good.json` demonstrates a high-readiness manifest with
  contact, auth, resources, schemas, examples, summary templates,
  permissions, and confirmation on risky actions.
- `manifest.minimal-valid.json` is valid but intentionally low
  readiness, so the scanner recommends contact, auth, resources,
  output schema, examples, and summary templates.
- `manifest.missing-confirmation.json` keeps schema validation green
  while triggering the risky-action confirmation check.
- `manifest.origin-mismatch.json` shows the `baseUrl` / scanned-origin
  warning used to protect origin-pinned action calls.
- `manifest.invalid.json` verifies invalid manifests fail safely with
  validation errors.

Run the fixture coverage from the repo root:

```bash
npx vitest run packages/scanner/src/tests
```

After building the CLI, validate the fixture manifests with:

```bash
node packages/cli/dist/bin.js validate examples/scanner-regression/manifest.good.json
node packages/cli/dist/bin.js validate examples/scanner-regression/manifest.minimal-valid.json
```

## Status

Public release. v0.2.2 is a docs-only release that adds OpenAI Codex
onboarding alongside the existing Claude Desktop / Cursor / custom
client setup paths — no code or behavior changes since v0.2.0.
AgentBridge is suitable for local development, manifest authoring,
scanner workflows, OpenAPI import, and MCP experiments. It is not yet
production security infrastructure.

The structured [`checks[]`](https://github.com/marmar9615-cloud/agentbridge-protocol/blob/main/CHANGELOG.md)
shape is stable for the v0.x line. Check coverage will grow over time
and severity deductions may be retuned.

## License

Apache-2.0
