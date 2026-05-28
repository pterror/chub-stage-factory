/*
 * ui/FormBuilder.tsx — generic structured form input.
 *
 * WHAT: Renders a labeled set of inputs (string, number, boolean, enum) for
 *       managerial / configuration stages and submits them as a verb
 *       invocation with `args` matching the form fields. Includes the
 *       `formFieldsFromVerb(descriptor)` helper to derive fields directly
 *       from a VerbDescriptor's `args` array.
 *
 * WHY: Wave 2E Batch C. Closes the orphan-button gap for data-entry surfaces:
 *      the submit button always routes through `onVerbInvoke` (introspect
 *      path) or `onSubmit` (plain path). No dead submit buttons.
 *
 * SHAPE:
 *   interface FormField { name; label; type; required?; enum?; default?; hint? }
 *   interface FormBuilderProps extends IntrospectAware
 *     { verb; fields; submitLabel?; onSubmit?; style? }
 *   FormBuilder(props): ReactElement
 *   formFieldsFromVerb(v: VerbDescriptor): FormField[]
 */

import { ReactElement, CSSProperties, useState } from "react";
import type { VerbDescriptor } from "../introspect";
import type { IntrospectAware } from "./introspect-aware";

// ---- FormField types ----

export interface FormField {
  /** Maps directly to `VerbArg.name`. */
  name: string;
  /** Human-readable label for the input. */
  label: string;
  /** Input type discriminator. */
  type: "string" | "number" | "boolean" | "enum";
  /** Whether the field must be filled before submit. */
  required?: boolean;
  /** Allowed values when `type === "enum"`. */
  enum?: string[];
  /** Pre-filled default value. */
  default?: unknown;
  /** Hint shown beneath the input. */
  hint?: string;
}

export interface FormBuilderProps extends IntrospectAware {
  /** Verb name this form submits to. */
  verb: string;
  /** Fields to render. Use `formFieldsFromVerb(descriptor)` to derive. */
  fields: FormField[];
  /** Label on the submit button. Default "Submit". */
  submitLabel?: string;
  /** Called with `values` on submit (plain path; no introspect required). */
  onSubmit?: (values: Record<string, unknown>) => void;
  style?: CSSProperties;
}

// ---- Helper ----

/**
 * Derive `FormField[]` from a `VerbDescriptor`'s args. Convenience for
 * stages that want one-line form construction:
 *   `fields={formFieldsFromVerb(verbs.find(v => v.name === "set-policy")!)}`
 */
export function formFieldsFromVerb(v: VerbDescriptor): FormField[] {
  if (!v.args) return [];
  return v.args.map((a) => ({
    name: a.name,
    label: a.name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    type: a.type,
    required: a.required,
    enum: a.enum,
    hint: a.description,
  }));
}

// ---- Styles ----

const formStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  fontFamily: "ui-monospace, monospace",
  fontSize: "13px",
  color: "#ddd",
};

const fieldGroupStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "3px",
};

const labelStyle: CSSProperties = {
  fontSize: "11px",
  color: "#aaa",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const inputStyle: CSSProperties = {
  fontFamily: "ui-monospace, monospace",
  fontSize: "13px",
  padding: "5px 8px",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "4px",
  color: "#ddd",
  outline: "none",
};

const selectStyle: CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
};

const checkboxRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
};

const hintTextStyle: CSSProperties = {
  fontSize: "11px",
  color: "#777",
};

const submitStyle = (enabled: boolean): CSSProperties => ({
  fontFamily: "ui-monospace, monospace",
  fontSize: "13px",
  padding: "7px 14px",
  background: enabled ? "rgba(100,180,100,0.15)" : "rgba(255,255,255,0.04)",
  color: enabled ? "#9d9" : "#555",
  border: `1px solid ${enabled ? "rgba(100,180,100,0.3)" : "rgba(255,255,255,0.06)"}`,
  borderRadius: "4px",
  cursor: enabled ? "pointer" : "not-allowed",
  alignSelf: "flex-end",
  marginTop: "4px",
  transition: "background 0.1s ease",
});

// ---- Component ----

type FieldValues = Record<string, unknown>;

function initialValues(fields: FormField[]): FieldValues {
  const out: FieldValues = {};
  for (const f of fields) {
    if (f.default !== undefined) {
      out[f.name] = f.default;
    } else if (f.type === "boolean") {
      out[f.name] = false;
    } else if (f.type === "number") {
      out[f.name] = 0;
    } else if (f.type === "enum" && f.enum?.[0] !== undefined) {
      out[f.name] = f.enum[0];
    } else {
      out[f.name] = "";
    }
  }
  return out;
}

export function FormBuilder(props: FormBuilderProps): ReactElement {
  const {
    verb,
    fields,
    submitLabel = "Submit",
    onSubmit,
    onVerbInvoke,
    availableVerbs,
    verbFilter,
    pending = false,
    style,
  } = props;

  const [values, setValues] = useState<FieldValues>(() => initialValues(fields));

  // Check whether the target verb is available/enabled.
  const verbAvailable = availableVerbs
    ? (availableVerbs ?? [])
        .filter(verbFilter ?? (() => true))
        .some((v) => v.name === verb && v.enabled !== false)
    : true; // no availableVerbs supplied → assume available (plain mode)

  const canSubmit = !pending && verbAvailable;

  function setValue(name: string, value: unknown): void {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  function handleSubmit(): void {
    if (!canSubmit) return;
    // Introspect path.
    if (onVerbInvoke) {
      void onVerbInvoke(verb, { ...values });
      return;
    }
    // Plain path.
    onSubmit?.({ ...values });
  }

  function renderField(field: FormField): ReactElement {
    const value = values[field.name];

    if (field.type === "boolean") {
      return (
        <div key={field.name} style={fieldGroupStyle}>
          <div style={checkboxRowStyle}>
            <input
              type="checkbox"
              id={`ff-${field.name}`}
              checked={Boolean(value)}
              onChange={(e) => setValue(field.name, e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            <label htmlFor={`ff-${field.name}`} style={{ cursor: "pointer", color: "#ddd" }}>
              {field.label}{field.required ? " *" : ""}
            </label>
          </div>
          {field.hint && <span style={hintTextStyle}>{field.hint}</span>}
        </div>
      );
    }

    if (field.type === "enum" && field.enum) {
      return (
        <div key={field.name} style={fieldGroupStyle}>
          <label style={labelStyle}>{field.label}{field.required ? " *" : ""}</label>
          <select
            style={selectStyle}
            value={String(value)}
            onChange={(e) => setValue(field.name, e.target.value)}
          >
            {field.enum.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          {field.hint && <span style={hintTextStyle}>{field.hint}</span>}
        </div>
      );
    }

    if (field.type === "number") {
      return (
        <div key={field.name} style={fieldGroupStyle}>
          <label style={labelStyle}>{field.label}{field.required ? " *" : ""}</label>
          <input
            type="number"
            style={inputStyle}
            value={String(value)}
            onChange={(e) => setValue(field.name, Number(e.target.value))}
          />
          {field.hint && <span style={hintTextStyle}>{field.hint}</span>}
        </div>
      );
    }

    // Default: string
    return (
      <div key={field.name} style={fieldGroupStyle}>
        <label style={labelStyle}>{field.label}{field.required ? " *" : ""}</label>
        <input
          type="text"
          style={inputStyle}
          value={String(value)}
          onChange={(e) => setValue(field.name, e.target.value)}
          onFocus={(e) => {
            (e.currentTarget as HTMLInputElement).style.borderColor =
              "rgba(255,255,255,0.3)";
          }}
          onBlur={(e) => {
            (e.currentTarget as HTMLInputElement).style.borderColor =
              "rgba(255,255,255,0.12)";
          }}
        />
        {field.hint && <span style={hintTextStyle}>{field.hint}</span>}
      </div>
    );
  }

  return (
    <div style={{ ...formStyle, ...style }}>
      {fields.map((f) => renderField(f))}
      <button
        style={submitStyle(canSubmit)}
        disabled={!canSubmit}
        onClick={handleSubmit}
        onMouseEnter={(e) => {
          if (canSubmit) {
            (e.currentTarget as HTMLButtonElement).style.background =
              "rgba(100,180,100,0.25)";
          }
        }}
        onMouseLeave={(e) => {
          if (canSubmit) {
            (e.currentTarget as HTMLButtonElement).style.background =
              "rgba(100,180,100,0.15)";
          }
        }}
      >
        {submitLabel}
      </button>
    </div>
  );
}
