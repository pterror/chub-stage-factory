/*
 * ui/ScenePane.tsx — most-recent rendered prose display.
 *
 * WHAT: Renders the most-recently produced prose string. The stage owns
 *       when and how prose is generated; this component just displays it.
 *       Prose is plain text (not markdown); displays in a readable, lightly
 *       styled block. If no prose has been generated yet, shows a
 *       placeholder.
 *
 * WHY: Wave 2E shell component (FRONTEND-SHAPE.md §"src/lib/ui/").
 *      "ScenePane: last rendered prose" in the per-turn loop.
 *
 * Styling: inline styles (repo convention).
 *
 * SHAPE:
 *   interface ScenePaneProps { prose?; placeholder?; style? }
 *   ScenePane(props): ReactElement
 */

import { ReactElement, CSSProperties } from "react";

export interface ScenePaneProps {
  /** The rendered prose string to display. May be empty or undefined before
   *  the first scene render. */
  prose?: string;
  /** Placeholder text shown when `prose` is empty or undefined. */
  placeholder?: string;
  style?: CSSProperties;
}

const pane: CSSProperties = {
  fontFamily: "Georgia, 'Times New Roman', serif",
  fontSize: "15px",
  lineHeight: "1.7",
  color: "#e0e0e0",
  background: "rgba(0,0,0,0.5)",
  padding: "18px 20px",
  borderRadius: "6px",
  overflowY: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const emptyStyle: CSSProperties = {
  ...pane,
  color: "#555",
  fontStyle: "italic",
};

export function ScenePane(props: ScenePaneProps): ReactElement {
  const { prose, placeholder = "Waiting for the scene to unfold…", style } = props;

  if (!prose) {
    return <div style={{ ...emptyStyle, ...style }}>{placeholder}</div>;
  }

  return <div style={{ ...pane, ...style }}>{prose}</div>;
}
