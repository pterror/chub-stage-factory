# physics — throw-objects sandbox

Stage exercising `src/lib/physics.ts`. The room is a 200×120 AABB with
three obstacles indexed in a SpatialHash. The LLM emits
`<throw>x,y,vx,vy</throw>`; the stage steps a small AABB projectile
through the room with wall + obstacle bounces (via `resolvePositional`)
and friction, then surfaces the `hit` list and final position via
observation.

## Primitives

- `physics` — AABB, SpatialHash, aabbOverlap, resolvePositional.
- `rng` — cosmetic stream for bounce jitter.
- `observation` — room + last-throw outcome.

## PATTERNS.md recipe

`## 7. Physics`. Foundation for the realtime-combat example.
