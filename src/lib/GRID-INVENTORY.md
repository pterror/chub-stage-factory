# Grid-Inventory — Tetris-style 2D item layout

`grid-inventory.ts` adds a rectangular grid overlay to a single inventory
spot. Items have a 2D boolean shape and can be placed at a position and
rotation. It layers on top of `inventory.ts`; opt in per-spot.

## Concepts

- **Shape** — `boolean[][]` (row-major). `true` cells are occupied. Stored
  per `defId`; must be registered via `setShape` before placement.
- **Rotation** — `Rot = 0 | 1 | 2 | 3` clockwise 90° increments. `rotated`
  produces the transformed shape; the original is unchanged.
- **Placement** — `{ defId, x, y, rot, count }`. `x`, `y` are the top-left
  corner after rotation. `count` is stored but not used in overlap
  checking — one `Placement` occupies one shape footprint regardless of
  count.

## API

- `type Rot = 0 | 1 | 2 | 3` (`src/lib/grid-inventory.ts:31`)
- `interface Placement` (`src/lib/grid-inventory.ts:33-38`)
- `class GridInventory` (`src/lib/grid-inventory.ts:41-147`)
  - `constructor(width, height)`
  - `setShape(defId, shape)` / `getShape(defId)`
  - `rotated(shape, rot): boolean[][]` — pure; does not mutate the input
  - `placements(): Placement[]` — shallow copies
  - `canPlace(defId, x, y, rot, count?): { ok: true } | { ok: false; reason }` — reasons: `no_shape`, `out_of_bounds`, `overlap`
  - `place(p): boolean` — calls `canPlace`; returns false on failure without mutating
  - `remove(idx): Placement | null` — index into `placements()` order
  - `occupancy(): boolean[][]` — full grid snapshot; recomputed each call
  - `toJSON()` / `static fromJSON(data)`

## Gotchas

- `occupancy()` is O(placements × shape-cells) and recomputed on every
  call. Cache it if calling `canPlace` in a tight auto-packing loop.
- `remove` takes a positional index, not a `defId`. If multiple placements
  share a `defId`, only the one at the specified index is removed.
