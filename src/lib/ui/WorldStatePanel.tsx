/*
 * ui/WorldStatePanel.tsx — location + present actors + salient stats panel.
 *
 * WHAT: Renders a structured world-state summary: the player's current
 *       location (with a description), a list of present actors with their
 *       visible stats, and a set of salient world stats (health, hunger,
 *       relationship scores, etc.). All data is supplied by the caller via
 *       typed props; no implicit state, no game-specific logic.
 *
 * WHY: Wave 2E shell component (FRONTEND-SHAPE.md §"src/lib/ui/"). Keeps
 *      the "state is the protagonist" contract visible to the player. The
 *      stage derives what to show; this component just renders it.
 *
 * Styling: inline styles matching the repo convention (Stage.tsx, 3d/).
 *
 * SHAPE:
 *   interface ActorEntry<S> { id; name; stats?: Record<string, number | string>; tags?: string[] }
 *   interface WorldStatePanelProps<S>
 *     { location; locationDescription?; actors?; stats?; style? }
 *   WorldStatePanel<S>(props): ReactElement
 */

import { ReactElement, CSSProperties } from "react";

export interface ActorEntry {
  id: string;
  name: string;
  /** Key → value pairs shown as a compact stat list under the actor name. */
  stats?: Record<string, number | string>;
  /** Optional tag badges displayed next to the actor name. */
  tags?: string[];
}

export interface WorldStatePanelProps {
  /** Current location id or display name. */
  location: string;
  /** Optional prose description of the location. */
  locationDescription?: string;
  /** Actors present in the current location. */
  actors?: ActorEntry[];
  /** Salient world/player stats shown as key → value pairs. */
  stats?: Record<string, number | string>;
  /** Optional override for the outer container style. */
  style?: CSSProperties;
}

const panel: CSSProperties = {
  fontFamily: "ui-monospace, monospace",
  fontSize: "13px",
  color: "#ccc",
  background: "rgba(0,0,0,0.75)",
  padding: "12px 14px",
  borderRadius: "6px",
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  minWidth: "220px",
};

const section: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
};

const label: CSSProperties = {
  color: "#777",
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const locationName: CSSProperties = {
  color: "#e8e8e8",
  fontWeight: "bold",
  fontSize: "14px",
};

const locationDesc: CSSProperties = {
  color: "#aaa",
  fontStyle: "italic",
  lineHeight: "1.4",
};

const actorRow: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
  paddingLeft: "8px",
  borderLeft: "2px solid #444",
};

const actorName: CSSProperties = {
  color: "#d4d4d4",
  fontWeight: "500",
};

const tagBadge: CSSProperties = {
  display: "inline-block",
  background: "rgba(255,255,255,0.08)",
  borderRadius: "3px",
  padding: "0 4px",
  fontSize: "11px",
  color: "#aaa",
  marginRight: "4px",
};

const statLine: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "8px",
};

const statKey: CSSProperties = { color: "#888" };
const statVal: CSSProperties = { color: "#d4d4d4" };

export function WorldStatePanel(props: WorldStatePanelProps): ReactElement {
  const { location, locationDescription, actors, stats, style } = props;

  return (
    <div style={{ ...panel, ...style }}>
      {/* Location */}
      <div style={section}>
        <span style={label}>Location</span>
        <span style={locationName}>{location}</span>
        {locationDescription && (
          <span style={locationDesc}>{locationDescription}</span>
        )}
      </div>

      {/* Present actors */}
      {actors && actors.length > 0 && (
        <div style={section}>
          <span style={label}>Present</span>
          {actors.map((a) => (
            <div key={a.id} style={actorRow}>
              <span style={actorName}>
                {a.name}
                {a.tags && a.tags.map((t) => (
                  <span key={t} style={tagBadge}>{t}</span>
                ))}
              </span>
              {a.stats && Object.entries(a.stats).map(([k, v]) => (
                <div key={k} style={statLine}>
                  <span style={statKey}>{k}</span>
                  <span style={statVal}>{String(v)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* World / player stats */}
      {stats && Object.keys(stats).length > 0 && (
        <div style={section}>
          <span style={label}>Status</span>
          {Object.entries(stats).map(([k, v]) => (
            <div key={k} style={statLine}>
              <span style={statKey}>{k}</span>
              <span style={statVal}>{String(v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
