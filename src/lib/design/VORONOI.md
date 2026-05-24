# Wave 2E VoronoiInfluenceMap design
> Synthesized 2026-05-24 from src/lib/mining/VORONOI.md + ROADMAP Wave 2E spec.
> Implementation-ready: concrete API, dependency choice + animation pipeline fixed.
---

## API surface

```ts
type Polygon = [number, number][];

interface VoronoiEntity<E> {
  id: string;
  x: number;             // logical position
  y: number;
  radius: number;        // influence magnitude → weight = radius²
  data: E;               // stage-provided per-entity payload
  themeColor?: string;
  imageUrl?: string;     // optional cell-fill image
}

interface VoronoiInfluenceMapProps<E> {
  entities: VoronoiEntity<E>[];
  viewBox?: { width: number; height: number };  // default 1000×700 per Lord-Raven
  segments?: number;                             // circle polygon resolution, default 32
  animations?: {
    pulse?: boolean | { period: number; amplitude: number };
    hoverBoost?: boolean | { boostPx: number; durationMs: number };
    entryLerp?: boolean | { durationMs: number };
  };
  onEntityClick?: (e: VoronoiEntity<E>) => void;
  onEntityHover?: (e: VoronoiEntity<E> | null) => void;
  renderCell?: (e: VoronoiEntity<E>, polygon: Polygon) => ReactNode;  // override default cell render
}

function VoronoiInfluenceMap<E>(props: VoronoiInfluenceMapProps<E>): JSX.Element;
```

## Dependency choice

**`d3-weighted-voronoi` v1.1.x** (power diagram, `weight = radius²`).

Justification: no JS alternative handles weighted Voronoi. `d3-delaunay` / `d3-voronoi` produce unweighted diagrams — equal-area territory regardless of radius. `d3-weighted-voronoi`'s power diagram is exactly the "circles where intersections become shared boundary lines" model: cell bisectors are positioned by radius² balance. Direct dependency (not peer dep) — ~10KB minified, no conflicting transitive deps.

## Render pipeline

Three-stage transform, one rAF loop:

**Stage 1 — `targetPoints`.** Raw `VoronoiEntity<E>[]` array. Updated on props change only.

**Stage 2 — `animatedPoints`.** Cubic-ease lerp toward `targetPoints` on entry (default 700ms). On hover, `hoverIntensity ∈ [0,1]` lerps to 1.0 over `hoverBoost.durationMs` (default 240ms); hovered entity's radius gets `+boostPx * hoverIntensity` (default +30px). Both transforms share one rAF tick.

**Stage 3 — `pulsedPoints`.** Per-entity sine-wave radius modulation: `pulsedRadius = animatedRadius + amplitude * sin(2π * t / period + hashPhase(id))`. `hashPhase` = `djb2(id) % 1000 / 1000`. Defaults: period=3000ms, amplitude=4px.

**Cell geometry per entity:** `createCirclePolygon(cx, cy, pulsedRadius, segments=32)` → 32-gon, Sutherland-Hodgman `clipPolygonWithConvex` against the `d3-weighted-voronoi` polygon → final `Polygon` → `toPolygonPath()` → SVG `d`.

## SVG vs canvas

SVG, per Lord-Raven. One `<path>` per cell, `d={toPolygonPath(clippedPolygon)}`. Reasons: hover hit-testing via DOM pointer events; CSS theming (`themeColor` as `fill`/`stroke`/`drop-shadow`); `ResizeObserver`-aware `viewBox` update. Canvas is the optimization path for N > ~50; no canvas code in Wave 2E.

## Composition with existing primitives

**`observation.ts`** — natural render target for spatially-aware `ObservationSource` data. `salience → radius`, channel values → `data: E`. Makes the attention model visible.

**`actor.ts`** (Wave 1) — `Actor.location → {x, y}`, `Actor.stats["influence"] → radius`. `ActorPool.map(actor => toVoronoiEntity(actor))` is the one-liner bridge. `themeColor` from faction tag via `tags.ts`.

**`world.ts`** (Wave 2B) — room-as-seed-point + connectivity score → radius visualizes spatial projection of the world graph.

**`tags.ts`** — `entity.themeColor` by tag query: `tags.query(actor.tags, "faction:*")?.color`.

## Animation system

Manual `requestAnimationFrame` loop, not CSS transitions or Framer Motion applied to geometry.

Rationale: `hoverBoost` shifts an entity's radius, which shifts every cell boundary. CSS `transition` on `d` attributes is a string diff — browsers don't interpolate path geometry. Framer Motion layout animations apply to element position/scale, not polygon vertices. The rAF loop drives `pulsedPoints` and re-renders `d` each frame, keeping geometry and visual feedback in sync at 60fps.

Trade-off: the loop runs unconditionally when `pulse` is enabled. Acceptable for N < 50. Gate on `document.visibilityState`; pause when all lerps settle (delta < 0.5px).

## Hover hit-testing

Port Lord-Raven's two-tier pattern:

1. **Ray-cast (`isPointInsidePolygon`).** Even-odd rule: cast a ray from the test point in the +x direction; count intersections with polygon edges; odd = inside. O(N·segments) per pointer-move event; negligible for N < 50.
2. **Fallback radius (26px).** If ray-cast misses all polygons (pointer between thin adjacent cells, or on a clip boundary), find the nearest seed point within 26px and report that entity. 26px matches Lord-Raven's verified mobile-touch-target threshold.

Why two tiers: thin Voronoi cells near the map edge can be geometrically correct but physically un-tappable on a touch device. The radius fallback recovers touch usability without expanding all polygons.

## Full-screen expand transition

Optional; triggered by `onEntityActivate`. 520ms cubic-ease lerp from the entity's polygon bounding box to `{0, 0, viewBox.width, viewBox.height}`; other cells fade to 0. On completion the caller mounts the per-entity detail UI. `onEntityDeactivate()` reverses. The component manages the lerp; the stage author provides the two callbacks.

## File layout

```
src/lib/ui/voronoi-influence-map.tsx   — the component (rAF loop, SVG render, hit-test dispatch)
src/lib/ui/voronoi-utils.ts            — pure functions: createCirclePolygon, clipPolygonWithConvex,
                                         isPointInsidePolygon, toPolygonPath, djb2Hash, hashPhase
src/lib/UI-VORONOI.md                  — per-pattern usage doc (separate from this design file)
```

`voronoi-utils.ts` contains no React, no d3 imports. Fully unit-testable. The component imports both utils and `d3-weighted-voronoi`; the utils import nothing external.

## Estimated LOC + complexity

| File | Estimated LOC | Notes |
|------|---------------|-------|
| `voronoi-influence-map.tsx` | ~300 | rAF loop + three-stage transform + SVG render + hit-test + expand transition |
| `voronoi-utils.ts` | ~150 | Pure geometry: circle-polygon, Sutherland-Hodgman, ray-cast, path serializer, hash helpers |
| **Total** | **~450** | |

Complexity is concentrated in the d3-weighted-voronoi adapter (input shape, output polygon format) and the three-stage animation pipeline. The Sutherland-Hodgman implementation is ~40 lines; the rAF driver is ~60 lines. Nothing architecturally novel beyond Lord-Raven's verified prior art.

## Open questions

1. **Theme color sourcing.** Per-entity `themeColor` prop vs. `renderCell` override. Current proposal: both — `themeColor` is the convenience path; `renderCell` overrides it entirely. If a stage wants tag-driven color, it derives `themeColor` in the `entities` map and doesn't touch `renderCell`.

2. **Image fill.** SVG `<clipPath>` referencing the cell `<path>` id (Lord-Raven's choice) vs. a separate `<image>` element masked by the polygon. `<clipPath>` is correct: it composites the image inside the clip boundary without a second pass. The separate-image approach requires manual polygon-as-mask which is identical work with worse browser compatibility. Ship `<clipPath>`.

3. **Bundle size.** `d3-weighted-voronoi` is ~10KB minified. Acceptable — core UI module budget is generous (no WASM, no Three.js). Not a candidate for dynamic import.
