# Quickstart

Get from a fresh clone to a working AgentBridge in five minutes.

## 1. Clone and install

```bash
git clone https://github.com/marmar9615-cloud/agentbridge-protocol.git
cd agentbridge-protocol
npm install
```

Requires Node 20+. The first install pulls Next.js, the MCP SDK, Zod, and a
couple of small dependencies (~20 seconds on a cached network).

## 2. Run the test suite

```bash
npm test
```

You should see all suites green (~80 tests).

## 3. Boot the local stack

```bash
npm run dev
```

That starts:
- **Demo app** on http://localhost:3000 — a fake order manager with 5
  AgentBridge actions.
- **Studio** on http://localhost:3001 — the developer dashboard.

In a separate terminal, you can also run the MCP server directly:

```bash
npm run dev:mcp
```

It speaks stdio. Hook it up to Claude Desktop or any MCP client (see
[mcp-client-setup.md](./mcp-client-setup.md)).

## 4. Try the CLI

```bash
npm run dev:cli -- scan http://localhost:3000
```

You'll get a readiness report with a 0–100 score and grouped recommendations.

```bash
npm run dev:cli -- validate spec/examples/ecommerce-manifest.json
npm run dev:cli -- generate openapi packages/openapi/fixtures/simple-store.openapi.json
```

After the second command, look at `agentbridge.generated.json` — the
generated draft manifest from the OpenAPI document.

## 5. Try Studio

Open http://localhost:3001:

1. Click **Scan**. Default URL is the local demo app.
2. Open **Actions**. Filter to `medium` risk.
3. Click `add_internal_note`. Fill in `orderId: ORD-1001` and a note.
4. Click **Review & confirm**. Type `CONFIRM`. The action runs.
5. Check **Audit log**. Your action appears with `source: studio`.

## 6. Try the MCP confirmation flow

Either through your hooked-up MCP client, or directly via stdio:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"call_action","arguments":{"url":"http://localhost:3000","actionName":"execute_refund_order","input":{"draftId":"x","confirmationText":"CONFIRM"}}}}' \
  | npm run dev:mcp 2>/dev/null
```

You'll get back `{ "status": "confirmationRequired", "confirmationToken": "...", ... }`. Re-call
with `confirmationApproved: true` AND that token to actually execute.

## What's next

- Read the [manifest spec](../spec/agentbridge-manifest.v0.1.md) to
  understand the contract.
- Walk the [Next.js basic example](../examples/nextjs-basic) to add
  AgentBridge to your own app.
- Use the [OpenAPI import guide](./openapi-import.md) if you have an
  existing API.
- Connect to your favourite MCP client via [mcp-client-setup.md](./mcp-client-setup.md).
