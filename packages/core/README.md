# @marmarlabs/agentbridge-core

Core types, schemas, validation, and audit utilities for [AgentBridge](https://github.com/marmar9615-cloud/agentbridge-protocol)
— an AI-native action layer for web apps.

This package is the contract: every other AgentBridge package depends on
the types and validators it exports.

## Install

```bash
npm install @marmarlabs/agentbridge-core
```

## What's inside

- `AgentBridgeManifest`, `AgentAction`, `ActionExample`, `PermissionPolicy`
  — the canonical TypeScript types for an AgentBridge manifest.
- `validateManifest(json)` — runtime validation. Returns
  `{ ok: true, manifest } | { ok: false, errors }`.
- `summarizeAction(action, input)` — render the action's
  `humanReadableSummaryTemplate` for confirmation prompts.
- `isRiskyAction(action)` — classifies medium/high actions as risky.
- `appendAuditEvent`, `readAuditEvents`, `createAuditEvent`,
  `getAuditFilePath` — local JSON audit log helpers with built-in
  redaction for sensitive keys.
- `redact(value)` — recursively redact sensitive fields (tokens,
  passwords, etc.) before logging.
- All Zod schemas (`actionSchema`, `manifestSchema`, …) for callers that
  want to validate at the schema level.

## Quick example

```ts
import { validateManifest } from "@marmarlabs/agentbridge-core";

const result = validateManifest(rawJson);
if (!result.ok) {
  for (const err of result.errors) console.error(err.path, err.message);
  process.exit(1);
}
console.log(`${result.manifest.name} v${result.manifest.version}`);
```

## Status

Public release. v0.2.2 is a docs-only release that adds OpenAI Codex
onboarding alongside the existing Claude Desktop / Cursor / custom
client setup paths — no code or behavior changes since v0.2.0.
AgentBridge is suitable for local development, manifest authoring,
scanner workflows, OpenAPI import, and MCP experiments. It is not yet
production security infrastructure.

The manifest schema is stable for the v0.x line; field additions are
non-breaking, field removals or shape changes will bump to v1.0. See
the [project roadmap](https://github.com/marmar9615-cloud/agentbridge-protocol/blob/main/docs/roadmap.md)
for what's planned beyond v0.2.x.

## License

Apache-2.0
