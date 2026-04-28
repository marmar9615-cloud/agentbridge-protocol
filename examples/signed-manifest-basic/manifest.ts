import { validateManifest } from "@marmarlabs/agentbridge-core";
import {
  createAgentBridgeManifest,
  defineAgentAction,
  signManifest,
  z,
} from "@marmarlabs/agentbridge-sdk";

// TEST ONLY. This Ed25519 private key exists solely to make this example
// deterministic in docs and regression tests. Production signing keys should
// live in KMS/HSM/secret-manager infrastructure and be loaded outside source
// control.
const TEST_ONLY_ED25519_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIKSXsEXyAP3O1L5RImgZcGDzbiKurlmgrrmR6AojVA7U
-----END PRIVATE KEY-----`;

export const listNotes = defineAgentAction({
  name: "list_notes",
  title: "List notes",
  description: "Returns notes visible to the current operator.",
  method: "GET",
  endpoint: "/api/agentbridge/actions/list_notes",
  risk: "low",
  requiresConfirmation: false,
  inputSchema: z.object({
    projectId: z.string().min(1).optional(),
  }),
  outputSchema: z.object({
    notes: z.array(z.unknown()),
  }),
  permissions: [{ scope: "notes:read" }],
  examples: [
    {
      description: "List notes for one project",
      input: { projectId: "proj_123" },
    },
  ],
  humanReadableSummaryTemplate: "List notes for project {{projectId}}",
});

export const draftProjectUpdate = defineAgentAction({
  name: "draft_project_update",
  title: "Draft project update",
  description:
    "Creates a draft project update for human review. It does not send or publish anything.",
  method: "POST",
  endpoint: "/api/agentbridge/actions/draft_project_update",
  risk: "medium",
  requiresConfirmation: true,
  inputSchema: z.object({
    projectId: z.string().min(1),
    summary: z.string().min(1).max(2000),
  }),
  outputSchema: z.object({
    draftId: z.string(),
    simulated: z.literal(true),
  }),
  permissions: [{ scope: "projects:draft_update" }],
  examples: [
    {
      description: "Draft a safe update",
      input: {
        projectId: "proj_123",
        summary: "Draft a short update about completed onboarding tasks.",
      },
    },
  ],
  humanReadableSummaryTemplate: "Draft a project update for {{projectId}}",
});

export function createUnsignedExampleManifest() {
  const manifest = createAgentBridgeManifest({
    name: "Signed Manifest Basic",
    description: "Small signed-manifest example using safe note and project-draft actions.",
    version: "1.0.0",
    baseUrl: "https://projects.example.com",
    contact: "platform@example.com",
    auth: {
      type: "bearer",
      description: "Use the app's normal operator authentication.",
    },
    resources: [
      {
        name: "project_notes",
        description: "Project notes and draft updates visible to operators.",
        url: "/projects/notes",
      },
    ],
    actions: [listNotes, draftProjectUpdate],
  });

  // Keep the example output stable across runs. Real publishers usually let
  // createAgentBridgeManifest stamp the current build time here.
  manifest.generatedAt = "2026-04-28T00:00:00.000Z";
  return manifest;
}

export function createSignedExampleManifest() {
  return signManifest(createUnsignedExampleManifest(), {
    kid: "test-ed25519-2026-04",
    privateKey: TEST_ONLY_ED25519_PRIVATE_KEY_PEM,
    signedAt: "2026-04-28T12:00:00.000Z",
    expiresAt: "2026-04-29T12:00:00.000Z",
  });
}

export const manifest = createSignedExampleManifest();
export const manifestValidation = validateManifest(manifest);

if (process.argv[1]?.endsWith("manifest.ts")) {
  const result = validateManifest(manifest);
  if (!result.ok) {
    console.error(result.errors.join("\n"));
    process.exit(1);
  }
  console.log(JSON.stringify(result.manifest, null, 2));
}
