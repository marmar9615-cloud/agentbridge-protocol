"use client";

import { useState } from "react";
import { ActionForm } from "../../../components/ActionForm";
import { ConfirmModal } from "../../../components/ConfirmModal";

interface ActionRunnerProps {
  manifestUrl: string;
  action: any;
}

export function ActionRunner({ manifestUrl, action }: ActionRunnerProps) {
  const [input, setInput] = useState<Record<string, unknown>>({});
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmSummary, setConfirmSummary] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; data: unknown } | null>(null);

  async function execute(confirmationApproved: boolean) {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          manifestUrl,
          actionName: action.name,
          input,
          confirmationApproved,
        }),
      });
      const data = await res.json();
      setResult({ ok: res.ok && data.ok !== false, data });
    } catch (err) {
      setResult({ ok: false, data: { error: (err as Error).message } });
    } finally {
      setRunning(false);
      setShowConfirm(false);
    }
  }

  async function handleSubmit() {
    if (action.requiresConfirmation || action.risk !== "low") {
      // Ask the server for the confirmation summary first (it does the formal
      // gate). For preview, build it locally from the template.
      const summary = renderTemplate(action.humanReadableSummaryTemplate, input);
      setConfirmSummary(summary);
      setShowConfirm(true);
    } else {
      await execute(false);
    }
  }

  return (
    <div>
      <ActionForm schema={action.inputSchema} onChange={setInput} />
      <div className="row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
        <button
          type="button"
          className="btn"
          disabled={running}
          onClick={handleSubmit}
        >
          {running ? "Running..." : action.requiresConfirmation ? "Review & confirm" : "Run"}
        </button>
      </div>

      {showConfirm && (
        <ConfirmModal
          actionName={action.name}
          risk={action.risk}
          summary={confirmSummary}
          onCancel={() => setShowConfirm(false)}
          onConfirm={() => execute(true)}
        />
      )}

      {result && (
        <div className={result.ok ? "result-ok" : "result-err"} style={{ marginTop: 16 }}>
          <strong>{result.ok ? "Success" : "Error"}</strong>
          <pre style={{ marginTop: 8 }}>{JSON.stringify(result.data, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

function renderTemplate(template: string | undefined, input: Record<string, unknown>): string {
  if (!template) return "(no summary template provided)";
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const value = key.split(".").reduce<unknown>((acc, part) => {
      if (acc === null || typeof acc !== "object") return undefined;
      return (acc as Record<string, unknown>)[part];
    }, input);
    if (value === undefined || value === null) return "<unknown>";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  });
}
