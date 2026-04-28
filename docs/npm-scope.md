# npm scope choice

## Why `@marmarlabs/agentbridge-*`?

The publishable AgentBridge packages live under the **`@marmarlabs`**
npm scope:

| Package | npm name |
|---|---|
| Core types/schemas | `@marmarlabs/agentbridge-core` |
| SDK | `@marmarlabs/agentbridge-sdk` |
| Scanner | `@marmarlabs/agentbridge-scanner` |
| OpenAPI converter | `@marmarlabs/agentbridge-openapi` |
| CLI | `@marmarlabs/agentbridge-cli` |
| MCP server | `@marmarlabs/agentbridge-mcp-server` |

`@marmarlabs` is the publisher's owned npm scope (org), tied to the
`marmarlabs` npm account that publishes these packages. The trust
chain is therefore explicit: anyone consuming
`@marmarlabs/agentbridge-*` can verify the publisher on
[npmjs.com/~marmarlabs](https://www.npmjs.com/~marmarlabs).

## Why not `@agentbridge/*`?

The `@agentbridge` scope on npm is unowned by this project. Publishing
to a scope you do not control is an obvious trust failure: anyone
could later claim it, and consumers would have no way to verify origin.

## Why not `@marmar9615-cloud/*`?

The Phase 3A pre-release scaffolded the packages under
`@marmar9615-cloud/agentbridge-*` to match the GitHub username
(`marmar9615-cloud`). When it came time to publish, no
`marmar9615-cloud` org existed on npm — npm and GitHub are separate
registries, and the GitHub-username-based scope was never created.
Rather than spin up a second npm org just to mirror the GitHub
username, v0.2.0 ships under the actual owned scope `@marmarlabs`.

The repo on GitHub remains **`marmar9615-cloud/agentbridge-protocol`**.
There is no requirement for the GitHub repo path and the npm scope to
match.

## Apps stay private

`apps/demo-app` and `apps/studio` are not on npm and never will be —
they're internal demos for this monorepo. They use unscoped names
(`agentbridge-demo-app`, `agentbridge-studio`) and `private: true` to
make accidental publish impossible.

The workspace root keeps `name: "agentbridge"`. Several internal helpers
(`findRepoRoot` in core, the spec-rendering routes in studio) walk up
looking for that exact name.

## Verifying availability

Before bumping a version and publishing, sanity-check that the
versions you're about to publish don't already exist:

```bash
for pkg in core sdk scanner openapi cli mcp-server; do
  echo "@marmarlabs/agentbridge-$pkg:"
  npm view "@marmarlabs/agentbridge-$pkg" version 2>&1 | head -1
done
```

If a name returns the version you're about to publish, bump first —
npm refuses re-publish of an existing `name@version`.

## Migrating to a different scope later

If the project gets adopted into a different organization with its own
npm scope, migrate by:

1. Reserving the new scope on npm.
2. Renaming all packages on a single PR (mechanical find-and-replace
   like the `@agentbridge` → `@marmar9615-cloud` → `@marmarlabs` moves
   that already happened).
3. Publishing the new names; deprecating old names with `npm deprecate`
   pointing at the new package.
