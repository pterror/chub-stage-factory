/*
 * ui/TileGrid.tsx — 2D rectangular grid of interactive cells.
 *
 * WHAT: Renders a `width × height` grid of cells. Each cell may carry a
 *       `verb` name; the component cross-references that against
 *       `availableVerbs` to determine whether the cell is interactive.
 *       Clicking an interactive cell invokes `cell.verb` with
 *       `{ target: cell.id }` via `onVerbInvoke`. Both the verb derivation
 *       and the click handler are overridable by the stage author.
 *
 * WHY: Wave 2E Batch B. Backbone for dungeon maps, arcology floor plans,
 *      facility-management room layouts, inventory grids. The spatial
 *      layout carries targeting information that a flat `ChoiceList` would
 *      have to encode as text.
 *
 * SHAPE:
 *   interface TileGridCell { id; x; y; verb?; data? }
 *   interface TileGridProps<C> extends IntrospectAware {
 *     cells; width; height; renderCell; onCellClick?; cellSize?; gap?; style?
 *   }
 *   TileGrid<C>(props): ReactElement
 */

import { ReactElement, CSSProperties, useMemo } from "react";
import type { VerbDescriptor, InvocationResult } from "../introspect";

// ---------------------------------------------------------------------------
// IntrospectAware contract (shared by all Wave 2E components)
// ---------------------------------------------------------------------------

/** Common shape for components that surface stage verbs. */
export interface IntrospectAware {
  /** Verbs to surface. When omitted and `stage` is provided the component
   *  calls `stage.availableVerbs()` itself. */
  availableVerbs?: VerbDescriptor[];

  /** Called when the user picks a verb. When omitted and `stage` is
   *  provided the component calls `stage.invokeVerb` itself. */
  onVerbInvoke?: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<InvocationResult> | void;

  /** Optional filter applied to `availableVerbs` before render. Used by
   *  group-scoped components (e.g. a movement-only TileGrid filters to
   *  `v.group === "move"`). */
  verbFilter?: (v: VerbDescriptor) => boolean;

  /** Disabled state while a previous invocation is in flight. Components
   *  grey all interactive elements while true. */
  pending?: boolean;
}

// ---------------------------------------------------------------------------
// TileGridCell
// ---------------------------------------------------------------------------

export interface TileGridCell {
  /** Stable identifier; also used as the `target` arg on verb invocation. */
  id: string;
  /** Column index (0-based). */
  x: number;
  /** Row index (0-based). */
  y: number;
  /** Verb name (in the stage's namespace) that this cell triggers on click,
   *  if any. The component uses this to decide interactivity by looking up
   *  the verb in `availableVerbs`. */
  verb?: string;
  /** Free-form data the cell renderer may use. */
  data?: unknown;
}

// ---------------------------------------------------------------------------
// TileGridProps
// ---------------------------------------------------------------------------

export interface TileGridProps<C extends TileGridCell> extends IntrospectAware {
  /** All cells to render. Sparse: cells whose `x`/`y` are absent from this
   *  array render as empty (the renderer receives `undefined`). */
  cells: C[];
  /** Grid width in columns. */
  width: number;
  /** Grid height in rows. */
  height: number;
  /** Cell renderer. Receives the cell (or `undefined` for empty positions)
   *  and whether the cell is currently interactive (verb available and not
   *  pending). */
  renderCell: (cell: C | undefined, interactive: boolean) => ReactElement;
  /** Override the default click handler. By default clicking an interactive
   *  cell calls `onVerbInvoke(cell.verb, { target: cell.id })`. */
  onCellClick?: (cell: C) => void;
  /** Cell size in px. Default 40. */
  cellSize?: number;
  /** Gap between cells in px. Default 2. */
  gap?: number;
  style?: CSSProperties;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TileGrid<C extends TileGridCell>(
  props: TileGridProps<C>,
): ReactElement {
  const {
    cells,
    width,
    height,
    renderCell,
    onCellClick,
    availableVerbs,
    onVerbInvoke,
    verbFilter,
    pending = false,
    cellSize = 40,
    gap = 2,
    style,
  } = props;

  // Build a set of verb names that are currently enabled (after filter).
  const enabledVerbs = useMemo<Set<string>>(() => {
    if (!availableVerbs) return new Set();
    const verbs = verbFilter ? availableVerbs.filter(verbFilter) : availableVerbs;
    return new Set(
      verbs.filter((v) => v.enabled !== false).map((v) => v.name),
    );
  }, [availableVerbs, verbFilter]);

  // Build a lookup from (x, y) → cell for O(1) access during render.
  const cellMap = useMemo<Map<string, C>>(() => {
    const m = new Map<string, C>();
    for (const cell of cells) m.set(`${cell.x},${cell.y}`, cell);
    return m;
  }, [cells]);

  const containerStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: `repeat(${width}, ${cellSize}px)`,
    gridTemplateRows: `repeat(${height}, ${cellSize}px)`,
    gap: `${gap}px`,
    ...style,
  };

  const rows: ReactElement[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const cell = cellMap.get(`${col},${row}`);
      const verbName = cell?.verb;
      const interactive =
        !pending && verbName != null && enabledVerbs.has(verbName);

      const handleClick = () => {
        if (!interactive || !cell) return;
        if (onCellClick) {
          onCellClick(cell);
          return;
        }
        if (onVerbInvoke && cell.verb) {
          void onVerbInvoke(cell.verb, { target: cell.id });
        }
      };

      const cellStyle: CSSProperties = {
        width: `${cellSize}px`,
        height: `${cellSize}px`,
        cursor: interactive ? "pointer" : "default",
        boxSizing: "border-box",
        overflow: "hidden",
      };

      rows.push(
        <div
          key={`${col},${row}`}
          style={cellStyle}
          onClick={interactive ? handleClick : undefined}
          title={interactive && cell?.verb ? cell.verb : undefined}
          role={interactive ? "button" : undefined}
          tabIndex={interactive ? 0 : undefined}
          onKeyDown={
            interactive
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") handleClick();
                }
              : undefined
          }
        >
          {renderCell(cell, interactive)}
        </div>,
      );
    }
  }

  return <div style={containerStyle}>{rows}</div>;
}

export default TileGrid;
