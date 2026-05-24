/*
 * ui/ActionSurface.tsx — structured-verb button list.
 *
 * WHAT: Renders the set of structured verbs the stage has derived from
 *       `schema × current state`. Each verb is { label, enabled, onClick }.
 *       The component does NOT derive which verbs are available — that is
 *       the stage's job. This component just renders what it's given.
 *
 * WHY: Wave 2E shell component (FRONTEND-SHAPE.md §"src/lib/ui/").
 *      "Structured input is the fast path" (FRONTEND-SHAPE.md §"The shape").
 *      The list of enabled verbs is the stage-derived affordance surface;
 *      this component makes it visible to the player.
 *
 * Styling: inline styles (repo convention).
 *
 * SHAPE:
 *   interface VerbEntry { id; label; enabled?; onClick; hint? }
 *   interface ActionSurfaceProps { verbs; columns?; style? }
 *   ActionSurface(props): ReactElement
 */

import { ReactElement, CSSProperties } from "react";

export interface VerbEntry {
  /** Unique id for the verb — used as React key. */
  id: string;
  /** Display label shown on the button. */
  label: string;
  /** Whether the action is currently available. Default true. */
  enabled?: boolean;
  /** Called when the user clicks the button. */
  onClick: () => void;
  /** Optional tooltip / one-line description. */
  hint?: string;
}

export interface ActionSurfaceProps {
  verbs: VerbEntry[];
  /** How many columns to lay out buttons in. Default 2. */
  columns?: number;
  style?: CSSProperties;
}

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

export function ActionSurface(props: ActionSurfaceProps): ReactElement {
  const { verbs, columns = 2, style } = props;

  return (
    <div style={{ ...container(columns), ...style }}>
      {verbs.map((v) => {
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
