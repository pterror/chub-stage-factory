/*
 * physics.ts — minimal collision + integration.
 *
 * WHAT: AABB / circle / segment primitives, a spatial hash for broadphase
 *       queries, simple impulse-based and positional collision resolution,
 *       and a Verlet integrator. Not a physics engine; enough to answer
 *       "did the bullet hit a wall" and "where is the player after dt".
 *
 * WHY: Rule #5 (tick-based, explicit), #4 (pure functions over plain data).
 *
 * SHAPE:
 *   interface Vec2 { x: number; y: number }
 *   interface AABB { x; y; w; h }
 *   interface Circle { x; y; r }
 *   interface Segment { x1; y1; x2; y2 }
 *   aabbOverlap(a, b): boolean
 *   aabbContains(a, p): boolean
 *   circleOverlap(a, b): boolean
 *   circleAabbOverlap(c, a): boolean
 *   segmentAabb(s, a): boolean
 *   class SpatialHash<T>
 *     constructor(cellSize)
 *     insert(item, bounds): void
 *     clear(): void
 *     query(bounds): T[]
 *   resolvePositional(a, b): { ax, ay, bx, by }      // separates overlapping AABBs
 *   resolveImpulse(av, bv, normal, restitution): { av, bv }
 *   verletStep(p, prev, accel, dt, damping?): { p, prev }
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface AABB {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function aabbOverlap(a: AABB, b: AABB): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

export function aabbContains(a: AABB, p: Vec2): boolean {
  return p.x >= a.x && p.x < a.x + a.w && p.y >= a.y && p.y < a.y + a.h;
}

export function circleOverlap(a: Circle, b: Circle): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const r = a.r + b.r;
  return dx * dx + dy * dy < r * r;
}

export function circleAabbOverlap(c: Circle, a: AABB): boolean {
  const nx = Math.max(a.x, Math.min(c.x, a.x + a.w));
  const ny = Math.max(a.y, Math.min(c.y, a.y + a.h));
  const dx = c.x - nx;
  const dy = c.y - ny;
  return dx * dx + dy * dy < c.r * c.r;
}

/** Segment vs AABB using slab method. */
export function segmentAabb(s: Segment, a: AABB): boolean {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  let tmin = 0;
  let tmax = 1;
  // x slab
  if (dx === 0) {
    if (s.x1 < a.x || s.x1 > a.x + a.w) return false;
  } else {
    const inv = 1 / dx;
    let t1 = (a.x - s.x1) * inv;
    let t2 = (a.x + a.w - s.x1) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmax < tmin) return false;
  }
  // y slab
  if (dy === 0) {
    if (s.y1 < a.y || s.y1 > a.y + a.h) return false;
  } else {
    const inv = 1 / dy;
    let t1 = (a.y - s.y1) * inv;
    let t2 = (a.y + a.h - s.y1) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmax < tmin) return false;
  }
  return true;
}

export class SpatialHash<T> {
  private _cells: Map<string, { item: T; bounds: AABB }[]> = new Map();
  constructor(public cellSize: number) {}

  private _key(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  private *_range(bounds: AABB): Generator<string> {
    const x0 = Math.floor(bounds.x / this.cellSize);
    const y0 = Math.floor(bounds.y / this.cellSize);
    const x1 = Math.floor((bounds.x + bounds.w) / this.cellSize);
    const y1 = Math.floor((bounds.y + bounds.h) / this.cellSize);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) yield this._key(cx, cy);
  }

  insert(item: T, bounds: AABB): void {
    for (const k of this._range(bounds)) {
      let bucket = this._cells.get(k);
      if (!bucket) {
        bucket = [];
        this._cells.set(k, bucket);
      }
      bucket.push({ item, bounds });
    }
  }

  clear(): void {
    this._cells.clear();
  }

  query(bounds: AABB): T[] {
    const seen = new Set<T>();
    const out: T[] = [];
    for (const k of this._range(bounds)) {
      const bucket = this._cells.get(k);
      if (!bucket) continue;
      for (const e of bucket) {
        if (!aabbOverlap(e.bounds, bounds)) continue;
        if (seen.has(e.item)) continue;
        seen.add(e.item);
        out.push(e.item);
      }
    }
    return out;
  }
}

/** Push two overlapping AABBs along the axis of least penetration. */
export function resolvePositional(a: AABB, b: AABB): { ax: number; ay: number; bx: number; by: number } {
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (overlapX < overlapY) {
    const sign = a.x < b.x ? -1 : 1;
    return { ax: (overlapX / 2) * sign, ay: 0, bx: (overlapX / 2) * -sign, by: 0 };
  } else {
    const sign = a.y < b.y ? -1 : 1;
    return { ax: 0, ay: (overlapY / 2) * sign, bx: 0, by: (overlapY / 2) * -sign };
  }
}

/** 1D-along-normal impulse exchange. Returns new velocities. */
export function resolveImpulse(av: Vec2, bv: Vec2, normal: Vec2, restitution = 0.5): { av: Vec2; bv: Vec2 } {
  const rvx = av.x - bv.x;
  const rvy = av.y - bv.y;
  const vn = rvx * normal.x + rvy * normal.y;
  if (vn > 0) return { av, bv };
  const j = -(1 + restitution) * vn;
  return {
    av: { x: av.x + j * normal.x, y: av.y + j * normal.y },
    bv: { x: bv.x - j * normal.x, y: bv.y - j * normal.y },
  };
}

/** Position-Verlet step; pass previous position and acceleration. */
export function verletStep(
  p: Vec2,
  prev: Vec2,
  accel: Vec2,
  dt: number,
  damping = 0,
): { p: Vec2; prev: Vec2 } {
  const d = 1 - damping;
  const nx = p.x + (p.x - prev.x) * d + accel.x * dt * dt;
  const ny = p.y + (p.y - prev.y) * d + accel.y * dt * dt;
  return { p: { x: nx, y: ny }, prev: { x: p.x, y: p.y } };
}
