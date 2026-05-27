# Physics — collision primitives and spatial broadphase

`physics.ts` provides 2D collision detection types, a spatial hash for
broadphase queries, positional and impulse resolution helpers, and a
Verlet integrator. It is not a physics engine — just enough to answer
"did the projectile hit the wall" and "where is the actor after `dt`".

## API

**Types**

- `interface Vec2 { x, y }` (`src/lib/physics.ts:31-34`)
- `interface AABB { x, y, w, h }` (`src/lib/physics.ts:36-41`)
- `interface Circle { x, y, r }` (`src/lib/physics.ts:43-47`)
- `interface Segment { x1, y1, x2, y2 }` (`src/lib/physics.ts:49-54`)

**Collision tests** (all return `boolean`)

- `aabbOverlap(a, b)` (`src/lib/physics.ts:56-58`)
- `aabbContains(a, p)` — point-in-AABB (`src/lib/physics.ts:60-62`)
- `circleOverlap(a, b)` (`src/lib/physics.ts:64-68`)
- `circleAabbOverlap(c, a)` (`src/lib/physics.ts:70-76`)
- `segmentAabb(s, a)` — slab method (`src/lib/physics.ts:79-110`)

**Spatial hash**

- `class SpatialHash<T>` (`src/lib/physics.ts:112-158`)
  - `constructor(cellSize)`
  - `insert(item, bounds)` — item registered in every overlapping cell
  - `clear()` — O(cells), called each tick before rebuild
  - `query(bounds): T[]` — deduped candidates whose AABB overlaps `bounds`

**Resolution**

- `resolvePositional(a, b): { ax, ay, bx, by }` — pushes two overlapping AABBs along the axis of least penetration; apply deltas to positions (`src/lib/physics.ts:161-171`)
- `resolveImpulse(av, bv, normal, restitution=0.5): { av, bv }` — 1D-along-normal impulse exchange; returns new velocities unchanged if bodies are separating (`src/lib/physics.ts:174-183`)
- `verletStep(p, prev, accel, dt, damping=0): { p, prev }` — position Verlet; pass previous position and acceleration; returns new `p` and updated `prev` (`src/lib/physics.ts:186-198`)

## Gotchas

- `SpatialHash` has no deduplication on `insert` — inserting the same item
  twice will return it twice from `query`. `combat-realtime.ts` rebuilds
  the hash from scratch each tick via `clear()`.
- `resolvePositional` splits penetration 50/50. For static-vs-dynamic
  resolution apply only the dynamic body's delta and discard the other.
- `verletStep` does not clamp to bounds; call site is responsible for
  clamping after the step.
