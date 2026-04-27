import type { DefinedAction } from "./action";

export type ActionHandlerFn<TInput = Record<string, unknown>, TOutput = unknown> = (
  input: TInput,
  ctx: { request: Request },
) => Promise<TOutput> | TOutput;

// Wraps an action handler so it can be exported as a Next.js route handler.
// Parses the request body (or query for GET), validates input against the
// action's Zod schema, dispatches, and returns JSON. Errors become 4xx/5xx.
export function createActionHandler<TInput = Record<string, unknown>, TOutput = unknown>(
  action: DefinedAction,
  handler: ActionHandlerFn<TInput, TOutput>,
) {
  return async (request: Request): Promise<Response> => {
    let rawInput: unknown = {};
    try {
      if (action.definition.method === "GET") {
        const url = new URL(request.url);
        rawInput = Object.fromEntries(url.searchParams.entries());
      } else {
        const text = await request.text();
        rawInput = text.length > 0 ? JSON.parse(text) : {};
      }
    } catch (err) {
      return jsonError(400, `Invalid request body: ${(err as Error).message}`);
    }

    let validated: Record<string, unknown>;
    try {
      validated = action.validate(rawInput);
    } catch (err) {
      return jsonError(400, (err as Error).message);
    }

    try {
      const result = await handler(validated as TInput, { request });
      return new Response(JSON.stringify({ ok: true, result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch (err) {
      return jsonError(500, (err as Error).message);
    }
  };
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
