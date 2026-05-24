/**
 * voronoi-utils.ts — pure geometry helpers for VoronoiInfluenceMap.
 *
 * No React, no d3 imports. Fully unit-testable.
 *
 * Exports:
 *   createCirclePolygon   — approximate circle as N-gon
 *   clipPolygonWithConvex — Sutherland-Hodgman polygon clipping
 *   isPointInsidePolygon  — ray-cast even-odd rule
 *   toPolygonPath         — polygon → SVG path string
 *   djb2Hash              — deterministic string hash
 *   hashPhase             — per-entity animation phase offset [0, 1)
 */

export type Polygon = [number, number][];
export type Point = [number, number];

// ---------------------------------------------------------------------------
// Circle approximation
// ---------------------------------------------------------------------------

/**
 * Generate a regular N-gon approximating a circle.
 * Used as the "influence radius" shape before Voronoi clipping.
 */
export function createCirclePolygon(
  cx: number,
  cy: number,
  radius: number,
  segments = 32,
): Polygon {
  const poly: Polygon = [];
  for (let i = 0; i < segments; i++) {
    const angle = (2 * Math.PI * i) / segments;
    poly.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return poly;
}

// ---------------------------------------------------------------------------
// Sutherland-Hodgman polygon clipping
// ---------------------------------------------------------------------------

/**
 * Clip `subject` polygon against each edge of the convex `clip` polygon.
 * Returns the intersection polygon, or [] if fully clipped away.
 *
 * The clip polygon must be convex and have vertices in counter-clockwise order
 * (as produced by d3-weighted-voronoi). If the clip polygon is clockwise,
 * results may be inverted — but d3-weighted-voronoi outputs CCW by default.
 */
export function clipPolygonWithConvex(subject: Polygon, clip: Polygon): Polygon {
  if (clip.length < 3 || subject.length < 3) return [];

  let output: Polygon = subject.slice();

  for (let i = 0; i < clip.length; i++) {
    if (output.length === 0) return [];
    const edgeStart = clip[i];
    const edgeEnd = clip[(i + 1) % clip.length];
    const input = output;
    output = [];

    for (let j = 0; j < input.length; j++) {
      const current = input[j];
      const previous = input[(j + 1) % input.length];

      if (_inside(current, edgeStart, edgeEnd)) {
        if (!_inside(previous, edgeStart, edgeEnd)) {
          const ix = _intersect(previous, current, edgeStart, edgeEnd);
          if (ix) output.push(ix);
        }
        output.push(current);
      } else if (_inside(previous, edgeStart, edgeEnd)) {
        const ix = _intersect(previous, current, edgeStart, edgeEnd);
        if (ix) output.push(ix);
      }
    }
  }

  return output;
}

/** Point is on the "inside" of a directed edge (left side, CCW winding). */
function _inside(p: Point, a: Point, b: Point): boolean {
  // Cross product sign: (b - a) × (p - a) > 0 means inside CCW polygon edge
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
}

/** Compute intersection of segment (p1→p2) with edge line (a→b). */
function _intersect(p1: Point, p2: Point, a: Point, b: Point): Point | null {
  const x1 = p1[0], y1 = p1[1];
  const x2 = p2[0], y2 = p2[1];
  const x3 = a[0], y3 = a[1];
  const x4 = b[0], y4 = b[1];

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-10) return null; // parallel

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

// ---------------------------------------------------------------------------
// Point-in-polygon — ray-cast even-odd rule
// ---------------------------------------------------------------------------

/**
 * Test whether (px, py) lies inside `polygon` using the even-odd (ray-cast) rule.
 * Casts a ray in the +x direction and counts edge crossings; odd = inside.
 */
export function isPointInsidePolygon(px: number, py: number, polygon: Polygon): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersects =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// SVG path serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a polygon to an SVG `d` attribute string.
 * Produces a closed path: M … L … Z
 */
export function toPolygonPath(poly: Polygon): string {
  if (poly.length === 0) return "";
  const [first, ...rest] = poly;
  const parts: string[] = [`M${first[0].toFixed(2)},${first[1].toFixed(2)}`];
  for (const [x, y] of rest) {
    parts.push(`L${x.toFixed(2)},${y.toFixed(2)}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Hash helpers for animation phase seeding
// ---------------------------------------------------------------------------

/**
 * djb2 hash: deterministic 32-bit hash from a string.
 * Returns an unsigned integer.
 */
export function djb2Hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * Per-entity animation phase offset in [0, 1).
 * Seeded by entity id so each entity pulses at a different phase.
 */
export function hashPhase(id: string): number {
  return (djb2Hash(id) % 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Bounding box (used for expand-transition)
// ---------------------------------------------------------------------------

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Compute axis-aligned bounding box of a polygon. */
export function polygonBBox(poly: Polygon): BBox {
  if (poly.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = poly[0][0], maxX = poly[0][0];
  let minY = poly[0][1], maxY = poly[0][1];
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Linear interpolation between two values. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Cubic ease-in-out: smooth acceleration and deceleration. */
export function cubicEase(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
