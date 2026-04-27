"use client";

import { useState } from "react";

export interface ConfirmModalProps {
  actionName: string;
  risk: "low" | "medium" | "high";
  summary: string;
  onCancel: () => void;
  onConfirm: () => void;
}

// Forces the operator to type CONFIRM before high/medium-risk actions execute.
// This is the same gate the MCP server enforces for confirmationApproved=true.
export function ConfirmModal({
  actionName,
  risk,
  summary,
  onCancel,
  onConfirm,
}: ConfirmModalProps) {
  const [confirmText, setConfirmText] = useState("");
  const ready = confirmText.trim() === "CONFIRM";

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>
          Confirm <code>{actionName}</code>{" "}
          <span className={`pill pill-${risk}`}>{risk}</span>
        </h2>
        <p>{summary}</p>
        <p className="muted">
          This action requires explicit confirmation. Type <code>CONFIRM</code> to proceed.
        </p>
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="CONFIRM"
          autoFocus
        />
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${risk === "high" ? "btn-danger" : ""}`}
            disabled={!ready}
            onClick={onConfirm}
          >
            {ready ? "Execute" : "Type CONFIRM to execute"}
          </button>
        </div>
      </div>
    </div>
  );
}
