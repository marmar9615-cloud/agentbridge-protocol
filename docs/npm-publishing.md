# npm publishing

How to publish the six AgentBridge packages once
[docs/release-checklist.md](release-checklist.md) is fully green.

> **The preferred path is npm Trusted Publishing**, executed via
> the [`release-publish.yml`](../.github/workflows/release-publish.yml)
> workflow. See [docs/trusted-publishing.md](trusted-publishing.md)
> for setup. The manual flow below is the fallback that v0.2.0,
> v0.2.1, and v0.2.2 used; expect to use it less and less as v1.0
> approaches.

**Do not run any of these commands until the release checklist is
checked off and you intend to ship.** v0.2.0 was the first public
release on npm under the `@marmarlabs` scope; v0.2.1 was the
README-cleanup patch and v0.2.2 added Codex onboarding. The
instructions below are the manual fallback flow for any future bump.

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
npm login --scope=@marmarlabs
```

Verify:

```bash
npm whoami        # should print your npm username
npm config get @marmarlabs:registry  # should be https://registry.npmjs.org
```

For non-interactive 2FA-bypass publishes (CI, scripted releases), use a
granular access token with `bypass 2FA` enabled, write it to a file like
`/tmp/agentbridge-npmrc` (do not commit), and pass `--userconfig` on
each publish command. Delete the file after the publish completes.

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
- **If the failure is auth:** re-run `npm login --scope=@marmarlabs`.

`npm unpublish` only works within 72 hours of publish and only for
packages with no public dependents. Plan to bump-and-fix instead of
unpublishing.

## Tag and create the GitHub release

After all six packages are published successfully (substitute your own
version — example uses `v0.2.1`):

```bash
git tag v0.2.1
git push origin v0.2.1

gh release create v0.2.1 \
    --title "v0.2.1 — README Cleanup Patch" \
    --notes-file docs/releases/v0.2.1.md
```

Add `--prerelease` only when shipping a beta/RC tag (e.g.
`v0.3.0-beta`); stable patches and minors should not be marked
prerelease.

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
