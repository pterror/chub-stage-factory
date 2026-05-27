# `3d/ui/GraphView3D` — 3D nodes + edges

3D variant of the (still pending) 2D GraphView primitive. Renders nodes as
spheres and edges as oriented cylinders. **Layout is consumer-provided** —
position your nodes via procgen, force-directed simulation, dagre, or
hand-authored coordinates and pass them in.

## Why layout-as-separate-concern

Layout algorithms are a deep space (force-dir, hierarchical, radial,
geographic, ...) and the right one depends entirely on the data. Hardcoding
one inside the primitive makes the primitive less useful in 80% of cases.
The component renders what you tell it to render.

For force-directed layouts, compose with `d3-force-3d`, `three-forcegraph`,
or run a small simulation in a `useFrame` callback and feed the positions
back in.

## Props

- `nodes: GraphNode3D<N>[]` — `id`, `position: [x, y, z]`, `data`, optional
  `radius`, `color`.
- `edges: GraphEdge3D<E>[]` — `from`, `to` (node ids), optional `data`,
  `width`, `color`.
- `onNodeClick`, `onNodeHover` — pointer event handlers.

## Example

```tsx
<ThreeScene cameraRig={<ThirdPersonRig target={[0, 0, 0]} />}>
  <ambientLight />
  <GraphView3D
    nodes={rooms.map((r) => ({
      id: r.id, position: [r.x, 0, r.z], data: r, color: r.faction.color,
    }))}
    edges={connections.map((c) => ({ from: c.fromId, to: c.toId }))}
    onNodeClick={(n) => stage.invokeVerb("go-to-room", { id: n.id })}
  />
</ThreeScene>
```

## Performance

- Edges allocate one mesh + one cylinder geometry per edge per render.
  For graphs >~500 edges, consider migrating to instanced rendering
  (the primitive doesn't do this — it's optimized for the small-graph
  authoring case).
- The Vector3/Quaternion math runs per render; for static graphs, wrap
  the parent in `<group>` and memoize externally.
