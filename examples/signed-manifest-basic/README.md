# Signed manifest basic example

This lightweight TypeScript example shows how an app publisher can add
an AgentBridge `signature` block to a manifest with
`@marmarlabs/agentbridge-sdk`.

It demonstrates:

- `defineAgentAction`
- `createAgentBridgeManifest`
- `signManifest`
- deterministic `signedAt` / `expiresAt` values for regression tests
- the default `EdDSA` / Ed25519 signing path
- schema validation with `agentbridge validate`
- local verification with `verifyManifestSignature` and a public key set

`ES256` is also supported by the SDK for P-256 keys, but EdDSA is the
smallest useful default for this basic example.

## Run

From the repo root:

```bash
npm run build
npx tsx examples/signed-manifest-basic/manifest.ts > /tmp/signed-basic.agentbridge.json
node packages/cli/dist/bin.js validate /tmp/signed-basic.agentbridge.json
npm run validate:examples
```

The output is a normal AgentBridge manifest with an inline
`signature` block:

```json
{
  "signature": {
    "alg": "EdDSA",
    "kid": "test-ed25519-2026-04",
    "iss": "https://projects.example.com",
    "signedAt": "2026-04-28T12:00:00.000Z",
    "expiresAt": "2026-04-29T12:00:00.000Z",
    "value": "..."
  }
}
```

## Current validation behavior

`agentbridge validate` checks the manifest and signature schema today:
required signature fields, supported algorithm names, canonical
issuer origin, ISO timestamps, and base64url signature bytes.

`npm run validate:examples` goes one step further for this example: it
loads [`agentbridge-keys.json`](./agentbridge-keys.json), calls
`verifyManifestSignature()` from `@marmarlabs/agentbridge-core`, and
asserts that the signed manifest verifies while a tampered copy fails
with `signature-invalid`.

CLI `--require-signature`, scanner signature scoring, and MCP runtime
enforcement are still follow-up work. Until those land, CLI
validation remains schema-only and unsigned manifests remain valid.

## Key handling

`manifest.ts` embeds a clearly marked test-only Ed25519 private key so
the example output is deterministic. That is not a production pattern.
`agentbridge-keys.json` contains only the matching public JWK:

```json
{
  "kid": "test-ed25519-2026-04",
  "alg": "EdDSA",
  "publicKey": {
    "kty": "OKP",
    "crv": "Ed25519",
    "x": "4F0ROqXtFRtcx7XODDt-sWq87Essl6qUMLwlupVSvWw"
  }
}
```

Production private keys should live in KMS, HSM, or a secret manager
and be loaded by your build/deploy pipeline. Private keys never belong
inside `/.well-known/agentbridge.json`; published manifests should
only contain the public key id (`kid`) and signature bytes.
