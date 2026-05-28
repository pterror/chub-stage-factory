/*
 * ui/ChoiceList.tsx — numbered exclusive-pick surface.
 *
 * WHAT: Vertical option picker for dialogue choices, action menus,
 *       multiple-choice prompts. Each choice can route through a verb
 *       invocation (introspect-aware path) or a plain `onPick` callback.
 *       Miller-capped at `maxItems` (default 7) with a "more…" expand.
 *
 * WHY: Wave 2E Batch C. Distinct from ActionSurface (free-form button grid):
 *      ChoiceList is a *numbered, exclusive-pick* surface — the dialogue-choice
 *      shape. Closes the orphan-button gap: every rendered option either
 *      invokes a verb via `onVerbInvoke` or calls `onPick`; no dead buttons.
 *
 * SHAPE:
 *   interface Choice        { id; label; hint?; verb?; verbArgs?; enabled? }
 *   interface ChoiceListProps extends IntrospectAware
 *     { choices; numbered?; maxItems?; onPick?; style? }
 *   ChoiceList(props): ReactElement
 */

import { ReactElement, CSSProperties, useState } from "react";
import type { VerbDescriptor, InvocationResult } from "../introspect";

// ---- IntrospectAware contract (shared across Batch C) ----

export interface IntrospectAware {
  /** Verbs to surface. When omitted and `stage` is provided, the
   *  component will call `stage.availableVerbs()` itself. */
  availableVerbs?: VerbDescriptor[];
  /** Called when the user picks a verb. */
  onVerbInvoke?: (name: string, args?: Record<string, unknown>) =>
    Promise<InvocationResult> | void;
  /** Optional filter applied to `availableVerbs` before render. */
  verbFilter?: (v: VerbDescriptor) => boolean;
  /** Disabled state while a previous invocation is in flight. */
  pending?: boolean;
}

// ---- ChoiceList-specific types ----

export interface Choice {
  /** Unique id — used as React key and as `{ choice: id }` arg default. */
  id: string;
  /** Display label. */
  label: string;
  /** Optional hint shown beneath the label (e.g. cost). */
  hint?: string;
  /** Verb to invoke when selected. If omitted, calls `onPick`. */
  verb?: string;
  /** Verb args; extends / overrides the default `{ choice: id }`. */
  verbArgs?: Record<string, unknown>;
  /** When false, choice is shown but disabled. Default true. */
  enabled?: boolean;
}

export interface ChoiceListProps extends IntrospectAware {
  choices: Choice[];
  /** Number the choices (1., 2., …). Default true. */
  numbered?: boolean;
  /** Maximum choices shown before "more…" expand. Default 7 (Miller). */
  maxItems?: number;
  /** Called when a choice is picked (no-introspect path). */
  onPick?: (choice: Choice) => void;
  style?: CSSProperties;
}

// ---- Styles ----

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  fontFamily: "ui-monospace, monospace",
  fontSize: "13px",
};

const itemStyle = (enabled: boolean): CSSProperties => ({
  display: "flex",
  flexDirection: "column",
  padding: "6px 10px",
  background: enabled ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.02)",
  border: `1px solid ${enabled ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.05)"}`,
  borderRadius: "4px",
  cursor: enabled ? "pointer" : "not-allowed",
  color: enabled ? "#ddd" : "#555",
  textAlign: "left",
  transition: "background 0.1s ease",
});

const hintStyle: CSSProperties = {
  fontSize: "11px",
  color: "#888",
  marginTop: "2px",
};

const moreStyle: CSSProperties = {
  padding: "4px 10px",
  background: "none",
  border: "none",
  color: "#888",
  fontFamily: "ui-monospace, monospace",
  fontSize: "12px",
  cursor: "pointer",
  textAlign: "left",
};

// ---- Component ----

export function ChoiceList(props: ChoiceListProps): ReactElement {
  const {
    choices,
    numbered = true,
    maxItems = 7,
    onPick,
    onVerbInvoke,
    availableVerbs,
    verbFilter,
    pending = false,
    style,
  } = props;

  const [expanded, setExpanded] = useState(false);

  // Determine which verbs are enabled via introspect contract.
  const enabledVerbs = new Set(
    (availableVerbs ?? [])
      .filter(verbFilter ?? (() => true))
      .filter((v) => v.enabled !== false)
      .map((v) => v.name),
  );

  const visible = expanded ? choices : choices.slice(0, maxItems);
  const hiddenCount = choices.length - maxItems;

  function handlePick(choice: Choice): void {
    if (choice.enabled === false || pending) return;

    // If the choice specifies a verb AND we have an invoke handler, use it.
    if (choice.verb && onVerbInvoke) {
      const args = { choice: choice.id, ...choice.verbArgs };
      void onVerbInvoke(choice.verb, args);
      return;
    }
    // If no verb but we have an invoke handler and a verb set, check if the
    // choice id matches an available verb name directly.
    if (!choice.verb && onVerbInvoke && enabledVerbs.has(choice.id)) {
      void onVerbInvoke(choice.id, { choice: choice.id, ...choice.verbArgs });
      return;
    }
    // Fall back to plain onPick callback.
    onPick?.(choice);
  }

  function isEffectivelyEnabled(choice: Choice): boolean {
    if (choice.enabled === false) return false;
    if (pending) return false;
    // If there's a verb and we have availableVerbs to check, gate on it.
    if (choice.verb && availableVerbs) {
      return enabledVerbs.has(choice.verb);
    }
    return true;
  }

  return (
    <div style={{ ...listStyle, ...style }}>
      {visible.map((choice, idx) => {
        const on = isEffectivelyEnabled(choice);
        const prefix = numbered ? `${idx + 1}. ` : "";
        return (
          <button
            key={choice.id}
            style={itemStyle(on)}
            disabled={!on}
            title={choice.hint}
            onClick={() => handlePick(choice)}
            onMouseEnter={(e) => {
              if (on) {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "rgba(255,255,255,0.12)";
              }
            }}
            onMouseLeave={(e) => {
              if (on) {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "rgba(255,255,255,0.07)";
              }
            }}
          >
            <span>{prefix}{choice.label}</span>
            {choice.hint && <span style={hintStyle}>{choice.hint}</span>}
          </button>
        );
      })}
      {!expanded && hiddenCount > 0 && (
        <button style={moreStyle} onClick={() => setExpanded(true)}>
          more… ({hiddenCount} hidden)
        </button>
      )}
    </div>
  );
}
