"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type RiskFilter = "all" | "low" | "medium" | "high";

export function ActionsBrowser({
  url,
  actions,
}: {
  url: string;
  actions: Array<{
    name: string;
    title: string;
    description: string;
    risk: "low" | "medium" | "high";
    requiresConfirmation: boolean;
    permissions?: { scope: string }[];
  }>;
}) {
  const [risk, setRisk] = useState<RiskFilter>("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return actions.filter((a) => {
      if (risk !== "all" && a.risk !== risk) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        a.title.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q)
      );
    });
  }, [actions, risk, query]);

  return (
    <div>
      <div className="search-bar">
        <input
          type="search"
          placeholder="Search by name, title, or description"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="filter-row">
        {(["all", "low", "medium", "high"] as RiskFilter[]).map((r) => (
          <button
            key={r}
            type="button"
            className={`filter-chip ${risk === r ? "active" : ""}`}
            onClick={() => setRisk(r)}
          >
            {r === "all" ? "All risks" : `Risk: ${r}`}
          </button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#6b7280" }}>
          {filtered.length} of {actions.length} actions
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="card empty">No actions match.</div>
      ) : (
        filtered.map((action) => (
          <Link
            key={action.name}
            href={`/actions/${action.name}?url=${encodeURIComponent(url)}`}
            style={{ color: "inherit", textDecoration: "none" }}
          >
            <div className="card action-card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <strong>
                    <code>{action.name}</code>
                  </strong>{" "}
                  — {action.title}
                </div>
                <div>
                  <span className={`pill pill-${action.risk}`}>{action.risk}</span>
                  {action.requiresConfirmation && (
                    <span className="pill" style={{ marginLeft: 6 }}>
                      confirm
                    </span>
                  )}
                  {action.permissions && action.permissions.length > 0 && (
                    <span className="pill" style={{ marginLeft: 6 }}>
                      {action.permissions.length} perm
                      {action.permissions.length === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              </div>
              <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
                {action.description}
              </p>
            </div>
          </Link>
        ))
      )}
    </div>
  );
}
