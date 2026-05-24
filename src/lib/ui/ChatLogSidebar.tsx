/*
 * ui/ChatLogSidebar.tsx — collapsible past-scene log.
 *
 * WHAT: Renders a collapsible list of past rendered scenes. The list of
 *       entries is passed as a prop (the stage owns persistence); local
 *       state manages the collapsed/expanded state only.
 *
 *       Each entry in `entries` is a past prose string (or a structured
 *       { prose, turn } object). The sidebar is intended to be placed at
 *       the right edge of the fullscreen layout; it collapses to a narrow
 *       tab when not in use.
 *
 * WHY: Wave 2E shell component (FRONTEND-SHAPE.md §"src/lib/ui/").
 *      "ChatLogSidebar: collapsible append-only list of past rendered scenes."
 *      The chat log is a side panel, not the primary interface.
 *
 * Styling: inline styles (repo convention).
 *
 * SHAPE:
 *   interface LogEntry { id; prose; turnLabel? }
 *   interface ChatLogSidebarProps { entries; initialCollapsed?; style? }
 *   ChatLogSidebar(props): ReactElement
 */

import { ReactElement, useState, CSSProperties } from "react";

export interface LogEntry {
  /** Unique id for the entry (React key). */
  id: string;
  /** The rendered prose text. */
  prose: string;
  /** Optional label shown above the entry (e.g. "Turn 3"). */
  turnLabel?: string;
}

export interface ChatLogSidebarProps {
  entries: LogEntry[];
  /** Whether the sidebar starts collapsed. Default false. */
  initialCollapsed?: boolean;
  style?: CSSProperties;
}

const COLLAPSED_WIDTH = "36px";
const EXPANDED_WIDTH = "280px";

const sidebar = (collapsed: boolean): CSSProperties => ({
  width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
  minWidth: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
  maxWidth: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
  height: "100%",
  display: "flex",
  flexDirection: "column",
  background: "rgba(0,0,0,0.8)",
  borderLeft: "1px solid rgba(255,255,255,0.08)",
  transition: "width 0.2s ease, min-width 0.2s ease, max-width 0.2s ease",
  overflow: "hidden",
  flexShrink: 0,
});

const toggle: CSSProperties = {
  width: "36px",
  minWidth: "36px",
  padding: "12px 0",
  background: "transparent",
  border: "none",
  color: "#777",
  cursor: "pointer",
  writingMode: "vertical-rl",
  textOrientation: "mixed",
  fontFamily: "ui-monospace, monospace",
  fontSize: "11px",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  alignSelf: "flex-start",
};

const scrollArea: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  display: "flex",
  flexDirection: "column-reverse", // most recent at top
  gap: "1px",
  padding: "0 0 8px 0",
};

const entryContainer: CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid rgba(255,255,255,0.05)",
};

const entryLabel: CSSProperties = {
  color: "#555",
  fontSize: "10px",
  fontFamily: "ui-monospace, monospace",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginBottom: "4px",
};

const entryText: CSSProperties = {
  color: "#888",
  fontSize: "13px",
  fontFamily: "Georgia, serif",
  lineHeight: "1.5",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  // Truncate long entries in collapsed preview.
  display: "-webkit-box",
  WebkitLineClamp: 4,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

export function ChatLogSidebar(props: ChatLogSidebarProps): ReactElement {
  const { entries, initialCollapsed = false, style } = props;
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  return (
    <div style={{ ...sidebar(collapsed), ...style }}>
      {/* Toggle tab — always visible */}
      <button
        style={toggle}
        title={collapsed ? "Show log" : "Hide log"}
        onClick={() => setCollapsed((c) => !c)}
      >
        {collapsed ? "Log" : "◀ Log"}
      </button>

      {/* Entry list */}
      {!collapsed && (
        <div style={scrollArea}>
          {[...entries].reverse().map((e) => (
            <div key={e.id} style={entryContainer}>
              {e.turnLabel && <div style={entryLabel}>{e.turnLabel}</div>}
              <div style={entryText}>{e.prose}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
