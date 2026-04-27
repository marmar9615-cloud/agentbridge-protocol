// In-memory mock order store for the demo app. No real persistence; resets
// on every dev-server restart. Refunds are *simulated* — there is no payment
// integration anywhere in this codebase.

export type OrderStatus = "pending" | "shipped" | "delivered" | "refunded";

export interface OrderNote {
  id: string;
  author: string;
  text: string;
  createdAt: string;
}

export interface OrderRefund {
  draftId: string;
  amount: number;
  reason: string;
  status: "drafted" | "executed";
  draftedAt: string;
  executedAt?: string;
  simulatedTransactionId?: string;
}

export interface OrderItem {
  sku: string;
  name: string;
  qty: number;
  unitPrice: number;
}

export interface Order {
  id: string;
  customer: { name: string; email: string };
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  placedAt: string;
  notes: OrderNote[];
  refunds: OrderRefund[];
}

function makeOrders(): Order[] {
  return [
    {
      id: "ORD-1001",
      customer: { name: "Ada Lovelace", email: "ada@example.com" },
      items: [
        { sku: "BOOK-01", name: "Notes on the Analytical Engine", qty: 2, unitPrice: 24 },
      ],
      total: 48,
      status: "shipped",
      placedAt: "2026-04-20T10:14:00Z",
      notes: [],
      refunds: [],
    },
    {
      id: "ORD-1002",
      customer: { name: "Grace Hopper", email: "grace@example.com" },
      items: [{ sku: "COBOL-T", name: "COBOL T-shirt", qty: 1, unitPrice: 32 }],
      total: 32,
      status: "delivered",
      placedAt: "2026-04-18T08:42:00Z",
      notes: [
        {
          id: "n1",
          author: "support",
          text: "Customer asked about return policy.",
          createdAt: "2026-04-19T14:00:00Z",
        },
      ],
      refunds: [],
    },
    {
      id: "ORD-1003",
      customer: { name: "Alan Turing", email: "alan@example.com" },
      items: [
        { sku: "BOOK-02", name: "Computing Machinery and Intelligence", qty: 1, unitPrice: 18 },
        { sku: "MUG-01", name: "Bombe Mug", qty: 2, unitPrice: 14 },
      ],
      total: 46,
      status: "pending",
      placedAt: "2026-04-25T17:03:00Z",
      notes: [],
      refunds: [],
    },
    {
      id: "ORD-1004",
      customer: { name: "Katherine Johnson", email: "katherine@example.com" },
      items: [{ sku: "POSTER-01", name: "Apollo Trajectory Poster", qty: 3, unitPrice: 22 }],
      total: 66,
      status: "delivered",
      placedAt: "2026-04-10T09:00:00Z",
      notes: [],
      refunds: [],
    },
    {
      id: "ORD-1005",
      customer: { name: "Margaret Hamilton", email: "margaret@example.com" },
      items: [{ sku: "BOOK-03", name: "Software Engineering", qty: 1, unitPrice: 40 }],
      total: 40,
      status: "shipped",
      placedAt: "2026-04-22T11:30:00Z",
      notes: [],
      refunds: [],
    },
    {
      id: "ORD-1006",
      customer: { name: "Radia Perlman", email: "radia@example.com" },
      items: [{ sku: "STICKER-01", name: "Spanning Tree Stickers", qty: 10, unitPrice: 3 }],
      total: 30,
      status: "delivered",
      placedAt: "2026-04-05T16:20:00Z",
      notes: [],
      refunds: [],
    },
  ];
}

// Single global store. We attach to globalThis so Next.js dev mode HMR
// preserves state across reloads of this module.
const STORE_KEY = "__agentbridge_demo_orders__";
type Globals = typeof globalThis & { [STORE_KEY]?: Order[] };
const g = globalThis as Globals;
if (!g[STORE_KEY]) g[STORE_KEY] = makeOrders();
const orders: Order[] = g[STORE_KEY]!;

export function listOrders(filter?: { status?: OrderStatus }): Order[] {
  if (!filter?.status) return orders.slice();
  return orders.filter((o) => o.status === filter.status);
}

export function getOrder(id: string): Order | undefined {
  return orders.find((o) => o.id === id);
}

export function addNote(orderId: string, text: string, author = "agent"): OrderNote {
  const order = getOrder(orderId);
  if (!order) throw new Error(`Order not found: ${orderId}`);
  const note: OrderNote = {
    id: `n${Date.now()}`,
    author,
    text,
    createdAt: new Date().toISOString(),
  };
  order.notes.push(note);
  return note;
}

export interface RefundDraft {
  draftId: string;
  orderId: string;
  amount: number;
  reason: string;
  summary: string;
}

const drafts = new Map<string, OrderRefund & { orderId: string }>();

export function draftRefund(orderId: string, amount: number, reason: string): RefundDraft {
  const order = getOrder(orderId);
  if (!order) throw new Error(`Order not found: ${orderId}`);
  if (amount <= 0) throw new Error(`Refund amount must be positive (got ${amount})`);
  if (amount > order.total) {
    throw new Error(`Refund amount $${amount} exceeds order total $${order.total}`);
  }
  const draftId = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const draft: OrderRefund & { orderId: string } = {
    orderId,
    draftId,
    amount,
    reason,
    status: "drafted",
    draftedAt: new Date().toISOString(),
  };
  drafts.set(draftId, draft);
  order.refunds.push(draft);
  return {
    draftId,
    orderId,
    amount,
    reason,
    summary: `Refund $${amount} on order ${orderId} for reason: ${reason}. Awaiting confirmation.`,
  };
}

export function executeRefund(draftId: string): {
  simulated: true;
  draftId: string;
  orderId: string;
  amount: number;
  simulatedTransactionId: string;
  executedAt: string;
} {
  const draft = drafts.get(draftId);
  if (!draft) throw new Error(`Refund draft not found: ${draftId}`);
  if (draft.status === "executed") throw new Error(`Refund draft already executed: ${draftId}`);
  const order = getOrder(draft.orderId);
  if (!order) throw new Error(`Order vanished: ${draft.orderId}`);
  // Simulated: no payment integration. We mark the draft executed, set the
  // order to refunded, and return a fake transaction id.
  draft.status = "executed";
  draft.executedAt = new Date().toISOString();
  draft.simulatedTransactionId = `sim_tx_${Date.now()}`;
  order.status = "refunded";
  return {
    simulated: true,
    draftId: draft.draftId,
    orderId: draft.orderId,
    amount: draft.amount,
    simulatedTransactionId: draft.simulatedTransactionId,
    executedAt: draft.executedAt,
  };
}
