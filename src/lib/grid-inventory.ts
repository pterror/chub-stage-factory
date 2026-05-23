/*
 * grid-inventory.ts — rectangular Tetris-style layout overlay for one spot.
 *
 * WHAT: Some games (Resident Evil 4, Escape from Tarkov) treat an inventory
 *       spot as a rectangular grid where each item is a 2D shape. This module
 *       layers on top of inventory.ts: you opt in per-spot. The grid stores
 *       placement (top-left x/y + rotation 0/1/2/3) per stack. Items have
 *       `shape: bool[][]` (row-major; rotations computed on the fly).
 *
 * WHY: Rule #2 — shapes/rotations are placement instances over a shared def.
 *       Rule #3 — `canPlace` detects overlap and out-of-bounds; the stage
 *       resolves (auto-pack, refuse, etc.).
 *
 * SHAPE:
 *   type Rot = 0 | 1 | 2 | 3
 *   interface Placement { defId; x; y; rot; count }
 *   class GridInventory
 *     constructor(width, height)
 *     setShape(defId, shape): void
 *     getShape(defId): bool[][] | undefined
 *     rotated(shape, rot): bool[][]
 *     placements(): Placement[]
 *     canPlace(defId, x, y, rot, count=1): { ok: true } | { ok: false, reason }
 *     place(p): boolean
 *     remove(idx): Placement | null
 *     occupancy(): bool[][]
 *     toJSON()
 */

export type Rot = 0 | 1 | 2 | 3;

export interface Placement {
  defId: string;
  x: number;
  y: number;
  rot: Rot;
  count: number;
}

export class GridInventory {
  private _shapes: Map<string, boolean[][]> = new Map();
  private _placements: Placement[] = [];

  constructor(public width: number, public height: number) {}

  setShape(defId: string, shape: boolean[][]): void {
    this._shapes.set(defId, shape.map((r) => [...r]));
  }

  getShape(defId: string): boolean[][] | undefined {
    return this._shapes.get(defId);
  }

  /** Rotate a row-major shape clockwise `rot` times. */
  rotated(shape: boolean[][], rot: Rot): boolean[][] {
    let s = shape;
    for (let i = 0; i < rot; i++) {
      const h = s.length;
      const w = s[0]?.length ?? 0;
      const out: boolean[][] = Array.from({ length: w }, () => Array<boolean>(h).fill(false));
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) out[x][h - 1 - y] = s[y][x];
      s = out;
    }
    return s;
  }

  placements(): Placement[] {
    return this._placements.map((p) => ({ ...p }));
  }

  canPlace(
    defId: string,
    x: number,
    y: number,
    rot: Rot,
    _count = 1,
  ): { ok: true } | { ok: false; reason: string } {
    const shape = this._shapes.get(defId);
    if (!shape) return { ok: false, reason: "no_shape" };
    const s = this.rotated(shape, rot);
    const h = s.length;
    const w = s[0]?.length ?? 0;
    if (x < 0 || y < 0 || x + w > this.width || y + h > this.height)
      return { ok: false, reason: "out_of_bounds" };
    const occ = this.occupancy();
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++) {
        if (!s[yy][xx]) continue;
        if (occ[y + yy][x + xx]) return { ok: false, reason: "overlap" };
      }
    return { ok: true };
  }

  place(p: Placement): boolean {
    const c = this.canPlace(p.defId, p.x, p.y, p.rot, p.count);
    if (!c.ok) return false;
    this._placements.push({ ...p });
    return true;
  }

  remove(idx: number): Placement | null {
    if (idx < 0 || idx >= this._placements.length) return null;
    const [out] = this._placements.splice(idx, 1);
    return out;
  }

  occupancy(): boolean[][] {
    const grid: boolean[][] = Array.from({ length: this.height }, () =>
      Array<boolean>(this.width).fill(false),
    );
    for (const p of this._placements) {
      const shape = this._shapes.get(p.defId);
      if (!shape) continue;
      const s = this.rotated(shape, p.rot);
      const h = s.length;
      const w = s[0]?.length ?? 0;
      for (let yy = 0; yy < h; yy++)
        for (let xx = 0; xx < w; xx++) {
          if (!s[yy][xx]) continue;
          const gy = p.y + yy;
          const gx = p.x + xx;
          if (gy >= 0 && gy < this.height && gx >= 0 && gx < this.width) grid[gy][gx] = true;
        }
    }
    return grid;
  }

  toJSON(): { width: number; height: number; shapes: Record<string, boolean[][]>; placements: Placement[] } {
    const shapes: Record<string, boolean[][]> = {};
    for (const [k, v] of this._shapes) shapes[k] = v.map((r) => [...r]);
    return { width: this.width, height: this.height, shapes, placements: this.placements() };
  }
}
