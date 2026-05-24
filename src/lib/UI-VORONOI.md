# UI Pattern: VoronoiInfluenceMap

> Wave 2E UI primitive. Renders weighted Voronoi cells where each entity's
> `radius` drives its territory: circles bleed up to their radius, and the
> power-diagram boundary becomes the dividing line between zones.

---

## When to reach for this

Use `VoronoiInfluenceMap<E>` when you need to visualize *spatial influence*
rather than discrete ownership. The signature question: "does this entity's
territory shrink when a neighbour grows?" If yes, this is the right primitive.

Canonical use cases across the catalog:

- **Faction territory maps** — factions as entities, reputation/power → radius.
  `themeColor` from `tags.query(actor.tags, "faction:*")?.color`.
- **NPC awareness / threat zones** — actors with perception radius; overlap
  visualizes contested attention. Composes with `observation.ts`.
- **World-graph spatial projection** — rooms as seed points, connectivity
  score → radius (Wave 2B). Shrinking a room's influence reads as isolation.
- **Audio coverage** — positional sound sources; overlapping cells show
  interference zones. Composes with Wave 2G sensory.
- **Actor influence** — `actor.stats["influence"] → radius`, `actor.location →
  {x, y}`. One-liner bridge: `actors.map(toVoronoiEntity)`.

## Minimal usage

```tsx
import { VoronoiInfluenceMap } from "@/lib/ui/voronoi-influence-map";

const entities = actors.map(a => ({
  id: a.id,
  x: a.location.x,
  y: a.location.y,
  radius: a.stats.influence ?? 60,
  data: a,
  themeColor: tags.query(a.tags, "faction:*")?.color,
}));

<VoronoiInfluenceMap
  entities={entities}
  onEntityClick={a => openActorPanel(a.data)}
  onEntityHover={a => setTooltip(a?.data.name ?? null)}
/>
```

## Props reference

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `entities` | `VoronoiEntity<E>[]` | required | `radius` → power-diagram weight (`radius²`) |
| `viewBox` | `{ width, height }` | `1000 × 700` | Logical coordinate space |
| `segments` | `number` | `32` | Circle polygon resolution; 16 is fine for small N |
| `animations.pulse` | `bool \| { period, amplitude }` | enabled | Sine-wave radius modulation per entity. period=3000ms, amplitude=4px |
| `animations.hoverBoost` | `bool \| { boostPx, durationMs }` | enabled | Radius boost on hover. +30px, 240ms |
| `animations.entryLerp` | `bool \| { durationMs }` | enabled | Entry lerp from r=0. 700ms |
| `onEntityClick` | `(e) => void` | — | Fired on click; uses same two-tier hit-test as hover |
| `onEntityHover` | `(e \| null) => void` | — | Null on pointer leave |
| `onEntityActivate` | `(e) => void` | — | Triggers 520ms expand transition; call `onEntityDeactivate()` to reverse |
| `onEntityDeactivate` | `() => void` | — | Triggers expand reversal |
| `renderCell` | `(e, polygon) => ReactNode` | — | Override default cell render entirely |

## Connecting to observation.ts

`ObservationSource` salience maps directly to radius:

```ts
function observationToEntities(obs: ObservationResult[]): VoronoiEntity<ObservationResult>[] {
  return obs.map(o => ({
    id: o.sourceId,
    x: o.position.x,
    y: o.position.y,
    radius: 20 + o.salience * 80, // salience [0,1] → radius [20, 100]
    data: o,
  }));
}
```

## Custom cell renderer

`renderCell` receives the entity and the computed clipped polygon. Use it for
anything beyond the default path+image+label:

```tsx
renderCell={(entity, polygon) => (
  <>
    <path d={toPolygonPath(polygon)} fill={entity.data.factionColor} fillOpacity={0.4} />
    <text x={entity.x} y={entity.y} textAnchor="middle">{entity.data.name}</text>
  </>
)}
```

Import `toPolygonPath` from `@/lib/ui/voronoi-utils`.

## Animation notes

The rAF loop runs while any lerp is unsettled (entry or hover) and always
while `pulse` is enabled. For static read-only maps with no hover interaction,
pass `animations={{ pulse: false }}` to idle the loop after entry completes.

Hover hit-testing uses two tiers: ray-cast first, then a 26px nearest-seed
fallback for thin cells near the map edge (verified mobile touch threshold
from Lord-Raven's prior art).

## Dependency

`d3-weighted-voronoi ^1.1.3` — power diagram library (~10KB minified).
Added as a regular dependency in `package.json`.

`voronoi-utils.ts` (pure functions: `createCirclePolygon`,
`clipPolygonWithConvex`, `isPointInsidePolygon`, `toPolygonPath`, `djb2Hash`,
`hashPhase`) has no external dependencies and is fully unit-testable.
