/* MCP prompts surface reusable instructions agents (or end-users in MCP UIs)
 * can pick from. Each prompt accepts a small set of named arguments; we
 * render templates server-side and return the message list.
 */

export interface PromptDescriptor {
  name: string;
  title: string;
  description: string;
  arguments: { name: string; description: string; required: boolean }[];
}

export const PROMPTS: PromptDescriptor[] = [
  {
    name: "scan_app_for_agent_readiness",
    title: "Scan an app for agent readiness",
    description:
      "Run an end-to-end readiness audit on an AgentBridge surface and write up the findings.",
    arguments: [
      {
        name: "url",
        description: "Origin URL of the app to scan (http(s)://...).",
        required: true,
      },
    ],
  },
  {
    name: "generate_manifest_from_api",
    title: "Generate an AgentBridge manifest for an API",
    description:
      "Walk an OpenAPI document or describe an existing API and produce a draft AgentBridge manifest.",
    arguments: [
      { name: "openapiUrl", description: "URL or description of the source API.", required: true },
      { name: "appName", description: "Human-readable app name.", required: false },
    ],
  },
  {
    name: "explain_action_confirmation",
    title: "Explain why this action requires confirmation",
    description:
      "Given a manifest URL and action name, explain to a human reviewer what the action does and why confirmation is needed.",
    arguments: [
      { name: "url", description: "AgentBridge manifest URL.", required: true },
      { name: "actionName", description: "Name of the action.", required: true },
    ],
  },
  {
    name: "review_manifest_for_security",
    title: "Review a manifest for security issues",
    description:
      "Audit a manifest for risky-action patterns, missing confirmations, missing permissions, and other safety issues.",
    arguments: [
      { name: "url", description: "AgentBridge manifest URL.", required: true },
    ],
  },
];

export interface RenderedPrompt {
  description: string;
  messages: { role: "user"; content: { type: "text"; text: string } }[];
}

export function renderPrompt(name: string, args: Record<string, string>): RenderedPrompt {
  switch (name) {
    case "scan_app_for_agent_readiness":
      return {
        description: `Readiness scan for ${args.url}`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Use the scan_agent_readiness tool against ${args.url}. Then summarize:
1. Score and what drove deductions.
2. Highest-severity issues.
3. The top 3 recommendations grouped by category (safety, schema, docs, developerExperience).
4. Whether you'd consider this app safe for agents to call risky actions on.`,
            },
          },
        ],
      };
    case "generate_manifest_from_api":
      return {
        description: `Generate manifest for ${args.openapiUrl}`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Generate an AgentBridge manifest for the API described at ${args.openapiUrl}.
${args.appName ? `Use "${args.appName}" as the manifest name.` : ""}

For each action:
- snake_case name from operationId or method+path
- Risk: GET=low, POST/PUT/PATCH=medium, DELETE=high
- requiresConfirmation true for medium and high
- humanReadableSummaryTemplate using path params

Return the complete manifest JSON, then call validate (locally or via the AgentBridge CLI) before finalizing.`,
            },
          },
        ],
      };
    case "explain_action_confirmation":
      return {
        description: `Explain confirmation for ${args.actionName}`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Use list_actions on ${args.url} to find "${args.actionName}". Then explain to a human reviewer:
1. What the action does (translate the description and inputSchema).
2. What inputs are required.
3. Why it's classified as ${args.actionName.includes("delete") ? "high" : "medium"}-risk.
4. What a worst-case mistake would look like.
5. What the human should verify before approving.`,
            },
          },
        ],
      };
    case "review_manifest_for_security":
      return {
        description: `Security review of ${args.url}`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Review the AgentBridge manifest at ${args.url} for security issues. Use scan_agent_readiness first.

Specifically check:
- Any high-risk actions without requiresConfirmation: true.
- Destructive HTTP methods (DELETE) without high-risk classification.
- Risky actions without declared permissions.
- Cross-origin endpoints (manifest baseUrl differs from action endpoint origin).
- Actions where the inputSchema is too permissive (any-type fields, no required[]).

Return findings sorted by severity, with recommended fixes.`,
            },
          },
        ],
      };
    default:
      throw new Error(`unknown prompt: ${name}`);
  }
}
