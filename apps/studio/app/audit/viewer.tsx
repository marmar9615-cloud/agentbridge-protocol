"use client";

import { useMemo, useState } from "react";
import type { AuditEvent } from "@agentbridge/core";

type SourceFilter = "all" | "demo" | "studio" | "mcp";
type StatusFilter = "all" | "completed" | "confirmation_required" | "rejected" | "error";
type ConfirmFilter = "all" | "yes" | "no" | "missing";

export function AuditViewer({ initial }: { initial: AuditEvent[] }) {
  const [events, setEvents] = useState<AuditEvent[]>(initial);
  const [source, setSource] = useState<SourceFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [confirm, setConfirm] = useState<ConfirmFilter>("all");
  const [query, setQuery] = useState("");
  const [clearing, setClearing] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((e) => {
      if (source !== "all" && e.source !== source) return false;
      if (status !== "all" && e.status !== status) return false;
      if (confirm === "yes" && e.confirmationApproved !== true) return false;
      if (confirm === "no" && e.confirmationApproved !== false) return false;
      if (confirm === "missing" && e.confirmationApproved !== undefined) return false;
      if (!q) return true;
      return (
        e.actionName.toLowerCase().includes(q) ||
        (e.manifestUrl ?? "").toLowerCase().includes(q) ||
        JSON.stringify(e.input ?? {}).toLowerCase().includes(q)
      );
    });
  }, [events, source, status, confirm, query]);

  async function refresh() {
    const res = await fetch("/api/audit");
    const json = await res.json();
    setEvents(json.events ?? []);
  }

  async function clearLog() {
    const ok = window.confirm(
      "Clear the local audit log? This deletes data/audit.json on this machine. Cannot be undone.",
    );
    if (!ok) return;
    setClearing(true);
    try {
      const res = await fetch("/api/audit/clear", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEvents([]);
    } catch (err) {
      window.alert(`Failed to clear: ${(err as Error).message}`);
    } finally {
      setClearing(false);
    }
  }

  return (
    <div>
      <div className="search-bar">
        <input
          type="search"
          placeholder="Search by action, URL, or input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="btn btn-secondary" onClick={refresh}>
          Refresh
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={clearLog}
          disabled={clearing}
        >
          {clearing ? "Clearing..." : "Clear log"}
        </button>
      </div>

      <div className="filter-row">
        <span style={{ alignSelf: "center", fontSize: 12, color: "#6b7280" }}>Source:</span>
        {(["all", "demo", "studio", "mcp"] as SourceFilter[]).map((s) => (
          <button
            key={s}
            type="button"
            className={`filter-chip ${source === s ? "active" : ""}`}
            onClick={() => setSource(s)}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="filter-row">
        <span style={{ alignSelf: "center", fontSize: 12, color: "#6b7280" }}>Status:</span>
        {(["all", "completed", "confirmation_required", "rejected", "error"] as StatusFilter[]).map(
          (s) => (
            <button
              key={s}
              type="button"
              className={`filter-chip ${status === s ? "active" : ""}`}
              onClick={() => setStatus(s)}
            >
              {s}
            </button>
          ),
        )}
      </div>
      <div className="filter-row">
        <span style={{ alignSelf: "center", fontSize: 12, color: "#6b7280" }}>Confirmed:</span>
        {(["all", "yes", "no", "missing"] as ConfirmFilter[]).map((s) => (
          <button
            key={s}
            type="button"
            className={`filter-chip ${confirm === s ? "active" : ""}`}
            onClick={() => setConfirm(s)}
          >
            {s}
          </button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#6b7280" }}>
          {filtered.length} of {events.length} events
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="card empty">No events match.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Source</th>
                <th>Action</th>
                <th>Status</th>
                <th>Confirmed?</th>
                <th>Manifest</th>
                <th>Input</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.timestamp).toLocaleString()}</td>
                  <td>
                    <span className="pill">{e.source}</span>
                  </td>
                  <td>
                    <code>{e.actionName}</code>
                  </td>
                  <td>{e.status}</td>
                  <td>
                    {e.confirmationApproved === undefined
                      ? "—"
                      : String(e.confirmationApproved)}
                  </td>
                  <td>
                    <code style={{ fontSize: 11 }}>{e.manifestUrl ?? "—"}</code>
                  </td>
                  <td>
                    <code style={{ fontSize: 11 }}>
                      {JSON.stringify(e.input ?? {}).slice(0, 80)}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
