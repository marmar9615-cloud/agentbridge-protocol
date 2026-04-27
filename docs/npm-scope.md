# npm scope choice

## Why `@marmar9615-cloud/agentbridge-*`?

The publishable AgentBridge packages live under the
`@marmar9615-cloud` npm scope:

| Package | npm name |
|---|---|
| Core types/schemas | `@marmar9615-cloud/agentbridge-core` |
| SDK | `@marmar9615-cloud/agentbridge-sdk` |
| Scanner | `@marmar9615-cloud/agentbridge-scanner` |
| OpenAPI converter | `@marmar9615-cloud/agentbridge-openapi` |
| CLI | `@marmar9615-cloud/agentbridge-cli` |
| MCP server | `@marmar9615-cloud/agentbridge-mcp-server` |

We did **not** use `@agentbridge/*` because:

1. **Ownership.** The `@agentbridge` scope on npm is unowned by this
   project. Publishing to a scope you do not control is an obvious
   trust failure: anyone could later claim it, and consumers would have
   no way to verify origin.
2. **No verification path.** Even if `@agentbridge` were available
   today, there is no easy way to lock it to a specific publisher
   (no DNS verification, no GitHub-org binding) before maintenance
   passes between people.
3. **Predictability.** A scope tied to the project's GitHub identity
   (`marmar9615-cloud`) makes the trust chain explicit:
   github.com/marmar9615-cloud/agentbridge-protocol ↔
   npmjs.com/package/@marmar9615-cloud/agentbridge-*.

## Apps stay private

`apps/demo-app` and `apps/studio` are not on npm and never will be —
they're internal demos for this monorepo. They use unscoped names
(`agentbridge-demo-app`, `agentbridge-studio`) and `private: true` to
make accidental publish impossible.

The workspace root keeps `name: "agentbridge"`. Several internal helpers
(`findRepoRoot` in core, the spec-rendering routes in studio) walk up
looking for that exact name.

## Fallback if `@marmar9615-cloud` is invalid

If the npm scope ends up unusable for any reason (npm rejects the
account, the org gets renamed, etc.), the fallback is unscoped names
prefixed with `agentbridge-protocol-`:

```
agentbridge-protocol-core
agentbridge-protocol-sdk
agentbridge-protocol-scanner
agentbridge-protocol-openapi
agentbridge-protocol-cli
agentbridge-protocol-mcp-server
```

Switching to fallback names is mechanical: rename in package.json,
update imports + vitest aliases + Next `transpilePackages` arrays,
update docs.

## Verifying availability before publish

Before running `npm publish` for the first time, confirm each name is
free or already owned by you:

```bash
for pkg in core sdk scanner openapi cli mcp-server; do
  echo "@marmar9615-cloud/agentbridge-$pkg:"
  npm view "@marmar9615-cloud/agentbridge-$pkg" name 2>&1 | head -1
done
```

A reply of `404 Not Found` means the name is free. A reply with a
package name back means someone owns it (you, or someone else — check
`npm view <pkg> maintainers`).

## Migrating to a different scope later

If the project gets adopted into an organization with its own npm scope,
migrate by:

1. Reserving the new scope on npm.
2. Renaming all packages on a single PR (mechanical find-and-replace
   like Phase 3A did to switch off `@agentbridge`).
3. Publishing the new names; deprecating old names with `npm deprecate`
   pointing at the new package.

## Status

**No package has been published to npm yet.** This document describes
the *plan*. Phase 3A only validates that publishing would work via
`npm pack --dry-run` and `npm run smoke:external`.

See [docs/release-checklist.md](release-checklist.md) and
[docs/npm-publishing.md](npm-publishing.md) for the actual publish
sequence (to run later, manually, with explicit approval).
