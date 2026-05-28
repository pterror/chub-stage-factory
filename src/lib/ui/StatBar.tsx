/*
 * ui/StatBar.tsx — labeled value bar with optional max.
 *
 * WHAT: A horizontal progress bar with a label and optional numeric readout.
 *       Building block for HP, stamina, resource gauges, and progress meters.
 *       Display-only; no introspect wiring (actions wrap at the containing
 *       surface — ActorPanel, ScoreBoard).
 *
 * WHY: Wave 2E Batch A (WAVE-2E-DESIGN.md §3.8). Closes the ambient-
 *      affordance gap for stats that were previously rendered as raw
 *      numbers or omitted. Composable with StatTier for threshold semantics.
 *
 * SHAPE:
 *   interface StatBarProps
 *     { label; value; max?; color?; showValue?; variant?; style? }
 *   StatBar(props): ReactElement
 */

import { ReactElement, CSSProperties } from "react";

export interface StatBarProps {
  /** Display label (e.g. "HP", "Trust"). */
  label: string;
  /** Current value. */
  value: number;
  /** Maximum value. When omitted, treated as 100 (0–100 scale). */
  max?: number;
  /** Fill color override. When omitted, derived from fill percentage:
   *  ≥70% green, ≥35% amber, <35% red. */
  color?: string;
  /** When true, render the numeric value beside the bar. Default true. */
  showValue?: boolean;
  /** "labeled" shows the label left-aligned; "compact" omits the label row
   *  and shrinks the bar. Default "labeled". */
  variant?: "labeled" | "compact";
  style?: CSSProperties;
}

function derivedColor(pct: number): string {
  if (pct >= 0.7) return "#4c9a52";
  if (pct >= 0.35) return "#b8860b";
  return "#b44";
}

const outer: CSSProperties = {
  fontFamily: "ui-monospace, monospace",
  fontSize: "13px",
  color: "#ccc",
  display: "flex",
  flexDirection: "column",
  gap: "3px",
};

const headerRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: "8px",
};

const labelStyle: CSSProperties = {
  color: "#aaa",
  fontSize: "12px",
};

const valueStyle: CSSProperties = {
  color: "#d4d4d4",
  fontSize: "12px",
};

const trackStyle: CSSProperties = {
  height: "8px",
  background: "rgba(255,255,255,0.08)",
  borderRadius: "4px",
  overflow: "hidden",
};

const compactTrackStyle: CSSProperties = {
  height: "6px",
  background: "rgba(255,255,255,0.08)",
  borderRadius: "3px",
  overflow: "hidden",
};

export function StatBar(props: StatBarProps): ReactElement {
  const {
    label,
    value,
    max = 100,
    color,
    showValue = true,
    variant = "labeled",
    style,
  } = props;

  const clampedPct = Math.min(1, Math.max(0, max > 0 ? value / max : 0));
  const fillColor = color ?? derivedColor(clampedPct);
  const isCompact = variant === "compact";

  const fillStyle: CSSProperties = {
    width: `${clampedPct * 100}%`,
    height: "100%",
    background: fillColor,
    borderRadius: "inherit",
    transition: "width 0.2s ease",
  };

  return (
    <div style={{ ...outer, ...style }}>
      {!isCompact && (
        <div style={headerRow}>
          <span style={labelStyle}>{label}</span>
          {showValue && (
            <span style={valueStyle}>
              {value}/{max}
            </span>
          )}
        </div>
      )}
      <div
        style={isCompact ? compactTrackStyle : trackStyle}
        role="progressbar"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        title={`${label}: ${value}/${max}`}
      >
        <div style={fillStyle} />
      </div>
    </div>
  );
}
