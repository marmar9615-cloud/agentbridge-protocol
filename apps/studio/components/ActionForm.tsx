"use client";

import { useState } from "react";

// Minimal JSON Schema → form renderer. Handles the shapes our demo manifest
// uses: object root with primitive properties (string, number, boolean, enum).
// Nested objects are rendered as fieldsets but aren't strictly necessary for
// the demo actions.

interface JsonSchemaProperty {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}

interface ObjectSchema {
  type?: "object";
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface ActionFormProps {
  schema: ObjectSchema;
  initial?: Record<string, unknown>;
  onChange: (input: Record<string, unknown>) => void;
}

export function ActionForm({ schema, initial = {}, onChange }: ActionFormProps) {
  const [values, setValues] = useState<Record<string, unknown>>(initial);

  const update = (key: string, value: unknown) => {
    const next = { ...values, [key]: value };
    setValues(next);
    onChange(next);
  };

  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);

  if (Object.keys(properties).length === 0) {
    return <p className="muted">This action takes no input.</p>;
  }

  return (
    <div>
      {Object.entries(properties).map(([key, prop]) => {
        const isRequired = required.has(key);
        const id = `field-${key}`;
        const label = (
          <label htmlFor={id}>
            {key}
            {isRequired && <span style={{ color: "#b91c1c" }}> *</span>}
            {prop.description && <span className="muted"> — {prop.description}</span>}
          </label>
        );
        const value = values[key] ?? "";

        if (prop.enum) {
          return (
            <div key={key}>
              {label}
              <select
                id={id}
                value={String(value)}
                onChange={(e) => update(key, e.target.value || undefined)}
              >
                <option value="">{isRequired ? "(select)" : "(any)"}</option>
                {prop.enum.map((opt) => (
                  <option key={String(opt)} value={String(opt)}>
                    {String(opt)}
                  </option>
                ))}
              </select>
            </div>
          );
        }

        const type = Array.isArray(prop.type) ? prop.type[0] : prop.type;
        if (type === "boolean") {
          return (
            <div key={key}>
              {label}
              <input
                id={id}
                type="checkbox"
                checked={Boolean(value)}
                onChange={(e) => update(key, e.target.checked)}
                style={{ width: "auto" }}
              />
            </div>
          );
        }
        if (type === "number" || type === "integer") {
          return (
            <div key={key}>
              {label}
              <input
                id={id}
                type="number"
                value={typeof value === "number" ? value : ""}
                min={prop.minimum}
                max={prop.maximum}
                onChange={(e) =>
                  update(key, e.target.value === "" ? undefined : Number(e.target.value))
                }
              />
            </div>
          );
        }
        // Default: string. Use textarea for longer strings.
        const isLong = (prop.maxLength ?? 0) > 80 || key === "note" || key === "reason";
        return (
          <div key={key}>
            {label}
            {isLong ? (
              <textarea
                id={id}
                value={String(value ?? "")}
                onChange={(e) => update(key, e.target.value || undefined)}
              />
            ) : (
              <input
                id={id}
                type="text"
                value={String(value ?? "")}
                onChange={(e) => update(key, e.target.value || undefined)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
