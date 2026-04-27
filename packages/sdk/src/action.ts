import { z, type ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { AgentAction, ActionExample, PermissionPolicy } from "@agentbridge/core";

export interface DefineAgentActionConfig {
  name: string;
  title: string;
  description: string;
  // Either a Zod schema (preferred — runtime validation comes for free)
  // or a raw JSON Schema. Tradeoff: raw JSON Schema works but validation
  // becomes a no-op unless the caller plugs in their own validator.
  inputSchema: ZodTypeAny | Record<string, unknown>;
  outputSchema?: ZodTypeAny | Record<string, unknown>;
  method: AgentAction["method"];
  endpoint: string;
  risk: AgentAction["risk"];
  requiresConfirmation?: boolean;
  permissions?: PermissionPolicy[];
  examples?: ActionExample[];
  humanReadableSummaryTemplate?: string;
}

export interface DefinedAction {
  /** Manifest-shaped definition (JSON-Schema input/output, no runtime validators). */
  definition: AgentAction;
  /** Runtime input validator. Returns parsed input or throws. */
  validate(input: unknown): Record<string, unknown>;
}

function isZodSchema(value: unknown): value is ZodTypeAny {
  return Boolean(value && typeof value === "object" && "_def" in (value as object));
}

function toJsonSchema(schema: ZodTypeAny | Record<string, unknown>): Record<string, unknown> {
  if (isZodSchema(schema)) {
    // Strip the top-level $schema/definitions wrapper from zod-to-json-schema output.
    const json = zodToJsonSchema(schema, { target: "jsonSchema7" }) as Record<string, unknown>;
    delete json["$schema"];
    return json;
  }
  return schema;
}

export function defineAgentAction(config: DefineAgentActionConfig): DefinedAction {
  const inputJsonSchema = toJsonSchema(config.inputSchema);
  const outputJsonSchema = config.outputSchema ? toJsonSchema(config.outputSchema) : undefined;

  // If a Zod schema was provided, use it for runtime validation. Otherwise we
  // pass input through unchanged (the caller is responsible for validating).
  const inputZod: ZodTypeAny | undefined = isZodSchema(config.inputSchema)
    ? config.inputSchema
    : undefined;

  const definition: AgentAction = {
    name: config.name,
    title: config.title,
    description: config.description,
    inputSchema: inputJsonSchema,
    outputSchema: outputJsonSchema,
    method: config.method,
    endpoint: config.endpoint,
    risk: config.risk,
    requiresConfirmation: config.requiresConfirmation ?? false,
    permissions: config.permissions ?? [],
    examples: config.examples ?? [],
    humanReadableSummaryTemplate: config.humanReadableSummaryTemplate,
  };

  return {
    definition,
    validate(input: unknown): Record<string, unknown> {
      if (!inputZod) {
        // No Zod schema available. Trust the caller — but require an object.
        if (input === null || typeof input !== "object" || Array.isArray(input)) {
          throw new Error(`Action "${config.name}" expected an object input`);
        }
        return input as Record<string, unknown>;
      }
      const result = inputZod.safeParse(input ?? {});
      if (!result.success) {
        const messages = result.error.issues
          .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
          .join("; ");
        throw new Error(`Invalid input for "${config.name}": ${messages}`);
      }
      // Zod always returns plain objects for object schemas, so this cast is safe
      // for the input shapes we emit through defineAgentAction.
      return (result.data ?? {}) as Record<string, unknown>;
    },
  };
}

// Re-export so SDK consumers don't need to depend on zod directly.
export { z };
