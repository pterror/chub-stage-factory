/*
 * ui/FreeformInput.tsx — controlled text field with submit callback.
 *
 * WHAT: A controlled text input + submit button. Submit fires on button
 *       click or Enter key. The component does not know about
 *       `freeformPipeline`; the stage wires the `onSubmit` callback.
 *       Text is cleared after a successful submit by default (configurable).
 *
 * WHY: Wave 2E shell component (FRONTEND-SHAPE.md §"src/lib/ui/").
 *      "FreeformInput: text field with submit callback."
 *      "Freeform is the escape hatch" — this is the escape-hatch input.
 *
 * Styling: inline styles (repo convention).
 *
 * SHAPE:
 *   interface FreeformInputProps
 *     { onSubmit; placeholder?; disabled?; clearOnSubmit?; style? }
 *   FreeformInput(props): ReactElement
 */

import { ReactElement, useState, KeyboardEvent, CSSProperties } from "react";

export interface FreeformInputProps {
  /** Called with the trimmed text value when the user submits. */
  onSubmit: (text: string) => void;
  placeholder?: string;
  /** When true, the field and button are non-interactive. */
  disabled?: boolean;
  /** Clear the field after submit. Default true. */
  clearOnSubmit?: boolean;
  style?: CSSProperties;
}

const container: CSSProperties = {
  display: "flex",
  gap: "6px",
  alignItems: "stretch",
};

const input = (disabled: boolean): CSSProperties => ({
  flex: 1,
  fontFamily: "ui-monospace, monospace",
  fontSize: "13px",
  padding: "8px 10px",
  background: "rgba(255,255,255,0.06)",
  color: disabled ? "#555" : "#ddd",
  border: `1px solid ${disabled ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.14)"}`,
  borderRadius: "4px",
  outline: "none",
  caretColor: "#aaa",
});

const submitBtn = (disabled: boolean): CSSProperties => ({
  fontFamily: "ui-monospace, monospace",
  fontSize: "12px",
  padding: "8px 14px",
  background: disabled ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.12)",
  color: disabled ? "#555" : "#ccc",
  border: `1px solid ${disabled ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.18)"}`,
  borderRadius: "4px",
  cursor: disabled ? "not-allowed" : "pointer",
  whiteSpace: "nowrap",
});

export function FreeformInput(props: FreeformInputProps): ReactElement {
  const {
    onSubmit,
    placeholder = "Type anything…",
    disabled = false,
    clearOnSubmit = true,
    style,
  } = props;

  const [value, setValue] = useState("");

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    if (clearOnSubmit) setValue("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div style={{ ...container, ...style }}>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        style={input(disabled)}
      />
      <button
        disabled={disabled || !value.trim()}
        onClick={handleSubmit}
        style={submitBtn(disabled || !value.trim())}
      >
        Send
      </button>
    </div>
  );
}
