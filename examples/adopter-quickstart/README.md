# Adopter quickstart examples

This directory contains copy-pasteable manifest examples for developers
adding AgentBridge to an existing app.

| File | What it shows |
|---|---|
| [`manifest.basic.json`](./manifest.basic.json) | Minimal order-management manifest with `list_orders`, `get_order`, and `draft_refund_order`. |
| [`manifest.production-shaped.json`](./manifest.production-shaped.json) | More complete manifest with contact/auth metadata, resources, permissions, examples, summaries, and confirmation policies. |

Both manifests are safe documentation fixtures. They do not call real
services and do not perform real refunds. The production-shaped example
uses `https://app.example.com` as a placeholder origin; replace it with
your app's real origin before serving it.

## Validate the manifests

From the repo root after installing dependencies:

```bash
npm run build
node packages/cli/dist/bin.js validate examples/adopter-quickstart/manifest.basic.json
node packages/cli/dist/bin.js validate examples/adopter-quickstart/manifest.production-shaped.json
```

Or use the published CLI directly:

```bash
npx @marmarlabs/agentbridge-cli validate examples/adopter-quickstart/manifest.basic.json
npx @marmarlabs/agentbridge-cli validate examples/adopter-quickstart/manifest.production-shaped.json
```

## Try one in your own app

Copy one manifest to your app's public well-known path:

```bash
mkdir -p public/.well-known
cp examples/adopter-quickstart/manifest.basic.json \
  public/.well-known/agentbridge.json
```

Then update:

- `baseUrl` to your local app origin, such as `http://localhost:3000`.
- `endpoint` paths to match your real action endpoints.
- `auth`, `contact`, `permissions`, examples, and output schemas to
  match your app.

Start your app and scan it:

```bash
npx @marmarlabs/agentbridge-cli scan http://localhost:3000
```

If your app generates the manifest dynamically, compare the generated
JSON to these examples instead of copying the file directly.

## Pair with the demo app

The repo demo already exposes a live order-management manifest:

```bash
npm install
npm run dev
curl -s http://localhost:3000/.well-known/agentbridge.json
npx @marmarlabs/agentbridge-cli scan http://localhost:3000
```

Use the demo when you want runnable endpoints. Use the manifests in
this directory when you want static patterns to adapt to another app.

## Pair with an MCP client

The shipped MCP server speaks stdio:

```bash
npx -y @marmarlabs/agentbridge-mcp-server
```

For a local app on `localhost`, no remote allowlist is needed. For a
remote or production-like target, pin the target origin:

```bash
AGENTBRIDGE_ALLOWED_TARGET_ORIGINS=https://app.example.com \
  npx -y @marmarlabs/agentbridge-mcp-server
```

Then connect the same command to OpenAI Codex, Claude Desktop, Cursor,
or another stdio-capable MCP client. See
[`docs/mcp-client-setup.md`](../../docs/mcp-client-setup.md) and
[`docs/codex-setup.md`](../../docs/codex-setup.md).

## Safety notes

- Low-risk read actions may run directly.
- `draft_refund_order` is medium risk and requires confirmation.
- `execute_refund_order` in the production-shaped fixture is high risk,
  requires confirmation, and is explicitly simulated.
- Do not expose secrets in action output.
- Do not put tokens in query strings.
- Keep every action endpoint same-origin with the manifest `baseUrl`.
- Current npm packages ship stdio MCP. HTTP MCP transport is the
  v0.4.0 track and is not implemented in the current package.

For a complete walkthrough, see
[`docs/adopter-quickstart.md`](../../docs/adopter-quickstart.md). For
more reusable action designs, see
[`docs/manifest-patterns.md`](../../docs/manifest-patterns.md).
