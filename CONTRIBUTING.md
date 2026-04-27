# Contributing to AgentBridge

Thanks for considering a contribution. This document is short on
ceremony — open an issue if anything is unclear.

## Where to start

The most valuable contributions are about the **interface contract**
between agents and apps, not the demo Next.js plumbing.

| Want to work on... | Start here |
|---|---|
| The manifest schema | [`packages/core/src/schemas.ts`](packages/core/src/schemas.ts) + [`spec/agentbridge-manifest.schema.json`](spec/agentbridge-manifest.schema.json) |
| Scanner checks | [`packages/scanner/src/score.ts`](packages/scanner/src/score.ts) |
| MCP tools / safety | [`apps/mcp-server/src/tools.ts`](apps/mcp-server/src/tools.ts) |
| OpenAPI conversion | [`packages/openapi/src/convert.ts`](packages/openapi/src/convert.ts) |
| CLI commands | [`packages/cli/src/commands/`](packages/cli/src/commands/) |
| Studio dashboard | [`apps/studio/app/`](apps/studio/app/) |

## Development workflow

```bash
git clone https://github.com/marmar9615-cloud/agentbridge-protocol.git
cd agentbridge-protocol
npm install
npm test                  # all suites
npm run typecheck         # tsc -b across the workspace
npm run dev               # demo + studio in parallel
```

## Style

- TypeScript strict, ESM, `moduleResolution: Bundler`. **No `.js`
  extensions on relative imports** (Next.js webpack rejects them).
- Comments only when the *why* is non-obvious. No multi-paragraph docstrings.
- Plain CSS in Studio. No Tailwind.
- Tests live in `src/tests/*.test.ts` next to the code they cover.

## Pull requests

1. Branch from `main`.
2. Add a test for any new behaviour. We're at ~80 tests; expect that bar to keep rising.
3. Run `npm test`, `npm run typecheck`, and `npx next build` for the demo
   and studio apps before pushing.
4. If it changes user-visible behaviour or the manifest format, update
   [`CHANGELOG.md`](CHANGELOG.md) and (if applicable) the
   [spec](spec/agentbridge-manifest.v0.1.md).
5. Don't force-push to `main`. PRs are reviewed; small focused PRs land faster.

## Security invariants

These are non-negotiable. PRs that bypass them will be rejected.

1. **Confirmation gate.** Risky actions must not execute without explicit
   `confirmationApproved: true` AND a valid `confirmationToken`.
2. **Origin pinning.** Action endpoints must share origin with `manifest.baseUrl`.
3. **URL allowlist.** Loopback only by default. `AGENTBRIDGE_ALLOW_REMOTE=true`
   is the only escape.
4. **Audit redaction.** Never log secrets. Extend the redact set in
   `core/src/audit.ts`; don't bypass it.
5. **Simulated destructive actions.** The demo app never touches real
   payment processors or external services.

## Reporting bugs

Open an issue with:
- What you expected
- What actually happened
- A minimal reproduction (manifest, command, output)

## Reporting security issues

See [SECURITY.md](SECURITY.md). Don't open a public issue for security findings.

## License

By contributing, you agree your contributions are licensed under the
[Apache License 2.0](LICENSE).
