# External-adopter smoke test

`scripts/external-adopter-smoke.mjs` is the closest thing this repo has
to "an outside developer just cloned us and pressed go." Run it before
calling a release ready.

## What it does

1. **Snapshot HEAD** with `git archive HEAD | tar -x` into a fresh
   temp directory. This deliberately ignores uncommitted working-tree
   changes — the test simulates someone cloning the published commit.
2. **`npm ci`** in the snapshot — clean install from `package-lock.json`.
3. **`npm test`** — every Vitest suite must pass.
4. **`npm run build`** for the six publishable packages — tsup must
   produce `dist/index.js` + `dist/index.d.ts` everywhere, plus
   `dist/bin.js` for the CLI.
5. **`npm run pack:dry-run`** — every tarball must include the right
   files.
6. **Boot demo-app** on port 3000 (default `next dev`) and poll
   `http://localhost:3000/.well-known/agentbridge.json` until it
   responds 200.
7. **Run the compiled CLI** — `node packages/cli/dist/bin.js scan
   http://localhost:3000`. Validates that the published CLI binary
   works end-to-end against a real manifest.
8. **MCP server boot check** — spawn `node apps/mcp-server/dist/index.js`
   and confirm it doesn't immediately exit.
9. **Cleanup** — remove the temp directory on success. On failure,
   preserve the temp directory and print its path for inspection.

## Run it

```bash
npm run smoke:external
```

Expected runtime: 60–120 seconds (most of it is `npm ci` and the demo
boot poll).

## Flags

- `--keep` — never delete the temp directory, even on success. Useful
  for inspecting intermediate state.

## Requirements

- Working `git` (uses `git archive HEAD`).
- Free port 3000 (the demo hardcodes it). The script fails fast with a
  clear error if 3000 is already in use; stop your local dev server
  first.
- Network access for `npm ci`. The script does not call any other
  external services.

## Caveats

- Runs the LAST committed state, not your working tree. Commit before
  running. This is by design — it tests the published-shape state.
- Does not exercise the `playwright` optional dependency. The scanner
  scans manifests but does not run a headless browser probe.
- Does not run `next build` for demo-app or studio. Those are slow and
  are covered by CI separately. If you want them, run them yourself
  after `npm run smoke:external`.

## CI

The `.github/workflows/release-check.yml` workflow runs this script on
both Node 20.x and 22.x. It's `workflow_dispatch`-only — trigger it
manually before tagging a release.

## Troubleshooting

**`port 3000 in use`** — kill whatever is on that port (`lsof -nP -i:3000`).

**`Timeout waiting for /.well-known/agentbridge.json`** — demo-app
likely failed to start. Re-run with `--keep`, then
`(cd $tmpdir && npm run dev:demo)` and watch for errors.

**`pack-check failed: missing required: README.md`** — a publishable
package is missing a `README.md` at its root. Check
`packages/*/README.md` and `apps/mcp-server/README.md`.

**`MCP server exited prematurely`** — the compiled bin failed to start.
Re-run with `--keep` and inspect
`(cd $tmpdir && node apps/mcp-server/dist/index.js)`.
