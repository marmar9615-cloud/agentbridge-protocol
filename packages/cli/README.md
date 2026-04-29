# @marmarlabs/agentbridge-cli

Command-line interface for [AgentBridge](https://github.com/marmar9615-cloud/agentbridge-protocol).
Scan, validate, scaffold, and generate manifests from your terminal.

## Install

```bash
npm install -g @marmarlabs/agentbridge-cli
# or invoke directly:
npx @marmarlabs/agentbridge-cli scan http://localhost:3000
```

## Commands

### `agentbridge scan <url>`

Score a URL's AgentBridge readiness. Prints a 0–100 score and grouped
recommendations.

```bash
agentbridge scan http://localhost:3000
agentbridge scan https://api.example.com --json
```

### `agentbridge validate <file-or-url>`

Validate a manifest from disk or URL.

```bash
agentbridge validate ./public/.well-known/agentbridge.json
agentbridge validate http://localhost:3000
```

**Optional signed-manifest checks (v0.5.0).** Pass a publisher key
set with `--keys` to also verify the manifest's signature, or
require a signature without verifying with `--require-signature`.
Default behavior — neither flag — is unchanged from v0.4.x.

```bash
# Verify a signed manifest against a key set you already loaded.
agentbridge validate ./manifest.json --keys ./agentbridge-keys.json

# Reject unsigned manifests (exit 1 if no signature).
agentbridge validate ./manifest.json --require-signature

# Combine: schema-valid AND signature verifies.
agentbridge validate ./manifest.json --require-signature --keys ./agentbridge-keys.json

# Optional knobs forwarded to the verifier:
#   --expected-issuer <origin>
#   --now <iso-datetime>
#   --clock-skew-seconds <seconds>
```

The CLI does not fetch `/.well-known/agentbridge-keys.json` for
you. Pass the key set as a local file. Runtime fetch lands in the
MCP server PR.

### `agentbridge verify <file-or-url> --keys <path>`

Dedicated signature-verification command. Always runs the verifier
(unlike `validate`, which makes verification opt-in). Returns a
structured outcome with stable failure-reason codes from
`@marmarlabs/agentbridge-core`.

```bash
agentbridge verify ./manifest.json --keys ./agentbridge-keys.json
agentbridge verify https://orders.acme.example/.well-known/agentbridge.json \
  --keys ./acme-keys.json --expected-issuer https://orders.acme.example

# Machine-readable output for CI.
agentbridge verify ./manifest.json --keys ./keys.json --json
# {
#   "ok": true,
#   "kid": "acme-orders-2026-04",
#   "iss": "https://orders.acme.example",
#   "alg": "EdDSA",
#   "signedAt": "2026-04-28T12:00:00.000Z",
#   "expiresAt": "2026-04-29T12:00:00.000Z"
# }
```

Failure outcomes carry a stable `reason` from the core verifier
(`signature-invalid`, `expired`, `unknown-kid`, `revoked-kid`,
`issuer-mismatch`, …). See
[`packages/core/README.md`](https://github.com/marmar9615-cloud/agentbridge-protocol/blob/main/packages/core/README.md)
for the full enum.

### `agentbridge keys generate` (local dev only)

Generate an Ed25519 (or ES256) signing keypair, write the public
half to a complete `agentbridge-keys.json` document and the private
half to a separate file with mode `0o600`. Useful for bootstrapping
the first key set in a development project.

```bash
agentbridge keys generate \
  --kid acme-2026-04 \
  --issuer https://acme.example \
  --out-public ./agentbridge-keys.json \
  --out-private ./acme.signing-key.json
```

> ⚠️ **Local-dev only.** The private key file is sensitive
> material. Do **not** commit it. Production signing keys belong
> in a KMS / HSM, never on a developer's filesystem. The CLI
> writes the private key with mode `0o600` (owner-only) on POSIX,
> never echoes the private `d` parameter to stdout/stderr, and
> requires explicit `--out-private` so it cannot silently discard
> freshly-generated material.

### `agentbridge init`

Scaffold an `agentbridge.config.ts` and starter manifest in the current
directory.

```bash
agentbridge init               # TypeScript config
agentbridge init --format json # JSON manifest only
```

### `agentbridge generate openapi <src>`

Convert an OpenAPI 3.x document into an AgentBridge manifest.

```bash
agentbridge generate openapi ./store.openapi.json --out ./agentbridge.json
agentbridge generate openapi https://api.example.com/openapi.json --base-url https://api.example.com
```

### `agentbridge mcp-config`

Print copy-pasteable MCP client config snippets for OpenAI Codex (CLI
one-liner and `config.toml`), Claude Desktop, Cursor, and any other
MCP-compatible client.

```bash
# OpenAI Codex one-liner (also printed by mcp-config)
codex mcp add agentbridge -- npx -y @marmarlabs/agentbridge-mcp-server
```

Full Codex walkthrough:
[docs/codex-setup.md](https://github.com/marmar9615-cloud/agentbridge-protocol/blob/main/docs/codex-setup.md).
For everything else (Claude Desktop, Cursor, custom):
[docs/mcp-client-setup.md](https://github.com/marmar9615-cloud/agentbridge-protocol/blob/main/docs/mcp-client-setup.md).

### `agentbridge version`

Print the CLI version.

## Regression-tested examples

CLI regression coverage exercises the repo examples that adopters are
most likely to copy:

- `examples/adopter-quickstart/manifest.basic.json`
- `examples/adopter-quickstart/manifest.production-shaped.json`
- `examples/scanner-regression/*.json` (valid fixtures pass; the
  intentionally invalid fixture fails safely)
- `examples/openapi-store/store.openapi.json`
- `examples/openapi-regression/catalog-regression.openapi.json`
- `examples/sdk-basic/manifest.ts` generated to JSON and validated
- `examples/signed-manifest-basic/manifest.ts` generated to signed
  JSON, schema-validated, and verified with its example public key set
- `agentbridge mcp-config`, including stdio, Codex, Claude Desktop,
  Cursor / generic JSON, and the v0.4.0 HTTP transport block

The signed-manifest example is verified end-to-end by the example
regression suite. As of v0.5.0 the CLI also exposes
`agentbridge validate --require-signature [--keys …]` and
`agentbridge verify` directly, so adopters can wire signature
verification into their own scripts without re-implementing the
verifier.

After building the workspace, run the same example validation pass
manually with:

```bash
npm run validate:examples
npm run validate:mcp-config-examples
```

## Exit codes

- `0` — success
- `1` — validation failure or runtime error
- `2` — invalid arguments

## Status

Public release. v0.2.2 is a docs-and-CLI-output release that adds
OpenAI Codex onboarding to the `mcp-config` command and to the docs —
no other code or behavior changes. AgentBridge is suitable for local
development, manifest authoring, scanner workflows, OpenAPI import,
and MCP experiments. It is not yet production security
infrastructure.

The CLI command surface is stable for the v0.x line.

## License

Apache-2.0
