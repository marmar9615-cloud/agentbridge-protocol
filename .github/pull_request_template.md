## Summary

<!-- One paragraph: what does this change and why. Link to an issue or roadmap item. -->

## Motivation

<!-- What problem is this solving? Who asked for it? -->

## Changes

<!-- Bullet list of meaningful edits. Highlight anything user-facing. -->

-

## Breaking changes?

- [ ] No
- [ ] Yes — describe the migration path:

## Test plan

<!-- How did you verify the change end-to-end? -->

- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run build` (publishable packages) passes (if changed)
- [ ] `npm run pack:dry-run` passes (if changed)
- [ ] Demo app and Studio still build (`npx next build` in each)
- [ ] Manual smoke test: <!-- describe -->

## Security invariant impact

Phase 3A safety invariants (see [CLAUDE.md](../CLAUDE.md) §Security
invariants):

- [ ] No impact on confirmation gate
- [ ] No impact on origin pinning
- [ ] No impact on URL allowlist
- [ ] No impact on audit redaction
- [ ] No impact on simulated-destructive-action contract
- [ ] If any box above is unchecked: explain in detail.

## Documentation

- [ ] `CHANGELOG.md` updated under the unreleased section
- [ ] Relevant docs in `docs/` updated
- [ ] If manifest schema changed: `spec/` updated and version bumped

## Anything reviewers should know?

<!-- Edge cases, alternatives considered, follow-ups planned. -->
