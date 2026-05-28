/*
 * ui/BodyDiagram.tsx — actor body slot silhouette with per-slot annotations.
 *
 * WHAT: Renders an actor's body slots as either a humanoid silhouette (ASCII
 *       figure with labelled slot positions) or a vertical list fallback for
 *       non-humanoid bodies. Each slot shows its state as a color/style and
 *       an optional player-facing detail string. Slot clicks invoke a verb
 *       (bridged via onVerbInvoke) or call onSlotClick.
 *
 * WHY: Wave 2E Batch A (WAVE-2E-DESIGN.md §3.5). Replaces raw tag-string
 *      render ("furred, prehensile-mild, tail-cat") that the UX audit flagged
 *      as dev-surface leak in tits-body. The stage author is responsible for
 *      converting raw tags to human-readable `detail` strings; this component
 *      only renders what it is given.
 *
 * SHAPE:
 *   interface BodySlot { id; label; state?; detail?; verb? }
 *   interface BodyDiagramProps extends IntrospectAware
 *     { slots; layout?; onSlotClick?; style? }
 *   BodyDiagram(props): ReactElement
 */

import { ReactElement, CSSProperties } from "react";
import type { IntrospectAware } from "./introspect-aware";

export interface BodySlot {
  /** Stable slot id ("head", "torso", "tail", …). */
  id: string;
  /** Display name. */
  label: string;
  /** Visual state. Default "natural". */
  state?: "empty" | "natural" | "modified" | "equipped" | "missing";
  /** Player-facing description. NOT raw tags. */
  detail?: string;
  /** Verb to invoke on slot click (e.g. "examine" or "unequip"). */
  verb?: string;
}

export interface BodyDiagramProps extends IntrospectAware {
  slots: BodySlot[];
  /** "humanoid" positions slots on a person silhouette;
   *  "list" renders a vertical list. Default "humanoid". */
  layout?: "humanoid" | "list";
  onSlotClick?: (slot: BodySlot) => void;
  style?: CSSProperties;
}

// State → color mapping
const STATE_COLORS: Record<NonNullable<BodySlot["state"]>, string> = {
  empty: "#444",
  natural: "#6a9",
  modified: "#b86",
  equipped: "#58c",
  missing: "#644",
};

const STATE_LABELS: Record<NonNullable<BodySlot["state"]>, string> = {
  empty: "empty",
  natural: "natural",
  modified: "modified",
  equipped: "equipped",
  missing: "missing",
};

// Humanoid silhouette: ordered slot ids to ASCII position.
// The component looks up slot by id (case-insensitive) to assign position.
// Slots not in this list fall through to the list view.
const HUMANOID_ORDER = ["head", "neck", "torso", "arms", "hands", "waist", "legs", "feet", "tail"];

const outerStyle: CSSProperties = {
  fontFamily: "ui-monospace, monospace",
  fontSize: "13px",
  color: "#ccc",
  display: "flex",
  flexDirection: "column",
  gap: "6px",
};

const silhouetteRow: CSSProperties = {
  display: "flex",
  flexDirection: "row",
  gap: "12px",
  alignItems: "flex-start",
};

const figureStyle: CSSProperties = {
  color: "#555",
  lineHeight: "1.5",
  fontSize: "15px",
  userSelect: "none" as const,
  whiteSpace: "pre" as const,
};

const slotListStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
  flex: 1,
};

const slotRowStyle = (interactive: boolean, stateColor: string): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: "6px",
  padding: "3px 6px",
  borderRadius: "4px",
  borderLeft: `3px solid ${stateColor}`,
  cursor: interactive ? "pointer" : "default",
  background: interactive ? "rgba(255,255,255,0.03)" : "none",
  transition: "background 0.1s ease",
});

const slotLabelStyle: CSSProperties = {
  color: "#bbb",
  fontSize: "12px",
  minWidth: "52px",
};

const slotDetailStyle: CSSProperties = {
  color: "#888",
  fontSize: "12px",
  flex: 1,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const stateBadgeStyle = (color: string): CSSProperties => ({
  fontSize: "10px",
  color,
  flexShrink: 0,
});

const HUMANOID_FIGURE =
  "  ◉  \n" +
  " ╱║╲ \n" +
  " ╱║╲ \n" +
  "  ║  \n" +
  " ╱ ╲ \n" +
  " ▽ ▽ ";

export function BodyDiagram(props: BodyDiagramProps): ReactElement {
  const {
    slots,
    layout = "humanoid",
    availableVerbs,
    verbFilter,
    onVerbInvoke,
    onSlotClick,
    pending = false,
    style,
  } = props;

  const filteredVerbs = availableVerbs
    ? verbFilter ? availableVerbs.filter(verbFilter) : availableVerbs
    : [];
  const verbNames = new Set(filteredVerbs.map((v) => v.name));

  function isVerbEnabled(verb: string): boolean {
    if (pending) return false;
    if (!availableVerbs) return !!onVerbInvoke;
    return (
      verbNames.has(verb) &&
      filteredVerbs.find((v) => v.name === verb)?.enabled !== false
    );
  }

  function isInteractive(slot: BodySlot): boolean {
    if (pending) return false;
    if (onSlotClick) return true;
    if (!slot.verb) return false;
    if (!availableVerbs) return !!onVerbInvoke;
    return isVerbEnabled(slot.verb);
  }

  function handleSlot(slot: BodySlot): void {
    if (!isInteractive(slot)) return;
    if (onSlotClick) { onSlotClick(slot); return; }
    if (slot.verb && onVerbInvoke && isVerbEnabled(slot.verb)) {
      onVerbInvoke(slot.verb, { target: slot.id });
    }
  }

  // Order slots: humanoid order first (if layout=humanoid), then any extras
  const orderedSlots =
    layout === "humanoid"
      ? [
          ...HUMANOID_ORDER
            .map((id) => slots.find((s) => s.id.toLowerCase() === id))
            .filter((s): s is BodySlot => s !== undefined),
          ...slots.filter(
            (s) => !HUMANOID_ORDER.includes(s.id.toLowerCase())
          ),
        ]
      : slots;

  function renderSlotRow(slot: BodySlot): ReactElement {
    const state = slot.state ?? "natural";
    const color = STATE_COLORS[state] ?? STATE_COLORS.natural;
    const interactive = isInteractive(slot);

    return (
      <div
        key={slot.id}
        style={slotRowStyle(interactive, color)}
        onClick={interactive ? () => handleSlot(slot) : undefined}
        onMouseEnter={(e) => {
          if (interactive) {
            (e.currentTarget as HTMLDivElement).style.background =
              "rgba(255,255,255,0.07)";
          }
        }}
        onMouseLeave={(e) => {
          if (interactive) {
            (e.currentTarget as HTMLDivElement).style.background =
              "rgba(255,255,255,0.03)";
          }
        }}
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        onKeyDown={
          interactive
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") handleSlot(slot);
              }
            : undefined
        }
        title={slot.detail ?? STATE_LABELS[state]}
      >
        <span style={slotLabelStyle}>{slot.label}</span>
        {slot.detail && <span style={slotDetailStyle}>{slot.detail}</span>}
        <span style={stateBadgeStyle(color)}>{STATE_LABELS[state]}</span>
      </div>
    );
  }

  if (layout === "list") {
    return (
      <div style={{ ...outerStyle, ...style }}>
        <div style={slotListStyle}>
          {orderedSlots.map(renderSlotRow)}
        </div>
      </div>
    );
  }

  // Humanoid layout: figure on left, slot list on right
  return (
    <div style={{ ...outerStyle, ...style }}>
      <div style={silhouetteRow}>
        <pre style={figureStyle} aria-hidden="true">
          {HUMANOID_FIGURE}
        </pre>
        <div style={slotListStyle}>
          {orderedSlots.map(renderSlotRow)}
        </div>
      </div>
    </div>
  );
}
