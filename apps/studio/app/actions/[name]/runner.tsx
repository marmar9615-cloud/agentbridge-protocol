"use client";

import { useMemo, useState } from "react";
import { ActionForm } from "../../../components/ActionForm";
import { ConfirmModal } from "../../../components/ConfirmModal";
import { CopyButton } from "../../../components/CopyButton";

interface ActionRunnerProps {
  manifestUrl: string;
  action: any;
}

type Mode = "form" | "json";
type CallResult = {
  ok: boolean;
  status?: string;
  data: unknown;
};

export function ActionRunner({ manifestUrl, action }: ActionRunnerProps) {
  const [mode, setMode] = useState<Mode>("form");
  const [formInput, setFormInput] = useState<Record<string, unknown>>({});
  const [jsonText, setJsonText] = useState<string>("{}");
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmSummary, setConfirmSummary] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CallResult | null>(null);
  const [auditEntry, setAuditEntry] = useState<unknown>(null);

  const isRisky = action.requiresConfirmation || action.risk !== "low";

  // Compute the live input depending on which mode the user is in.
  const liveInput = useMemo<Record<string, unknown>>(() => {
    if (mode === "form") return formInput;
    try {
      const parsed = JSON.parse(jsonText);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }, [mode, formInput, jsonText]);

  const livePreview = useMemo(
    () => renderTemplate(action.humanReadableSummaryTemplate, liveInput),
    [action.humanReadableSummaryTemplate, liveInput],
  );

  const jsonValid = useMemo(() => {
    if (mode !== "json") return true;
    try {
      const parsed = JSON.parse(jsonText);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed);
    } catch {
      return false;
    }
  }, [mode, jsonText]);

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
          input: liveInput,
          confirmationApproved,
        }),
      });
      const data = await res.json();
      setResult({
        ok: res.ok && data.status !== "error",
        status: data.status,
        data,
      });
      // Pull the latest audit entry for this action so the user sees it.
      const auditRes = await fetch(
        `/api/audit?url=${encodeURIComponent(manifestUrl)}`,
      );
      const auditJson = await auditRes.json();
      const recent = (auditJson.events ?? []).find(
        (e: any) => e.actionName === action.name,
      );
      setAuditEntry(recent ?? null);
    } catch (err) {
      setResult({ ok: false, data: { error: (err as Error).message } });
    } finally {
      setRunning(false);
      setShowConfirm(false);
    }
  }

  async function handleSubmit() {
    if (mode === "json" && !jsonValid) {
      setResult({ ok: false, data: { error: "JSON input is not a valid object." } });
      return;
    }
    if (isRisky) {
      setConfirmSummary(livePreview);
      setShowConfirm(true);
    } else {
      await execute(false);
    }
  }

  // Used to inspect a structured field of the result (for "structured" tab).
  const structuredResult: unknown =
    result && (result.data as any)?.result !== undefined
      ? (result.data as any).result
      : undefined;

  return (
    <div>
      <div className="tabs">
        <button
          type="button"
          className={`tab ${mode === "form" ? "active" : ""}`}
          onClick={() => setMode("form")}
        >
          Form
        </button>
        <button
          type="button"
          className={`tab ${mode === "json" ? "active" : ""}`}
          onClick={() => {
            // Sync JSON pane to current form input when switching.
            setJsonText(JSON.stringify(formInput, null, 2));
            setMode("json");
          }}
        >
          Raw JSON
        </button>
      </div>

      {mode === "form" ? (
        <ActionForm schema={action.inputSchema} onChange={setFormInput} />
      ) : (
        <textarea
          className={`json-editor ${jsonValid ? "" : "invalid"}`}
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          spellCheck={false}
        />
      )}

      {action.humanReadableSummaryTemplate && (
        <div
          className="muted"
          style={{ fontSize: 13, marginTop: 12 }}
          aria-label="Live summary preview"
        >
          <strong>Summary:</strong> {livePreview}
        </div>
      )}

      <div
        className="row"
        style={{ marginTop: 16, justifyContent: "flex-end", gap: 8 }}
      >
        <CopyButton text={JSON.stringify(liveInput, null, 2)} label="Copy input" />
        <button
          type="button"
          className="btn"
          disabled={running || (mode === "json" && !jsonValid)}
          onClick={handleSubmit}
        >
          {running
            ? "Running..."
            : isRisky
              ? "Review & confirm"
              : "Run"}
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
          {result.status && <span className="muted"> · status: {result.status}</span>}
          {structuredResult !== undefined && (
            <>
              <h3 style={{ marginTop: 12 }}>Structured result</h3>
              <pre style={{ marginTop: 8 }}>
                {JSON.stringify(structuredResult, null, 2)}
              </pre>
            </>
          )}
          <h3 style={{ marginTop: 12 }}>Raw response</h3>
          <pre style={{ marginTop: 8 }}>{JSON.stringify(result.data, null, 2)}</pre>
        </div>
      )}

      {auditEntry !== null && auditEntry !== undefined && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Audit entry</h3>
          <pre>{JSON.stringify(auditEntry, null, 2)}</pre>
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
