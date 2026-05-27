# `3d/ui/VoronoiInfluenceMap3D` — 3D spheres-of-influence

3D analogue of `ui/voronoi-influence-map.tsx`. Renders each entity as a
translucent sphere at `(x, y, z)` with radius=`radius`. Sphere overlap
visually communicates territory contention via additive transparency.

## Why not real 3D Voronoi?

True 3D weighted Voronoi diagrams are O(n²) or worse and add no
representational value for the common case (faction territory, threat
zones, NPC awareness radii, spatial audio coverage). The screen-space 2D
version uses real Voronoi because the cells need crisp boundaries; in 3D
the overlap *is* the boundary signal.

## Props

- `entities: VoronoiEntity3D<E>[]` — id, x/z (+ optional y), radius, data,
  optional color.
- `opacity?: number` — material opacity per sphere. Default 0.35.
- `flat?: boolean` — render as Y-flattened disc (scale.y = 0.05) for
  top-down strategy maps. Default false (full sphere).
- `onEntityClick`, `onEntityHover` — pointer event handlers.

## Example

```tsx
<ThreeScene cameraRig={<TopDownRig />}>
  <ambientLight />
  <VoronoiInfluenceMap3D
    entities={factions.map((f) => ({
      id: f.id, x: f.capital.x, z: f.capital.z, radius: f.influence, data: f,
    }))}
    flat
    onEntityClick={(e) => stage.invokeVerb("inspect-faction", { id: e.id })}
  />
</ThreeScene>
```

## Material caveat

`depthWrite: false` prevents the spheres from occluding each other and
the world geometry behind them — overlap is the entire point of the
visualization. If you need solid spheres for some other purpose, use a
plain `<mesh>` directly rather than this primitive.
