# Release checklist

Run through this before tagging or publishing any AgentBridge release.
Nothing in here actually publishes — it's the gate.

## Pre-flight

- [ ] All in-flight PRs that should be in this release are merged to `main`.
- [ ] `CHANGELOG.md` has a section for the new version with all
      user-visible changes listed.
- [ ] Version numbers in every publishable `package.json` are
      consistent (all six should match the new version):
      `packages/{core,sdk,scanner,openapi,cli}` and `apps/mcp-server`.
- [ ] Workspace dependency ranges in those `package.json` files match
      (e.g., `"@marmarlabs/agentbridge-core": "^0.2.0"`).
- [ ] Apps `apps/{demo-app,studio}` are still `private: true` and don't
      have any `npm publish`-able shape.
- [ ] Root `package.json` is still `private: true`.
- [ ] [docs/releases/v\<VERSION\>.md](releases/) draft exists with
      install instructions, what's new, known limitations.

## Validation (run in order)

```bash
rm -rf node_modules && npm ci
npm run typecheck            # all 6 packages clean
npm test                     # all suites passing
npm run build                # tsup → dist/ for 6 publishable packages
npm run pack:dry-run         # tarball contents OK
npm run smoke:external       # full external-clone simulation passes
```

Manual checks:

- [ ] `node packages/cli/dist/bin.js version` prints the new version.
- [ ] `node packages/cli/dist/bin.js validate spec/examples/ecommerce-manifest.json`
      returns OK.
- [ ] `node packages/cli/dist/bin.js generate openapi examples/openapi-store/store.openapi.json --out /tmp/abg.json`
      writes a manifest.
- [ ] `node apps/mcp-server/dist/index.js < /dev/null` boots cleanly.
- [ ] `(cd apps/demo-app && npx next build)` succeeds.
- [ ] `(cd apps/studio && npx next build)` succeeds.
- [ ] Manually start `npm run dev:mcp` and call a high-risk action
      without `confirmationApproved` — confirm it returns
      `confirmationRequired` with a token.

## CI

- [ ] `.github/workflows/ci.yml` is green on the release branch / main.
- [ ] `.github/workflows/release-check.yml` was triggered manually
      (`workflow_dispatch`) and is green on Node 20.x and 22.x.

## Documentation

- [ ] `README.md` test count, install commands, and badges are accurate
      for the new version.
- [ ] [`docs/public-beta.md`](public-beta.md) (or successor) reflects
      the current "what is / isn't shipped" state.
- [ ] [`docs/roadmap.md`](roadmap.md) phases are up to date.
- [ ] Per-package READMEs (in each `packages/*/README.md` and
      `apps/mcp-server/README.md`) reference the right install command.

## Publish

Once everything above is checked, two paths exist depending on
whether npm Trusted Publishing is configured for all six packages
(see [docs/trusted-publishing.md](trusted-publishing.md)):

- **Preferred (v1.0 path):** trigger `release-publish.yml` from
  the GitHub Actions UI. Run it once with `dry_run=true` to verify
  the plan, then re-run with `dry_run=false`. No NPM_TOKEN
  required.
- **Manual fallback:** follow [docs/npm-publishing.md](npm-publishing.md)
  for the manual `npm publish` commands. Use only when the
  workflow is unavailable. Document the reason in the release
  notes.

After publishing, the GitHub release commands are at the bottom of
[npm-publishing.md](npm-publishing.md).
