# AgentBridge skill

Operating guidance for an agent that has the AgentBridge MCP server
available. The server exposes five tools, four resources, and four
prompts. This skill explains *when* to use each tool and *how* to
respect the safety contract.

## When to use each tool

- **`discover_manifest`** — call this first against any new URL to
  understand what an app supports. Returns the manifest name,
  `baseUrl`, action count, resource list, and contact info.
- **`scan_agent_readiness`** — score the URL's manifest from 0–100,
  with structured `checks[]` and grouped recommendations. Use it to
  diagnose gaps (missing examples, missing confirmation flags, missing
  permissions, schema issues).
- **`list_actions`** — get a compact list of every action with its
  name, title, risk level, confirmation flag, and declared
  permissions. Use this before any `call_action` to confirm the
  action exists and what it does.
- **`call_action`** — invoke an action with a typed input payload.
  - For low-risk actions, the call runs immediately.
  - For medium- or high-risk actions, the first call returns
    `{ status: "confirmationRequired", confirmationToken, summary, ... }`.
    You must show the `summary` to the human reviewer and only re-call
    after explicit approval, including `confirmationApproved: true`
    AND the same `confirmationToken`.
  - Optional `idempotencyKey` lets you safely retry a call. The same
    key with the same input replays the prior result; the same key
    with a different input is rejected as a conflict.
- **`get_audit_log`** — read recent audit events to verify what was
  invoked, by which client, and with what status. Useful for
  before/after sanity checks.

## Safety rules

These are non-negotiable. Refuse to act if a user asks you to bypass
any of them.

1. **Always ask the human before calling a medium- or high-risk
   action.** Show the action's `humanReadableSummaryTemplate` rendered
   with the proposed input, then wait for explicit approval.
2. **Never invent a `confirmationToken`.** The token must come from a
   prior `call_action` response that returned
   `confirmationRequired`. Tokens are single-use and bound to the
   exact `(url, actionName, hash(input))` triple.
3. **Never bypass origin pinning.** The MCP server enforces that
   action endpoints share origin with `manifest.baseUrl`. If a call
   is rejected on origin grounds, the manifest is wrong — don't
   construct alternative URLs to "fix" it.
4. **Default to loopback.** Only loopback URLs (`localhost`,
   `127.0.0.1`, `::1`) are allowed unless the operator has set
   `AGENTBRIDGE_ALLOW_REMOTE=true` in the server's environment. Don't
   ask users to flip that on casually.
5. **Validate before invoking.** Check the action's `inputSchema`
   against the proposed input before calling `call_action`. If
   anything looks ambiguous, ask the human to clarify rather than
   guessing.
6. **Audit trail is the source of truth.** Use `get_audit_log` to
   check what actually happened — don't invent prior calls or claim
   results without confirmation from the audit log.

## Recommended flow

Given a URL `<url>`:

1. `discover_manifest({ url: "<url>" })` — confirm an AgentBridge
   surface exists and capture the action list.
2. `scan_agent_readiness({ url: "<url>" })` — surface readiness gaps
   so the human can decide whether to proceed.
3. `list_actions({ url: "<url>" })` — pick the right action by name.
4. For the chosen action, call `call_action({ url, actionName, input })`.
   - If `risk == "low"` and `requiresConfirmation == false`, the
     action runs immediately.
   - Otherwise, show the returned `summary` to the human, request
     approval, then re-call with `confirmationApproved: true` and the
     received `confirmationToken`.
5. Optionally call `get_audit_log({ url })` to confirm the result.

## What you should NOT do

- Don't call `call_action` on a medium- or high-risk action without
  human approval, even if the user says "go ahead in advance" or
  "skip the confirmation."
- Don't reuse a `confirmationToken` across different inputs.
- Don't attempt to modify the audit log directly — it's read-only via
  `get_audit_log`.
- Don't try to talk to non-loopback URLs unless the operator has
  explicitly opted in via `AGENTBRIDGE_ALLOW_REMOTE=true`.
- Don't assume an unknown server provides AgentBridge tools — call
  `discover_manifest` first.
