# Lord-Raven memoria voronoi-influence-map

> Mined 2026-05-24 as prior art for chub-stage-factory primitives library.
> Captured verbatim from the mining run; informs the Wave 2E `VoronoiInfluenceMap` UI primitive design.

---

Repo: https://github.com/Lord-Raven/memoria
File: `src/screens/MapScreen.tsx` — 1,793 lines
Companion: `src/screens/MapCell.tsx` — SVG cell renderer

**What it visualizes.** This is a world-map screen for a visual-novel stage. Each "discovered location" in an atlas is a weighted point with a `radius` (derived from a `weight` property) and an `(x, y)` center. The map renders each location as a circle that bleeds into its Voronoi cell boundary — circle radii determine territory: where two circles' radii would overlap, the shared edge of the Voronoi polygon forms the dividing line between zones. The final shape per cell is the circle polygon clipped to its Voronoi polygon (`clipPolygonWithConvex`), so each cell is always bounded by its circle and naturally "lines up" at intersections.

**Key mechanics.**
- Library: `d3-weighted-voronoi` v1.1.3 (power diagram, not standard Delaunay). Weight is `radius^2`.
- Render target: SVG (`<SVGSVGElement>`, `viewBox` 1000x700). Each cell is an SVG `<path>` via `toPolygonPath()`. No canvas.
- Circle-to-polygon conversion: `createCirclePolygon(cx, cy, radius, segments=32)` generates a 32-gon, then Sutherland-Hodgman clipping (`clipPolygonWithConvex`) intersects it with the Voronoi polygon — this is precisely the "circles with radii where intersections become lines" pattern.
- Animation: `requestAnimationFrame` loop with cubic-ease lerp for point entry (700 ms), hover boost (+30 px radius on hover, 240 ms), and a per-cell sine-wave pulse (50 ms tick, hash-seeded phase/frequency/amplitude). Full-screen expand transition (520 ms) lerps one cell to fill the viewport.
- Hover hit-testing: `isPointInsidePolygon` (ray-cast) with a fallback radius pad (26 px) for touch targets.
- Cell fill: clipped `<image>` with a `<clipPath>` referencing the cell path, overlaid with a themed border color (`themeColor` per location).

**Dependencies.** `d3-weighted-voronoi ^1.1.3`, React 18, Framer Motion (for UI overlays only, not the map itself), MUI, `framer-motion ^10`.

**Reusable design ideas for `VoronoiInfluenceMap<E>`.**
1. The `radius^2` weight scheme maps cleanly to an "influence" magnitude — port it as the generic parameter's influence scalar.
2. `createCirclePolygon` + `clipPolygonWithConvex` is the exact primitive you need: keeps cells circular at low density and turns shared boundaries into straight Voronoi edges at high density.
3. The pulse profile (hash-seeded sine wave per entity ID) is a zero-state animation that gives organic life without external data.
4. Hover intensity as a continuous `[0,1]` float animated via rAF (not CSS transitions) keeps the SVG-path geometry and the visual feedback in sync — important when the geometry itself changes on hover (radius boost shifts cell boundaries).
5. Separate `targetPoints` → `animatedPoints` → `pulsedPoints` pipeline is a clean staged-transform pattern worth replicating as distinct derived signals in the primitive.
