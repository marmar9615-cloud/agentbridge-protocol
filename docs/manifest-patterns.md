# Manifest patterns

This catalogue shows reusable AgentBridge manifest patterns for common
app operations. The examples use only fields supported by manifest spec
v0.1 and the current `@marmarlabs/agentbridge-core` validator.

Use these as starting points, then adjust names, schemas, examples,
permissions, and summaries to match your app.

## 1. Read-only list action

**When to use it:** Search, list, or filter collections such as orders,
invoices, support tickets, projects, or notes.

**Risk level:** `low`.

**Confirmation guidance:** No confirmation required when the action is
read-only and does not expose sensitive data beyond the operator's
normal authorization.

**JSON example:**

```json
{
  "name": "list_orders",
  "title": "List orders",
  "description": "Returns recent orders, optionally filtered by status.",
  "method": "GET",
  "endpoint": "/api/agentbridge/actions/list_orders",
  "risk": "low",
  "requiresConfirmation": false,
  "inputSchema": {
    "type": "object",
    "properties": {
      "status": { "type": "string", "enum": ["pending", "shipped", "refunded"] },
      "limit": { "type": "integer", "minimum": 1, "maximum": 100 }
    }
  },
  "outputSchema": {
    "type": "object",
    "properties": { "orders": { "type": "array" } }
  },
  "permissions": [{ "scope": "orders:read" }],
  "examples": [{ "description": "Recent shipped orders", "input": { "status": "shipped", "limit": 25 } }],
  "humanReadableSummaryTemplate": "List orders (status: {{status}}, limit: {{limit}})"
}
```

**Common mistakes:** Returning unbounded collections, omitting filters,
including secrets in returned objects, or marking a list action as safe
when it reveals data the operator could not normally see.

## 2. Read-only detail action

**When to use it:** Fetch one object by stable identifier.

**Risk level:** `low`.

**Confirmation guidance:** No confirmation required when the object is
read-only and app authorization checks still run on the endpoint.

**JSON example:**

```json
{
  "name": "get_order",
  "title": "Get order",
  "description": "Returns full details for one order, including status, items, notes, and refund history.",
  "method": "GET",
  "endpoint": "/api/agentbridge/actions/get_order",
  "risk": "low",
  "requiresConfirmation": false,
  "inputSchema": {
    "type": "object",
    "required": ["orderId"],
    "properties": {
      "orderId": { "type": "string", "minLength": 1 }
    }
  },
  "outputSchema": {
    "type": "object",
    "properties": { "order": { "type": "object" } }
  },
  "permissions": [{ "scope": "orders:read" }],
  "examples": [{ "description": "Known order", "input": { "orderId": "ORD-1001" } }],
  "humanReadableSummaryTemplate": "Get order {{orderId}}"
}
```

**Common mistakes:** Allowing arbitrary URL input, returning raw payment
or credential fields, or failing to enforce the same app authorization
checks your human UI uses.

## 3. Draft action that prepares a change

**When to use it:** Let the agent prepare a reversible or reviewable
change before a separate execution step.

**Risk level:** Usually `medium`.

**Confirmation guidance:** Require confirmation if the draft changes
server state, creates audit-visible records, reserves resources, or
could confuse a human operator.

**JSON example:**

```json
{
  "name": "draft_refund_order",
  "title": "Draft refund order",
  "description": "Creates a refund draft for review. It does not execute money movement.",
  "method": "POST",
  "endpoint": "/api/agentbridge/actions/draft_refund_order",
  "risk": "medium",
  "requiresConfirmation": true,
  "inputSchema": {
    "type": "object",
    "required": ["orderId", "amount", "reason"],
    "properties": {
      "orderId": { "type": "string" },
      "amount": { "type": "number", "minimum": 0.01 },
      "reason": { "type": "string", "minLength": 3 }
    }
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "draftId": { "type": "string" },
      "summary": { "type": "string" }
    }
  },
  "permissions": [{ "scope": "refunds:draft" }],
  "examples": [
    {
      "description": "Damaged item draft",
      "input": { "orderId": "ORD-1001", "amount": 24, "reason": "Damaged on arrival" }
    }
  ],
  "humanReadableSummaryTemplate": "Draft a ${{amount}} refund on order {{orderId}} (reason: {{reason}})"
}
```

**Common mistakes:** Naming the action like it executes the change,
skipping confirmation because "it is only a draft", or making the draft
implicitly execute downstream side effects.

## 4. Medium-risk mutation requiring confirmation

**When to use it:** Add notes, update labels, assign tickets, change
priority, or make reversible edits.

**Risk level:** `medium`.

**Confirmation guidance:** Set `requiresConfirmation: true`, especially
when the change is visible to other users or affects workflow state.

**JSON example:**

```json
{
  "name": "add_internal_note",
  "title": "Add internal note",
  "description": "Adds an internal note to a support ticket. The note is visible to staff only.",
  "method": "POST",
  "endpoint": "/api/agentbridge/actions/add_internal_note",
  "risk": "medium",
  "requiresConfirmation": true,
  "inputSchema": {
    "type": "object",
    "required": ["ticketId", "body"],
    "properties": {
      "ticketId": { "type": "string" },
      "body": { "type": "string", "minLength": 1, "maxLength": 2000 }
    }
  },
  "outputSchema": {
    "type": "object",
    "properties": { "noteId": { "type": "string" } }
  },
  "permissions": [{ "scope": "tickets:comment" }],
  "examples": [
    {
      "description": "Staff-only context",
      "input": { "ticketId": "T-1001", "body": "Customer asked for an update after retrying checkout." }
    }
  ],
  "humanReadableSummaryTemplate": "Add internal note to ticket {{ticketId}}: {{body}}"
}
```

**Common mistakes:** Treating comments as harmless when they notify
people, omitting max lengths, or allowing agents to write user-facing
content without a clear summary.

## 5. High-risk destructive action requiring confirmation

**When to use it:** Delete data, execute irreversible state changes,
send external notifications, page on-call, or perform financially
significant work.

**Risk level:** `high`.

**Confirmation guidance:** Always require confirmation. The summary
should use direct language and include the most important identifiers.

**JSON example:**

```json
{
  "name": "delete_note",
  "title": "Delete note",
  "description": "Deletes a note from a project audit trail. Use only after a human has reviewed the exact note.",
  "method": "DELETE",
  "endpoint": "/api/agentbridge/actions/delete_note",
  "risk": "high",
  "requiresConfirmation": true,
  "inputSchema": {
    "type": "object",
    "required": ["projectId", "noteId"],
    "properties": {
      "projectId": { "type": "string" },
      "noteId": { "type": "string" },
      "reason": { "type": "string", "minLength": 5 }
    }
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "deleted": { "type": "boolean" },
      "deletedAt": { "type": "string", "format": "date-time" }
    }
  },
  "permissions": [
    {
      "scope": "projects:delete_note",
      "description": "Privileged destructive scope. Audit every grant."
    }
  ],
  "examples": [
    {
      "description": "Delete a duplicate note",
      "input": { "projectId": "PROJ-42", "noteId": "note_123", "reason": "Duplicate note" }
    }
  ],
  "humanReadableSummaryTemplate": "DELETE note {{noteId}} from project {{projectId}} (reason: {{reason}})"
}
```

**Common mistakes:** Using vague summaries like "confirm action",
accepting broad filters instead of exact identifiers, or making the
operation non-idempotent.

## 6. Idempotent action with idempotency key

**When to use it:** Any operation where retrying the same request
should not create a duplicate effect, such as sending an invoice,
creating a ticket, or executing a prepared transition.

**Risk level:** Usually `medium` or `high`, depending on the side
effect.

**Confirmation guidance:** Require confirmation when the action mutates
state or touches external systems. When calling through MCP, pass an
`idempotencyKey` to `call_action`; it is an MCP call argument, not a
manifest field.

**JSON example:**

```json
{
  "name": "send_invoice",
  "title": "Send invoice",
  "description": "Sends an already-reviewed invoice to a customer. The endpoint must treat repeated calls for the same invoice as a replay.",
  "method": "POST",
  "endpoint": "/api/agentbridge/actions/send_invoice",
  "risk": "high",
  "requiresConfirmation": true,
  "inputSchema": {
    "type": "object",
    "required": ["invoiceId", "recipientEmail"],
    "properties": {
      "invoiceId": { "type": "string" },
      "recipientEmail": { "type": "string", "format": "email" }
    }
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "sent": { "type": "boolean" },
      "messageId": { "type": "string" }
    }
  },
  "permissions": [{ "scope": "invoices:send" }],
  "examples": [
    {
      "description": "Send reviewed invoice",
      "input": { "invoiceId": "INV-2026-0007", "recipientEmail": "billing@example.com" }
    }
  ],
  "humanReadableSummaryTemplate": "SEND invoice {{invoiceId}} to {{recipientEmail}}"
}
```

Example MCP call shape:

```json
{
  "url": "https://app.example.com",
  "actionName": "send_invoice",
  "input": {
    "invoiceId": "INV-2026-0007",
    "recipientEmail": "billing@example.com"
  },
  "idempotencyKey": "send-invoice-INV-2026-0007"
}
```

**Common mistakes:** Adding unsupported `idempotencyKey` fields to the
manifest, generating a new key on every retry, or building endpoints
that double-send on repeated input.

## 7. Action with humanReadableSummaryTemplate

**When to use it:** Every confirmation-required action, and most read
actions where a summary helps the operator understand what the agent is
doing.

**Risk level:** Any. Most important for `medium` and `high`.

**Confirmation guidance:** The summary should be understandable without
opening raw JSON. Include object identifiers, amounts, recipients,
reason fields, and irreversible words for destructive actions.

**JSON example:**

```json
{
  "name": "assign_ticket",
  "title": "Assign ticket",
  "description": "Assigns a support ticket to a team member.",
  "method": "POST",
  "endpoint": "/api/agentbridge/actions/assign_ticket",
  "risk": "medium",
  "requiresConfirmation": true,
  "inputSchema": {
    "type": "object",
    "required": ["ticketId", "assigneeId"],
    "properties": {
      "ticketId": { "type": "string" },
      "assigneeId": { "type": "string" },
      "reason": { "type": "string" }
    }
  },
  "outputSchema": {
    "type": "object",
    "properties": { "assignmentId": { "type": "string" } }
  },
  "permissions": [{ "scope": "tickets:assign" }],
  "examples": [
    {
      "input": { "ticketId": "T-1001", "assigneeId": "user_42", "reason": "Checkout specialist" }
    }
  ],
  "humanReadableSummaryTemplate": "Assign ticket {{ticketId}} to {{assigneeId}} (reason: {{reason}})"
}
```

**Common mistakes:** Relying on descriptions alone, using placeholders
that are not present in input, hiding important values, or using a
summary that sounds lower-risk than the action really is.

## 8. Resource entry for documentation or object detail

**When to use it:** Give agents a mental model of the app's main
objects and documentation surfaces.

**Risk level:** Not applicable. Resources are documentation, not
callable actions.

**Confirmation guidance:** Not applicable.

**JSON example:**

```json
{
  "resources": [
    {
      "name": "orders",
      "description": "Customer orders, fulfillment status, notes, and refund history.",
      "url": "/orders"
    },
    {
      "name": "refund_policy",
      "description": "Internal policy documentation for refund eligibility.",
      "url": "/docs/refunds"
    }
  ]
}
```

**Common mistakes:** Treating resources as enforced authorization
rules, listing private URLs the operator cannot access, or omitting
resources entirely for complex apps.

## 9. Contact/auth metadata best practices

**When to use it:** Every manifest that may be consumed outside one
developer's local machine.

**Risk level:** Not applicable. This is top-level manifest metadata.

**Confirmation guidance:** Not applicable, but accurate auth metadata
helps operators configure their client safely.

**JSON example:**

```json
{
  "name": "Acme Admin",
  "description": "Structured actions for Acme's internal admin workflows.",
  "version": "1.0.0",
  "baseUrl": "https://app.example.com",
  "contact": "platform@example.com",
  "auth": {
    "type": "bearer",
    "description": "Use short-lived service tokens scoped per operator role. Do not put tokens in URLs."
  },
  "resources": [
    {
      "name": "security_runbook",
      "description": "Operational runbook for AgentBridge action review.",
      "url": "/docs/agentbridge"
    }
  ],
  "actions": []
}
```

**Common mistakes:** Leaving `contact` blank, declaring `auth:
{ "type": "none" }` for a real remote app, documenting credentials in
the manifest, or using query-string tokens. Current shipped MCP is
stdio; the HTTP transport/auth design is on the v0.4.0 track and is
not part of the current npm package.
