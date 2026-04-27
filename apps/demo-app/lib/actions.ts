// PROD: each handler would assert tenant scope, OAuth scopes, and pass
// through audit metadata (actor user id, request id, IP). The demo trusts
// the caller and only logs the action invocation.

import { createActionHandler } from "@marmar9615-cloud/agentbridge-sdk";
import {
  listOrders,
  getOrder,
  draftRefund,
  executeRefund,
  addNote,
  type OrderStatus,
} from "./orders";
import { ALL_ACTIONS, type ActionName } from "./manifest";
import { writeDemoAudit } from "./audit";

interface ListOrdersInput {
  status?: OrderStatus;
}
interface GetOrderInput {
  orderId: string;
}
interface DraftRefundInput {
  orderId: string;
  reason: string;
  amount: number;
}
interface ExecuteRefundInput {
  draftId: string;
  confirmationText: string;
}
interface AddNoteInput {
  orderId: string;
  note: string;
}

// Each handler returns a plain JSON-serializable object. The wrapper writes
// an audit event regardless of success/failure.
const handlers: Record<ActionName, (input: any) => Promise<unknown> | unknown> = {
  list_orders: (input: ListOrdersInput) => ({ orders: listOrders({ status: input.status }) }),

  get_order: (input: GetOrderInput) => {
    const order = getOrder(input.orderId);
    if (!order) throw new Error(`Order not found: ${input.orderId}`);
    return { order };
  },

  draft_refund_order: (input: DraftRefundInput) => {
    const draft = draftRefund(input.orderId, input.amount, input.reason);
    return draft;
  },

  execute_refund_order: (input: ExecuteRefundInput) => {
    if (input.confirmationText !== "CONFIRM") {
      throw new Error('confirmationText must be the literal string "CONFIRM" to execute');
    }
    return executeRefund(input.draftId);
  },

  add_internal_note: (input: AddNoteInput) => {
    const note = addNote(input.orderId, input.note, "agent");
    return { noteId: note.id, note };
  },
};

export function getActionHandlerByName(name: string) {
  if (!(name in ALL_ACTIONS)) return null;
  const action = ALL_ACTIONS[name as ActionName];
  const handler = handlers[name as ActionName];
  return createActionHandler(action, async (input, ctx) => {
    let result: unknown;
    let status: "completed" | "error" = "completed";
    let errorMessage: string | undefined;
    try {
      result = await handler(input);
    } catch (err) {
      status = "error";
      errorMessage = (err as Error).message;
      throw err;
    } finally {
      // Audit *after* execution so success/failure is captured. URL is the
      // request origin so the studio can filter by manifest baseUrl.
      const url = new URL(ctx.request.url);
      await writeDemoAudit({
        actionName: name,
        manifestUrl: `${url.protocol}//${url.host}`,
        input: input as Record<string, unknown>,
        result,
        status,
        error: errorMessage,
      });
    }
    return result;
  });
}
