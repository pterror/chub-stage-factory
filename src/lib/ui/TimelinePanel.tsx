/*
 * ui/TimelinePanel.tsx — scrollable feed of Timeline events.
 *
 * WHAT: Renders TimelineEntry items as a timestamped scrollable feed,
 *       grouped by tick when requested. Entries beyond maxItems are
 *       collapsed to "N minor events" (filtering, not truncating).
 *       Optional verb-per-entry enables re-invoke actions (replay, undo).
 *
 * WHY: Wave 2E Batch A (WAVE-2E-DESIGN.md §3.6). Replaces the raw
 *      JSON event dump pattern found in examples. Composable with
 *      ChatLogSidebar philosophically — renders Timeline events, not
 *      chat turns.
 *
 * SHAPE:
 *   interface TimelineEntry { id; at; kind; text; details?; verb? }
 *   interface TimelinePanelProps extends IntrospectAware
 *     { entries; maxItems?; groupByKind?; showTimestamps?; onEntryClick?; style? }
 *   TimelinePanel(props): ReactElement
 */

import { ReactElement, CSSProperties, useState } from "react";
import type { IntrospectAware } from "./introspect-aware";

export interface TimelineEntry {
  id: string;
  /** Tick or ms timestamp. */
  at: number;
  /** Event kind / category tag. */
  kind: string;
  /** Player-facing summary. NOT raw JSON. */
  text: string;
  /** Optional rich details revealed on expand. */
  details?: string;
  /** Optional verb to re-invoke this event (e.g. "replay", "undo"). */
  verb?: string;
}

export interface TimelinePanelProps extends IntrospectAware {
  entries: TimelineEntry[];
  /** Max visible entries. Older events collapse to "N minor events". Default 12. */
  maxItems?: number;
  /** Collapse consecutive entries of the same kind into a group header. */
  groupByKind?: boolean;
  /** Show the at-value next to each entry. Default true. */
  showTimestamps?: boolean;
  onEntryClick?: (entry: TimelineEntry) => void;
  style?: CSSProperties;
}

const KIND_ICONS: Record<string, string> = {
  move: "◆",
  talk: "●",
  item: "◇",
  flag: "⚐",
  combat: "⚔",
  default: "·",
};

function kindIcon(kind: string): string {
  return KIND_ICONS[kind] ?? KIND_ICONS.default;
}

const panelStyle: CSSProperties = {
  fontFamily: "ui-monospace, monospace",
  fontSize: "13px",
  color: "#ccc",
  display: "flex",
  flexDirection: "column",
  gap: "0",
  maxHeight: "320px",
  overflowY: "auto",
};

const tickHeader: CSSProperties = {
  color: "#555",
  fontSize: "11px",
  padding: "6px 0 2px",
  borderTop: "1px solid rgba(255,255,255,0.07)",
  userSelect: "none" as const,
};

const entryRow: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: "6px",
  padding: "3px 0 3px 4px",
};

const iconStyle: CSSProperties = {
  flexShrink: 0,
  color: "#666",
  width: "14px",
  textAlign: "center",
};

const entryText: CSSProperties = {
  flex: 1,
  color: "#ccc",
  lineHeight: "1.4",
};

const detailsStyle: CSSProperties = {
  color: "#888",
  fontSize: "12px",
  paddingLeft: "20px",
  lineHeight: "1.4",
};

const verbBtn = (enabled: boolean): CSSProperties => ({
  flexShrink: 0,
  background: "none",
  border: "none",
  color: enabled ? "#7af" : "#444",
  cursor: enabled ? "pointer" : "default",
  fontFamily: "ui-monospace, monospace",
  fontSize: "12px",
  padding: "0 2px",
});

const collapseRow: CSSProperties = {
  color: "#555",
  fontSize: "12px",
  padding: "4px 0 4px 20px",
  cursor: "pointer",
  userSelect: "none" as const,
};

export function TimelinePanel(props: TimelinePanelProps): ReactElement {
  const {
    entries,
    maxItems = 12,
    groupByKind = false,
    showTimestamps = true,
    availableVerbs,
    verbFilter,
    onVerbInvoke,
    onEntryClick,
    pending = false,
    style,
  } = props;

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showCollapsed, setShowCollapsed] = useState(false);

  const filteredVerbs = availableVerbs
    ? verbFilter ? availableVerbs.filter(verbFilter) : availableVerbs
    : [];
  const verbNames = new Set(filteredVerbs.map((v) => v.name));

  // Sort descending by at
  const sorted = [...entries].sort((a, b) => b.at - a.at);
  const visible = sorted.slice(0, maxItems);
  const collapsed = sorted.slice(maxItems);

  function isVerbEnabled(verb: string): boolean {
    if (pending) return false;
    if (!availableVerbs) return !!onVerbInvoke;
    return (
      verbNames.has(verb) &&
      filteredVerbs.find((v) => v.name === verb)?.enabled !== false
    );
  }

  function handleVerb(entry: TimelineEntry): void {
    if (!entry.verb) return;
    if (onEntryClick) { onEntryClick(entry); return; }
    if (onVerbInvoke && isVerbEnabled(entry.verb)) {
      onVerbInvoke(entry.verb, { target: entry.id });
    }
  }

  function toggleDetails(id: string): void {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Group by tick for display
  const tickGroups = new Map<number, TimelineEntry[]>();
  for (const e of visible) {
    const g = tickGroups.get(e.at) ?? [];
    g.push(e);
    tickGroups.set(e.at, g);
  }
  const ticks = [...tickGroups.keys()].sort((a, b) => b - a);

  // Optionally further collapse same-kind runs within a tick
  function renderGroup(group: TimelineEntry[]): ReactElement[] {
    if (!groupByKind) {
      return group.map((entry) => renderEntry(entry));
    }
    const out: ReactElement[] = [];
    let i = 0;
    while (i < group.length) {
      const kind = group[i].kind;
      const run: TimelineEntry[] = [group[i]];
      while (i + 1 < group.length && group[i + 1].kind === kind) {
        i++;
        run.push(group[i]);
      }
      if (run.length === 1) {
        out.push(renderEntry(run[0]));
      } else {
        out.push(
          <div key={run[0].id + "-run"}>
            <div style={{ ...collapseRow, paddingLeft: "4px" }}>
              {kindIcon(kind)} {run.length}× {kind}
            </div>
            {run.map((e) => renderEntry(e))}
          </div>
        );
      }
      i++;
    }
    return out;
  }

  function renderEntry(entry: TimelineEntry): ReactElement {
    const expanded = expandedIds.has(entry.id);
    const hasDetails = !!entry.details;
    const hasVerb = !!entry.verb;

    return (
      <div key={entry.id}>
        <div style={entryRow}>
          <span style={iconStyle}>{kindIcon(entry.kind)}</span>
          <span
            style={{
              ...entryText,
              cursor: hasDetails ? "pointer" : "default",
              textDecoration: hasDetails ? "underline dotted" : "none",
            }}
            onClick={hasDetails ? () => toggleDetails(entry.id) : undefined}
            title={entry.kind}
          >
            {entry.text}
          </span>
          {hasVerb && (
            <button
              style={verbBtn(isVerbEnabled(entry.verb!))}
              disabled={!isVerbEnabled(entry.verb!) || pending}
              onClick={() => handleVerb(entry)}
              title="Re-invoke"
              aria-label={`Re-invoke: ${entry.text}`}
            >
              ↻
            </button>
          )}
        </div>
        {expanded && entry.details && (
          <div style={detailsStyle}>{entry.details}</div>
        )}
      </div>
    );
  }

  return (
    <div style={{ ...panelStyle, ...style }}>
      {ticks.map((tick) => (
        <div key={tick}>
          {showTimestamps && (
            <div style={tickHeader}>── Tick {tick} ──</div>
          )}
          {renderGroup(tickGroups.get(tick) ?? [])}
        </div>
      ))}

      {collapsed.length > 0 && (
        <div
          style={{ ...collapseRow, borderTop: "1px solid rgba(255,255,255,0.07)" }}
          onClick={() => setShowCollapsed((v) => !v)}
        >
          {showCollapsed ? "▾" : "▸"} {collapsed.length} older events
        </div>
      )}
      {showCollapsed &&
        collapsed.map((entry) => (
          <div key={entry.id} style={entryRow}>
            <span style={iconStyle}>{kindIcon(entry.kind)}</span>
            <span style={{ ...entryText, color: "#666" }}>{entry.text}</span>
          </div>
        ))}
    </div>
  );
}
