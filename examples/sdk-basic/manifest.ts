import { validateManifest } from "@marmarlabs/agentbridge-core";
import {
  createAgentBridgeManifest,
  defineAgentAction,
  validateActionInput,
  z,
} from "@marmarlabs/agentbridge-sdk";

export const listTickets = defineAgentAction({
  name: "list_tickets",
  title: "List tickets",
  description: "Returns support tickets filtered by status or assignee.",
  method: "GET",
  endpoint: "/api/agentbridge/actions/list_tickets",
  risk: "low",
  requiresConfirmation: false,
  inputSchema: z.object({
    status: z.enum(["open", "pending", "resolved"]).optional(),
    assigneeId: z.string().min(1).optional(),
  }),
  outputSchema: z.object({
    tickets: z.array(z.unknown()),
  }),
  permissions: [{ scope: "tickets:read" }],
  examples: [
    {
      description: "Open tickets",
      input: { status: "open" },
    },
  ],
  humanReadableSummaryTemplate: "List tickets (status: {{status}}, assignee: {{assigneeId}})",
});

export const draftTicketReply = defineAgentAction({
  name: "draft_ticket_reply",
  title: "Draft ticket reply",
  description: "Creates a draft support reply for human review. It does not send email.",
  method: "POST",
  endpoint: "/api/agentbridge/actions/draft_ticket_reply",
  risk: "medium",
  requiresConfirmation: true,
  inputSchema: z.object({
    ticketId: z.string().min(1),
    body: z.string().min(1).max(4000),
    tone: z.enum(["concise", "friendly", "formal"]).default("friendly"),
  }),
  outputSchema: z.object({
    draftId: z.string(),
    simulated: z.literal(true),
  }),
  permissions: [{ scope: "tickets:draft_reply" }],
  examples: [
    {
      description: "Draft a friendly reply",
      input: {
        ticketId: "T-1001",
        body: "Thanks for the report. We are checking the order status now.",
        tone: "friendly",
      },
    },
  ],
  humanReadableSummaryTemplate: "Draft a {{tone}} reply for ticket {{ticketId}}",
});

export const simulateEscalation = defineAgentAction({
  name: "simulate_ticket_escalation",
  title: "Simulate ticket escalation",
  description:
    "Simulates an escalation request for demo purposes. It does not page anyone or call external services.",
  method: "POST",
  endpoint: "/api/agentbridge/actions/simulate_ticket_escalation",
  risk: "high",
  requiresConfirmation: true,
  inputSchema: z.object({
    ticketId: z.string().min(1),
    team: z.enum(["payments", "platform", "support"]),
    reason: z.string().min(10),
  }),
  outputSchema: z.object({
    simulated: z.literal(true),
    escalationId: z.string(),
  }),
  permissions: [
    {
      scope: "tickets:escalate",
      description: "High-risk demo scope. Keep confirmation enabled.",
    },
  ],
  examples: [
    {
      description: "Simulated escalation",
      input: {
        ticketId: "T-1001",
        team: "payments",
        reason: "Customer cannot complete checkout after multiple retries.",
      },
    },
  ],
  humanReadableSummaryTemplate:
    "SIMULATE escalation for ticket {{ticketId}} to {{team}} (reason: {{reason}})",
});

export const sdkBasicActions = [listTickets, draftTicketReply, simulateEscalation];

export function createSdkBasicManifest(baseUrl = "https://support.example.com") {
  return createAgentBridgeManifest({
    name: "SDK Basic Support",
    description: "Small SDK example manifest for support-ticket workflows.",
    version: "1.0.0",
    baseUrl,
    contact: "platform@example.com",
    auth: {
      type: "bearer",
      description: "Use the app's normal operator authentication.",
    },
    resources: [
      {
        name: "support_tickets",
        description: "Support tickets, staff-only drafts, and simulated escalations.",
        url: "/support/tickets",
      },
    ],
    actions: sdkBasicActions,
  });
}

export const manifest = createSdkBasicManifest();
export const manifestValidation = validateManifest(manifest);

export function validateDraftTicketReplyInput(input: unknown) {
  return validateActionInput(draftTicketReply, input);
}

if (process.argv[1]?.endsWith("manifest.ts")) {
  const result = validateManifest(manifest);
  if (!result.ok) {
    console.error(result.errors.join("\n"));
    process.exit(1);
  }
  console.log(JSON.stringify(result.manifest, null, 2));
}
