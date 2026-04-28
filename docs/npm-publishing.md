# npm publishing

How to publish the six AgentBridge packages once
[docs/release-checklist.md](release-checklist.md) is fully green.

**Do not run any of these commands until the release checklist is
checked off and you intend to ship.** The repo as of v0.2.0-beta has
NOT published anything to npm yet.

## Order matters

Workspace dependencies use `^0.2.0` (not `*`). For the very first
publish at a new version, you must publish in dependency order so that
each consumer can resolve its newly-published dependency:

```
core
├── sdk      (depends on core)
├── scanner  (depends on core)
└── openapi  (depends on core)
        ├── cli         (depends on core, scanner, openapi)
        └── mcp-server  (depends on core, scanner)
```

Publish:

1. `core`
2. `sdk`, `scanner`, `openapi` (any order — they only depend on core)
3. `cli`, `mcp-server` (any order — they depend on the layer 2 packages)

## Authenticate

```bash
npm login --scope=@marmar9615-cloud
```

Verify:

```bash
npm whoami        # should print your npm username
npm config get @marmar9615-cloud:registry  # should be https://registry.npmjs.org
```

## Build and validate

```bash
rm -rf node_modules && npm ci
npm run build
npm run pack:dry-run
```

The pack-check output tells you exactly what each tarball will contain.
Eyeball every line.

## Publish each package

```bash
# 1. Layer 1
(cd packages/core && npm publish --access public)

# 2. Layer 2 (parallel-safe but order doesn't matter)
(cd packages/sdk && npm publish --access public)
(cd packages/scanner && npm publish --access public)
(cd packages/openapi && npm publish --access public)

# 3. Layer 3
(cd packages/cli && npm publish --access public)
(cd apps/mcp-server && npm publish --access public)
```

`--access public` is required for scoped packages on a free npm account.

After each publish, confirm:

```bash
npm view @marmarlabs/agentbridge-core version
# should print the version you just published
```

## If a publish fails partway through

You will end up with some packages on the new version and others on the
old. To recover:

- **If the failure is in a layer-2 or layer-3 package:** the layer-1
  package is already on the new version. Fix the issue, then re-run
  `npm publish` on each remaining package. npm will refuse to
  re-publish the same version, so you may need to bump the patch
  (`0.2.0 → 0.2.1`) on the unpublished packages, update workspace
  dependency ranges, and republish.
- **If the failure is `EPUBLISHCONFLICT`:** that exact `name@version`
  was already published (probably by an earlier attempt). Either bump
  the version or skip that package.
- **If the failure is auth:** re-run `npm login --scope=@marmar9615-cloud`.

`npm unpublish` only works within 72 hours of publish and only for
packages with no public dependents. Plan to bump-and-fix instead of
unpublishing.

## Tag and create the GitHub release

After all six packages are published successfully:

```bash
git tag v0.2.0-beta
git push origin v0.2.0-beta

gh release create v0.2.0-beta \
    --title "v0.2.0-beta — Public Beta" \
    --notes-file docs/releases/v0.2.0-beta.md \
    --prerelease
```

`--prerelease` keeps the release out of "latest" until we're ready to
graduate to a non-beta version.

## Post-publish verification

```bash
# Install in a throwaway dir to confirm the published packages resolve
mkdir /tmp/abg-postpublish && cd /tmp/abg-postpublish
npm init -y
npm install @marmarlabs/agentbridge-cli
npx @marmarlabs/agentbridge-cli version  # should print the version
```

If that succeeds, announce the release on whatever channels are
appropriate (issue tracker, mailing list, etc).

## Do NOT run automatically

These commands change shared state (npm public registry, GitHub
releases). They should run from a developer's local machine after
explicit confirmation. CI must NEVER `npm publish` from this repo
without an explicit gate.
