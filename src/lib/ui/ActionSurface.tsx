/*
 * ui/ActionSurface.tsx — structured-verb button grid.
 *
 * WHAT: Renders the set of available verbs as a button grid. Supports two
 *       usage modes:
 *
 *   Legacy path (pre-Wave-2E call sites):
 *     Pass `verbs: VerbEntry[]` — each entry has its own `onClick`.
 *     ActionSurface renders them as-is. No introspect contract involved.
 *
 *   Introspect path (recommended for new stages):
 *     Pass `availableVerbs`, `onVerbInvoke`, and optionally `verbFilter` /
 *     `pending`. ActionSurface derives buttons from `VerbDescriptor[]` and
 *     routes clicks through `onVerbInvoke`. This is the same `IntrospectAware`
 *     contract used by ChoiceList, FormBuilder, and SlotPicker.
 *
 *   Both paths are backward-compatible. `verbs` and introspect props can
 *   coexist; introspect-derived buttons are appended after any legacy `verbs`.
 *
 * WHY: Wave 2E §7 retrofit. The audit (UX-AUDIT §3.8 / Phase 5 Blocker #1)
 *      found that world-primary rendered verb buttons wired to no-ops because
 *      ActionSurface had no introspect contract. Retrofit instead of adding a
 *      15th component (design doc §7). Existing call sites pass `verbs` arrays
 *      pre-wired by the stage's `deriveVerbs()` helper — those continue to work
 *      unchanged.
 *
 * Styling: inline styles (repo convention).
 *
 * SHAPE:
 *   interface VerbEntry       { id; label; enabled?; onClick; hint? }  ← legacy
 *   interface IntrospectAware { availableVerbs?; onVerbInvoke?; verbFilter?; pending? }
 *   interface ActionSurfaceProps extends IntrospectAware
 *     { verbs?; columns?; style? }
 *   ActionSurface(props): ReactElement
 */

import { ReactElement, CSSProperties } from "react";
import type { IntrospectAware } from "./introspect-aware";

// ---- Legacy VerbEntry (kept for backward compatibility) ----

export interface VerbEntry {
  /** Unique id — used as React key. */
  id: string;
  /** Display label shown on the button. */
  label: string;
  /** Whether the action is currently available. Default true. */
  enabled?: boolean;
  /** Called when the user clicks the button (legacy path). */
  onClick: () => void;
  /** Optional tooltip / one-line description. */
  hint?: string;
}

export interface ActionSurfaceProps extends IntrospectAware {
  /** Legacy verb entries. Each carries its own `onClick`. Rendered first.
   *  Remains the path used by world-primary's `deriveVerbs()` helper, which
   *  pre-wires `onClick` to `this.invokeVerb` — backward-compatible with
   *  the introspect contract in effect. */
  verbs?: VerbEntry[];
  /** How many columns to lay out buttons in. Default 2. */
  columns?: number;
  style?: CSSProperties;
}

// ---- Styles ----

const container = (columns: number): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: `repeat(${columns}, 1fr)`,
  gap: "6px",
});

const btn = (enabled: boolean): CSSProperties => ({
  fontFamily: "ui-monospace, monospace",
  fontSize: "12px",
  padding: "6px 10px",
  background: enabled ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)",
  color: enabled ? "#ddd" : "#555",
  border: `1px solid ${enabled ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.06)"}`,
  borderRadius: "4px",
  cursor: enabled ? "pointer" : "not-allowed",
  textAlign: "left",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  transition: "background 0.1s ease",
});

// ---- Component ----

export function ActionSurface(props: ActionSurfaceProps): ReactElement {
  const {
    verbs = [],
    columns = 2,
    style,
    // introspect props
    availableVerbs,
    onVerbInvoke,
    verbFilter,
    pending = false,
  } = props;

  // Derive introspect-path buttons when availableVerbs is provided.
  const introspectButtons: VerbEntry[] = availableVerbs
    ? availableVerbs
        .filter(verbFilter ?? (() => true))
        .map((v) => ({
          id: v.name,
          label: v.label ?? v.name,
          enabled: v.enabled !== false && !pending,
          hint: v.description,
          onClick: () => {
            if (onVerbInvoke) void onVerbInvoke(v.name);
          },
        }))
    : [];

  // Legacy buttons respect `pending` (disable them while processing).
  const legacyButtons: VerbEntry[] = verbs.map((v) => ({
    ...v,
    enabled: v.enabled !== false && !pending,
  }));

  // Introspect-derived buttons after legacy ones. If a stage uses
  // `deriveVerbs()` (as world-primary does), it passes legacy VerbEntry[]
  // pre-wired to invokeVerb — introspectButtons will be empty. If a stage
  // passes `availableVerbs` directly, legacyButtons will be empty.
  const allButtons = [...legacyButtons, ...introspectButtons];

  return (
    <div style={{ ...container(columns), ...style }}>
      {allButtons.map((v) => {
        const isEnabled = v.enabled !== false;
        return (
          <button
            key={v.id}
            style={btn(isEnabled)}
            disabled={!isEnabled}
            title={v.hint}
            onClick={isEnabled ? v.onClick : undefined}
            onMouseEnter={(e) => {
              if (isEnabled) {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "rgba(255,255,255,0.16)";
              }
            }}
            onMouseLeave={(e) => {
              if (isEnabled) {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "rgba(255,255,255,0.1)";
              }
            }}
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
