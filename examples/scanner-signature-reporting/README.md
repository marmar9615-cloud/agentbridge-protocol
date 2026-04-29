# Scanner signature reporting example

This example shows how scanner signed-manifest reporting looks after
the v0.5.0 check IDs landed. It uses the deterministic signed manifest
from [`../signed-manifest-basic`](../signed-manifest-basic) and its
public key set, then prints the signature-related scanner check IDs
for common operator scenarios.

It demonstrates scanner reporting only:

- no CLI `--require-signature` enforcement
- no MCP runtime enforcement
- no remote key-set fetch
- no authorization shortcut for verified manifests

Verification is additive. A verified signature helps operators detect
publisher identity and tampering, but actions still need the normal
AgentBridge safety controls: confirmation gates, origin pinning,
target-origin allowlists, audit redaction, and transport auth.

## Run

From the repo root:

```bash
npm run build
npx tsx examples/scanner-signature-reporting/reporting.ts
```

The script emits a compact JSON report. It does not print the full
manifest, signature bytes, key set, or private key material.

## Scenarios

| Scenario | Expected signature check IDs | What it demonstrates |
|---|---|---|
| `unsigned-default` | none | Default scanner behavior preserves v0.4.x output when `signature` options are omitted. |
| `unsigned-require-signature` | `manifest.signature.missing` | Operators can opt into require-signature reporting for unsigned manifests. |
| `signed-valid-key-set` | `manifest.signature.verified` | A signed manifest verifies with the matching public key set. |
| `signed-tampered-key-set` | `manifest.signature.invalid` | A manifest changed after signing fails verification. |
| `signed-expired-key-set` | `manifest.signature.expired` | Freshness checks surface signatures used after `expiresAt`. |

## CI usage

Operators can treat scanner check IDs as stable CI policy inputs. For
example, a staging pipeline might fail if
`manifest.signature.invalid`, `manifest.signature.expired`, or
`manifest.signature.missing` appears when the environment requires
signed manifests.

The scanner still reports readiness; it does not enforce runtime
behavior. CLI signature commands and MCP enforcement are v0.5.0
follow-ups.

## Key handling

The example uses
[`../signed-manifest-basic/agentbridge-keys.json`](../signed-manifest-basic/agentbridge-keys.json),
which contains only a public JWK. Private keys never belong in
`/.well-known/agentbridge.json`, public key sets, scanner reports, or
CI logs.
