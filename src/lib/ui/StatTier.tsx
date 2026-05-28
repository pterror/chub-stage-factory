/*
 * ui/StatTier.tsx — tier indicator for threshold-semantic stats.
 *
 * WHAT: Renders the current tier label (e.g. "warm", "wary") derived from a
 *       value against a set of ascending thresholds, plus an optional pip-
 *       strip showing progress within the current tier. Display-only; no
 *       introspect wiring (composed by ActorPanel, ScoreBoard).
 *
 * WHY: Wave 2E Batch A (WAVE-2E-DESIGN.md §3.9). Companion to StatBar for
 *      stats whose player-facing meaning is qualitative — relationship tiers,
 *      corruption levels, morale bands. Composable with StatBar for mixed
 *      dashboard (ScoreBoard §3.10).
 *
 * SHAPE:
 *   interface StatTier { at; label; color? }
 *   interface StatTierProps { label; value; tiers; showProgress?; style? }
 *   StatTier(props): ReactElement
 */

import { ReactElement, CSSProperties } from "react";

/** One band in the tier ladder. `at` is the inclusive lower bound. */
export interface StatTier {
  /** Inclusive lower bound for this tier. */
  at: number;
  /** Player-facing tier label. */
  label: string;
  /** Optional fill color for the pip strip. */
  color?: string;
}

export interface StatTierProps {
  /** Display label for the stat (e.g. "Trust", "Corruption"). */
  label: string;
  /** Current numeric value. */
  value: number;
  /** Tier ladder, ascending by `at`. The component picks the highest tier
   *  whose `at` ≤ value. */
  tiers: StatTier[];
  /** Show a 5-pip progress strip within the current tier. Default true. */
  showProgress?: boolean;
  style?: CSSProperties;
}

const PIPS = 5;
const DEFAULT_TIER_COLOR = "#5588cc";

function currentTierIndex(value: number, tiers: StatTier[]): number {
  let idx = -1;
  for (let i = 0; i < tiers.length; i++) {
    if (value >= tiers[i].at) idx = i;
  }
  return idx;
}

const outer: CSSProperties = {
  fontFamily: "ui-monospace, monospace",
  fontSize: "13px",
  color: "#ccc",
  display: "flex",
  flexDirection: "column",
  gap: "3px",
};

const row: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
};

const labelStyle: CSSProperties = {
  color: "#aaa",
  fontSize: "12px",
  minWidth: "60px",
};

const tierLabelStyle: CSSProperties = {
  color: "#d4d4d4",
  fontSize: "12px",
};

const pipRow: CSSProperties = {
  display: "flex",
  gap: "3px",
  alignItems: "center",
};

export function StatTier(props: StatTierProps): ReactElement {
  const { label, value, tiers, showProgress = true, style } = props;

  const sorted = [...tiers].sort((a, b) => a.at - b.at);
  const idx = currentTierIndex(value, sorted);
  const tier = idx >= 0 ? sorted[idx] : null;
  const tierColor = tier?.color ?? DEFAULT_TIER_COLOR;

  // Progress within the current tier: how far between current.at and next.at
  let filledPips = 0;
  if (showProgress && tier !== null) {
    const next = sorted[idx + 1];
    if (next) {
      const span = next.at - tier.at;
      const progress = span > 0 ? (value - tier.at) / span : 1;
      filledPips = Math.round(progress * PIPS);
    } else {
      // In the top tier: always full
      filledPips = PIPS;
    }
  }

  const pipStyle = (filled: boolean): CSSProperties => ({
    width: "10px",
    height: "10px",
    borderRadius: "2px",
    background: filled ? tierColor : "rgba(255,255,255,0.1)",
    flexShrink: 0,
  });

  return (
    <div style={{ ...outer, ...style }}>
      <div style={row}>
        <span style={labelStyle}>{label}</span>
        {showProgress && (
          <div style={pipRow} aria-label={`${label} progress`}>
            {Array.from({ length: PIPS }, (_, i) => (
              <div key={i} style={pipStyle(i < filledPips)} />
            ))}
          </div>
        )}
        <span style={tierLabelStyle}>
          {tier ? tier.label : "—"}
        </span>
      </div>
    </div>
  );
}
