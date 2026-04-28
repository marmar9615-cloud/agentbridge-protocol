# Scanner regression fixtures

These manifests pin the scanner behavior that adopter docs and v1.0
readiness work rely on. They are safe fixtures only; no endpoint here
performs real actions.

Use them from tests or with the CLI after building the repo:

```bash
node packages/cli/dist/bin.js validate examples/scanner-regression/manifest.good.json
node packages/cli/dist/bin.js validate examples/scanner-regression/manifest.minimal-valid.json
```

## Fixtures

| File | Expected scanner behavior |
|---|---|
| `manifest.good.json` | High readiness score. Includes contact, auth, resources, examples, output schemas, summary templates, permissions, and confirmation for risky actions. |
| `manifest.missing-confirmation.json` | Valid manifest with a medium-risk mutation missing confirmation. Scanner should report `action.medium-risk-no-confirm` and add a safety recommendation. |
| `manifest.origin-mismatch.json` | Valid manifest whose `baseUrl` is `https://api.example.com`. Scanning `https://support.example.com` should report `manifest.baseUrl.cross-origin`. |
| `manifest.minimal-valid.json` | Valid but low-readiness manifest. Scanner should score it lower than the good fixture and recommend contact, auth, resources, output schema, examples, and summary template improvements. |
| `manifest.invalid.json` | Invalid manifest with an invalid `baseUrl` and missing action fields. Validation should fail safely with `manifest.invalid` rather than throwing. |

The fixtures use only manifest schema v0.1 fields accepted by the
current `@marmarlabs/agentbridge-core` validator.
