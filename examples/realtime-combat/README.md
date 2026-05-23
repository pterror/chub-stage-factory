# realtime-combat — arena drone fight

Stage exercising `src/lib/combat-realtime.ts`. A bounded arena, one
pilot, drones that spiral in. LLM emits `<shoot>dx,dy</shoot>`; the
stage spawns a bullet AttackDef and runs ~5 ticks of `world.tick(dt)`
before returning. Hit events surface as observation, not prose.

## Primitives

- `combat-realtime` — RealtimeWorld, AttackDef, spawnAttack, tick.
- `physics` — under the hood (SpatialHash + AABB/circle overlap).
- `rng` — cosmetic stream for spawn IDs.

## PATTERNS.md recipe

`## 6. Realtime combat`. Builds on the physics primitive.
