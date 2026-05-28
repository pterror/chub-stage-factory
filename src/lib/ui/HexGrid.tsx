/*
 * ui/HexGrid.tsx — SVG hex grid using axial coordinates.
 *
 * WHAT: Renders a hex grid from cells in axial (q, r) coordinate space.
 *       Supports "pointy-top" (default) and "flat-top" orientation.
 *       Each cell may carry a `verb`; interactivity is determined by
 *       cross-referencing with `availableVerbs`. Clicking an interactive
 *       cell invokes `cell.verb` with `{ target: cell.id }`.
 *
 * WHY: Wave 2E Batch B. Hex topology suits tactical RPG combat grids,
 *      Civ-style strategy maps, and any graph where six-neighbor adjacency
 *      matters more than four. Shares `IntrospectAware` contract with
 *      `TileGrid` and future `HexGrid3D`.
 *
 * Coordinate system: axial (q = column offset, r = row offset). The
 * conversion to pixel coordinates follows the standard hex-math reference
 * (redblobgames.com/grids/hexagons). A shared `hex-math.ts` helper is
 * intentionally not introduced here to keep Batch B self-contained;
 * Wave 2F `HexGrid3D` should extract it then.
 *
 * SHAPE:
 *   interface HexGridCell { id; q; r; verb?; data? }
 *   interface HexGridProps<C> extends IntrospectAware {
 *     cells; renderCell; onCellClick?; hexSize?; orientation?; style?
 *   }
 *   HexGrid<C>(props): ReactElement
 */

import { ReactElement, CSSProperties, useMemo } from "react";
import type { IntrospectAware } from "./introspect-aware";

// ---------------------------------------------------------------------------
// HexGridCell
// ---------------------------------------------------------------------------

export interface HexGridCell {
  /** Stable identifier; used as the `target` arg on verb invocation. */
  id: string;
  /** Axial column. */
  q: number;
  /** Axial row. */
  r: number;
  /** Verb name that this cell triggers on click, if any. */
  verb?: string;
  /** Free-form data the cell renderer may use. */
  data?: unknown;
}

// ---------------------------------------------------------------------------
// HexGridProps
// ---------------------------------------------------------------------------

export interface HexGridProps<C extends HexGridCell> extends IntrospectAware {
  cells: C[];
  /** Cell renderer. Receives the cell and whether it is currently
   *  interactive. The element is rendered inside an SVG `<foreignObject>`
   *  (HTML) so standard React DOM elements work. */
  renderCell: (cell: C | undefined, interactive: boolean) => ReactElement;
  /** Override the default click handler. By default clicking an interactive
   *  cell calls `onVerbInvoke(cell.verb, { target: cell.id })`. */
  onCellClick?: (cell: C) => void;
  /** Hex size in px (center to corner). Default 32. */
  hexSize?: number;
  /** Pointy-top (default) or flat-top. */
  orientation?: "pointy" | "flat";
  style?: CSSProperties;
}

// ---------------------------------------------------------------------------
// Hex math helpers (inline; extract to hex-math.ts in Wave 2F)
// ---------------------------------------------------------------------------

/** Returns the 6 corner points of a hex (relative to center). */
function hexCorners(
  size: number,
  orientation: "pointy" | "flat",
): Array<[number, number]> {
  return Array.from({ length: 6 }, (_, i) => {
    const angleDeg = orientation === "pointy" ? 60 * i - 30 : 60 * i;
    const angleRad = (Math.PI / 180) * angleDeg;
    return [size * Math.cos(angleRad), size * Math.sin(angleRad)] as [
      number,
      number,
    ];
  });
}

/** Axial (q, r) → pixel center (cx, cy). */
function axialToPixel(
  q: number,
  r: number,
  size: number,
  orientation: "pointy" | "flat",
): [number, number] {
  if (orientation === "pointy") {
    const cx = size * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r);
    const cy = size * ((3 / 2) * r);
    return [cx, cy];
  } else {
    // flat-top
    const cx = size * ((3 / 2) * q);
    const cy = size * ((Math.sqrt(3) / 2) * q + Math.sqrt(3) * r);
    return [cx, cy];
  }
}

/** SVG polygon points string for a single hex. */
function hexPolygonPoints(
  cx: number,
  cy: number,
  corners: Array<[number, number]>,
): string {
  return corners.map(([dx, dy]) => `${cx + dx},${cy + dy}`).join(" ");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HexGrid<C extends HexGridCell>(
  props: HexGridProps<C>,
): ReactElement {
  const {
    cells,
    renderCell,
    onCellClick,
    availableVerbs,
    onVerbInvoke,
    verbFilter,
    pending = false,
    hexSize = 32,
    orientation = "pointy",
    style,
  } = props;

  // Enabled verb set.
  const enabledVerbs = useMemo<Set<string>>(() => {
    if (!availableVerbs) return new Set();
    const verbs = verbFilter ? availableVerbs.filter(verbFilter) : availableVerbs;
    return new Set(
      verbs.filter((v) => v.enabled !== false).map((v) => v.name),
    );
  }, [availableVerbs, verbFilter]);

  // Precompute corner offsets (constant for a given size/orientation).
  const corners = useMemo(
    () => hexCorners(hexSize, orientation),
    [hexSize, orientation],
  );

  // Compute pixel positions and bounding box.
  const positions = useMemo<
    Array<{ cell: C; cx: number; cy: number }>
  >(() => {
    return cells.map((cell) => {
      const [cx, cy] = axialToPixel(cell.q, cell.r, hexSize, orientation);
      return { cell, cx, cy };
    });
  }, [cells, hexSize, orientation]);

  const { minX, minY, svgWidth, svgHeight } = useMemo(() => {
    if (positions.length === 0)
      return { minX: 0, minY: 0, svgWidth: 0, svgHeight: 0 };
    const xs = positions.map((p) => p.cx);
    const ys = positions.map((p) => p.cy);
    const pad = hexSize + 4;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const maxX = Math.max(...xs) + pad;
    const maxY = Math.max(...ys) + pad;
    return {
      minX,
      minY,
      svgWidth: maxX - minX,
      svgHeight: maxY - minY,
    };
  }, [positions, hexSize]);

  // The foreignObject inner box (where the renderCell HTML lands) is sized to
  // the hex's inscribed rectangle: for pointy-top √3*size × size; for flat
  // size × √3*size. We use a circle-inscribed square for simplicity.
  const innerSize = hexSize * Math.sqrt(3) * 0.85;

  return (
    <svg
      style={{
        overflow: "visible",
        display: "block",
        width: svgWidth,
        height: svgHeight,
        ...style,
      }}
      viewBox={`${minX} ${minY} ${svgWidth} ${svgHeight}`}
    >
      {positions.map(({ cell, cx, cy }) => {
        const verbName = cell.verb;
        const interactive =
          !pending && verbName != null && enabledVerbs.has(verbName);

        const handleClick = () => {
          if (!interactive) return;
          if (onCellClick) {
            onCellClick(cell);
            return;
          }
          if (onVerbInvoke && cell.verb) {
            void onVerbInvoke(cell.verb, { target: cell.id });
          }
        };

        const points = hexPolygonPoints(cx, cy, corners);
        const halfInner = innerSize / 2;

        return (
          <g
            key={cell.id}
            onClick={interactive ? handleClick : undefined}
            style={{ cursor: interactive ? "pointer" : "default" }}
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
            {/* Hex outline — filled/styled by the cell renderer's surrounding context */}
            <polygon
              points={points}
              fill="none"
              stroke="rgba(255,255,255,0.15)"
              strokeWidth={1}
            />
            {/* Cell content via foreignObject */}
            <foreignObject
              x={cx - halfInner}
              y={cy - halfInner}
              width={innerSize}
              height={innerSize}
              style={{ overflow: "visible", pointerEvents: "none" }}
            >
              {/* xmlns is required for React SVG foreignObject to render HTML */}
              <div
                // @ts-expect-error — xmlns is valid in SVG foreignObject
                xmlns="http://www.w3.org/1999/xhtml"
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                {renderCell(cell, interactive)}
              </div>
            </foreignObject>
            {/* Invisible click target matching the hex polygon */}
            {interactive && (
              <polygon
                points={points}
                fill="transparent"
                stroke="none"
                style={{ cursor: "pointer" }}
              >
                {cell.verb && <title>{cell.verb}</title>}
              </polygon>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default HexGrid;
