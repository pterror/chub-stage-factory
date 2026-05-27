/*
 * TileGrid3D.tsx — 3D tile grid surface for board-like stages.
 *
 * WHAT: Renders a `rows × cols` grid of unit-square tiles on the XZ plane
 *       (Y = elevation). Each cell calls `renderTile` for custom mesh
 *       content; default rendering is a colored flat plane with a thin
 *       border via the cell's `color` (or alternating checkerboard).
 *
 * WHY: 3D version of the (still pending) 2D `TileGrid` UI primitive.
 *      Powers facility-management 3D variants, dungeon floors, board
 *      games, RTS terrain. The grid handles layout + click hit-detection;
 *      stages own the cell mechanics.
 *
 * Click integration: cells fire `onCellClick(row, col, cell)` via R3F
 *       mesh `onClick` handlers; R3F raycasts independent of the
 *       wrapper's `pointer-events: none`.
 */

import {Fragment, type ReactElement, type ReactNode} from "react";
import type {ThreeEvent} from "@react-three/fiber";

export interface TileCell<C> {
  data: C;
  /** Hex/css color. Used by the default tile mesh. */
  color?: string;
  /** Y-axis elevation. Default 0. */
  elevation?: number;
  /** When false, tile is rendered but does not respond to clicks. */
  interactive?: boolean;
}

export interface TileGrid3DProps<C> {
  /** rows × cols, row-major. `cells[r][c]`. */
  cells: TileCell<C>[][];
  /** World-space size of a single tile. Default 1. */
  tileSize?: number;
  /** Gap between tiles (units). Default 0.02. */
  gap?: number;
  /** When defined, replaces the default tile mesh per cell. */
  renderTile?: (cell: TileCell<C>, row: number, col: number) => ReactNode;
  onCellClick?: (row: number, col: number, cell: TileCell<C>) => void;
  onCellHover?: (row: number, col: number, cell: TileCell<C> | null) => void;
  /** When true, alternate light/dark tiles where `color` is missing. */
  checkerboard?: boolean;
}

const DEFAULT_TILE = 1;
const DEFAULT_GAP = 0.02;
const LIGHT_TILE = "#d8d8d8";
const DARK_TILE = "#8a8a8a";

export function TileGrid3D<C>(props: TileGrid3DProps<C>): ReactElement {
  const {
    cells,
    tileSize = DEFAULT_TILE,
    gap = DEFAULT_GAP,
    renderTile,
    onCellClick,
    onCellHover,
    checkerboard = false,
  } = props;

  const stride = tileSize + gap;
  const rows = cells.length;
  const cols = cells[0]?.length ?? 0;
  // Center the grid on the origin.
  const offX = -((cols - 1) * stride) / 2;
  const offZ = -((rows - 1) * stride) / 2;

  return (
    <group>
      {cells.map((row, r) => (
        <Fragment key={r}>
          {row.map((cell, c) => {
            const x = offX + c * stride;
            const z = offZ + r * stride;
            const y = cell.elevation ?? 0;
            const interactive = cell.interactive !== false;
            const fallback = checkerboard
              ? (r + c) % 2 === 0 ? LIGHT_TILE : DARK_TILE
              : LIGHT_TILE;
            const color = cell.color ?? fallback;
            return (
              <group
                key={`${r}:${c}`}
                position={[x, y, z]}
                onClick={
                  interactive && onCellClick
                    ? (e: ThreeEvent<MouseEvent>) => {
                        e.stopPropagation();
                        onCellClick(r, c, cell);
                      }
                    : undefined
                }
                onPointerOver={
                  interactive && onCellHover
                    ? (e: ThreeEvent<PointerEvent>) => {
                        e.stopPropagation();
                        onCellHover(r, c, cell);
                      }
                    : undefined
                }
                onPointerOut={
                  interactive && onCellHover
                    ? () => onCellHover(-1, -1, null)
                    : undefined
                }
              >
                {renderTile ? (
                  renderTile(cell, r, c)
                ) : (
                  <mesh rotation={[-Math.PI / 2, 0, 0]}>
                    <planeGeometry args={[tileSize, tileSize]} />
                    <meshStandardMaterial color={color} />
                  </mesh>
                )}
              </group>
            );
          })}
        </Fragment>
      ))}
    </group>
  );
}
