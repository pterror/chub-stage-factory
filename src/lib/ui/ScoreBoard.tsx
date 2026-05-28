/*
 * ui/ScoreBoard.tsx — multi-stat dashboard composing StatBar + StatTier.
 *
 * WHAT: A labeled list (optionally multi-column, optionally grouped) of
 *       StatBar and StatTier instances. Each entry is discriminated by
 *       `kind`: "bar" renders a StatBar, "tier" renders a StatTier. Pairs
 *       with the `score.ts` pattern.
 *
 * WHY: Wave 2E Batch D (WAVE-2E-DESIGN.md §3.10). Tier-2 composer: it owns
 *       no display primitives of its own, it arranges StatBar/StatTier. The
 *       audit flagged dashboards rendered as raw number dumps; ScoreBoard is
 *       the player-facing surface for a stage's stat block.
 *
 * SHAPE:
 *   interface ScoreEntry { key; label; kind; value; max?; tiers?; group? }
 *   interface ScoreBoardProps { entries; columns?; grouped?; style? }
 *   ScoreBoard(props): ReactElement
 *
 * Display-only; not introspect-aware (its children StatBar/StatTier are
 * themselves ambient). Action wrapping belongs to a containing surface.
 */

import { ReactElement, CSSProperties } from "react";
import { StatBar } from "./StatBar";
import { StatTier } from "./StatTier";
import type { StatTier as StatTierBand } from "./StatTier";

/** One row in the dashboard. `kind` discriminates the renderer. */
export interface ScoreEntry {
  /** Stable key for React. */
  key: string;
  /** Display label. */
  label: string;
  /** Render as a StatBar ("bar") or a StatTier ("tier"). */
  kind: "bar" | "tier";
  /** Current numeric value. */
  value: number;
  /** Max value — used when `kind === "bar"`. */
  max?: number;
  /** Tier ladder — used (and required) when `kind === "tier"`. */
  tiers?: StatTierBand[];
  /** Optional grouping key; surfaced as a section header when `grouped`. */
  group?: string;
}

export interface ScoreBoardProps {
  entries: ScoreEntry[];
  /** Column count for the entry grid. Default 1 (vertical list). */
  columns?: number;
  /** When true, partition entries into sections by `entry.group`, each
   *  under a header. Entries with no `group` collapse into one trailing
   *  ungrouped section. Default false. */
  grouped?: boolean;
  style?: CSSProperties;
}

const outer: CSSProperties = {
  fontFamily: "ui-monospace, monospace",
  fontSize: "13px",
  color: "#ccc",
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};

const sectionHeader: CSSProperties = {
  color: "#888",
  fontSize: "11px",
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  borderBottom: "1px solid rgba(255,255,255,0.1)",
  paddingBottom: "3px",
  marginBottom: "2px",
};

const gridStyle = (columns: number): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
  gap: "8px 16px",
});

function renderEntry(entry: ScoreEntry): ReactElement {
  if (entry.kind === "tier") {
    return (
      <StatTier
        key={entry.key}
        label={entry.label}
        value={entry.value}
        tiers={entry.tiers ?? []}
      />
    );
  }
  return (
    <StatBar
      key={entry.key}
      label={entry.label}
      value={entry.value}
      max={entry.max}
    />
  );
}

/** Group entries by `group`, preserving first-seen order; ungrouped last. */
function groupEntries(entries: ScoreEntry[]): Array<[string | undefined, ScoreEntry[]]> {
  const order: Array<string | undefined> = [];
  const buckets = new Map<string | undefined, ScoreEntry[]>();
  for (const e of entries) {
    const g = e.group;
    if (!buckets.has(g)) {
      buckets.set(g, []);
      order.push(g);
    }
    buckets.get(g)!.push(e);
  }
  // Push the ungrouped bucket (key undefined) to the end if present.
  const sorted = order.filter((g) => g !== undefined);
  if (order.includes(undefined)) sorted.push(undefined);
  return sorted.map((g) => [g, buckets.get(g)!]);
}

export function ScoreBoard(props: ScoreBoardProps): ReactElement {
  const { entries, columns = 1, grouped = false, style } = props;

  if (!grouped) {
    return (
      <div style={{ ...outer, ...style }}>
        <div style={gridStyle(columns)}>{entries.map(renderEntry)}</div>
      </div>
    );
  }

  const sections = groupEntries(entries);
  return (
    <div style={{ ...outer, ...style }}>
      {sections.map(([group, groupEntriesList], i) => (
        <div key={group ?? `__ungrouped-${i}`}>
          {group !== undefined && <div style={sectionHeader}>{group}</div>}
          <div style={gridStyle(columns)}>{groupEntriesList.map(renderEntry)}</div>
        </div>
      ))}
    </div>
  );
}
