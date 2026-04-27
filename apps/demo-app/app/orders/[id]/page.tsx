import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrder } from "../../../lib/orders";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export default async function OrderDetailPage({ params }: Params) {
  const { id } = await params;
  const order = getOrder(id);
  if (!order) notFound();

  return (
    <div>
      <p className="muted">
        <Link href="/orders">← Back to orders</Link>
      </p>
      <h1>
        {order.id} <span className={`pill pill-status-${order.status}`}>{order.status}</span>
      </h1>

      <div className="card">
        <h2>Customer</h2>
        <p>
          {order.customer.name} · <span className="muted">{order.customer.email}</span>
        </p>
        <p className="muted">Placed {new Date(order.placedAt).toLocaleString()}</p>
      </div>

      <div className="card">
        <h2>Items</h2>
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Name</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.sku}>
                <td>
                  <code>{item.sku}</code>
                </td>
                <td>{item.name}</td>
                <td>{item.qty}</td>
                <td>${item.unitPrice}</td>
                <td>${item.qty * item.unitPrice}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={4} style={{ textAlign: "right", fontWeight: 600 }}>
                Total
              </td>
              <td style={{ fontWeight: 600 }}>${order.total}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Internal notes ({order.notes.length})</h2>
        {order.notes.length === 0 ? (
          <p className="muted">No notes yet.</p>
        ) : (
          order.notes.map((n) => (
            <div key={n.id} className="note">
              <strong>{n.author}</strong> · {new Date(n.createdAt).toLocaleString()}
              <div>{n.text}</div>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <h2>Refunds ({order.refunds.length})</h2>
        {order.refunds.length === 0 ? (
          <p className="muted">No refund drafts or executions.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Draft ID</th>
                <th>Amount</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Tx</th>
              </tr>
            </thead>
            <tbody>
              {order.refunds.map((r) => (
                <tr key={r.draftId}>
                  <td>
                    <code>{r.draftId}</code>
                  </td>
                  <td>${r.amount}</td>
                  <td>{r.reason}</td>
                  <td>{r.status}</td>
                  <td>{r.simulatedTransactionId ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
