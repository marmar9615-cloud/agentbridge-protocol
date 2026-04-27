import Link from "next/link";
import { listOrders } from "../../lib/orders";

export const dynamic = "force-dynamic";

export default function OrdersPage() {
  const orders = listOrders();
  return (
    <div>
      <h1>Orders</h1>
      <p className="muted">
        {orders.length} orders. Click any row to see details, notes, and refund history.
      </p>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Customer</th>
              <th>Items</th>
              <th>Total</th>
              <th>Status</th>
              <th>Placed</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link href={`/orders/${o.id}`}>{o.id}</Link>
                </td>
                <td>{o.customer.name}</td>
                <td>{o.items.reduce((n, i) => n + i.qty, 0)}</td>
                <td>${o.total}</td>
                <td>
                  <span className={`pill pill-status-${o.status}`}>{o.status}</span>
                </td>
                <td>{new Date(o.placedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
