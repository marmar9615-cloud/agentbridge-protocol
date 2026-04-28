# SDK basic example

This is a lightweight TypeScript example for the public
`@marmarlabs/agentbridge-sdk` API. It is not a full web app; it shows
the small module most adopters put next to their server routes.

[`manifest.ts`](./manifest.ts) demonstrates:

- `defineAgentAction`
- `createAgentBridgeManifest`
- `validateActionInput`
- `validateManifest` from `@marmarlabs/agentbridge-core`
- low, medium, and high risk actions
- confirmation policies for medium/high-risk actions
- `humanReadableSummaryTemplate`
- safe simulated high-risk behavior

Generate and validate the example manifest from the repo root:

```bash
npx tsx examples/sdk-basic/manifest.ts > /tmp/sdk-basic.agentbridge.json
node packages/cli/dist/bin.js validate /tmp/sdk-basic.agentbridge.json
```

The high-risk action is intentionally named
`simulate_ticket_escalation` and returns simulated output. It does not
page anyone, send email, call external systems, or change real data.
