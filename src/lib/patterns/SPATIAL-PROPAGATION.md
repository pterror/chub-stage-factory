# spatial-propagation — room-to-room event spread through the world graph

`spatialPropagationPattern(init)` models wavefront events (fire, infection,
gossip, smoke) that spread across adjacent rooms each tick. One `seed` call
starts a wavefront; repeated `tick` calls propagate it through exits.

Enables Flexible-survival-shape (#7), Facility-management-shape (#20).

## Composed primitives

- `world` — room graph; `exitsFrom` drives adjacency queries
- `trigger` (conceptually) — per-wavefront probability roll + optional spread
  gate predicate
- `timeline` — propagation event log (optional; created if absent)

## API [`src/lib/patterns/spatial-propagation.ts`](./spatial-propagation.ts)

```ts
function spatialPropagationPattern<S, E>(init: SpatialPropagationInit<S, E>): SpatialPropagationBundle<S, E>
```

`WavefrontDef<S, E>`:
- `id: string` — wavefront type name
- `propagationProbability: number` — [0..1] per-exit per-tick roll
- `spreadGate?: Predicate<S>` — gate on destination room (`refs.self = toRoomId`)
- `ttl?: number` — ticks until auto-cleared; omit for indefinite spread
- `payload: E` — stage-author data carried with events

`PropagationEvent<E>`:
- `{ kind: "seeded"; roomId; payload }`
- `{ kind: "spread"; fromRoom; toRoom; payload }`
- `{ kind: "cleared"; roomId; payload }`

`SpatialPropagationInit<S, E>`:
- `world: World`
- `timeline?: Timeline<PropagationEvent<E>>`
- `resolvers?: Resolvers<S, any>`
- `includeHidden?: boolean` — whether hidden exits propagate (default false)

`SpatialPropagationBundle<S, E>`:
- `.seed(roomId, def)` — start or reset a wavefront
- `.tick(now, state, refs, rng)` → `PropagationEvent<E>[]`
- `.wavefronts()` → `Map<string, { def; ttlRemaining? }>`
- `.clear(roomId?)` — remove one room's wavefront or all wavefronts

## Example

```ts
import { spatialPropagationPattern } from "./lib/patterns/spatial-propagation";

const fire = spatialPropagationPattern<MyState, "fire">({ world, resolvers });

fire.seed("storage-room", {
  id: "fire",
  propagationProbability: 0.3,
  ttl: 10,
  payload: "fire",
});

// Each tick:
const events = fire.tick(now, state, refs, rng);
for (const ev of events) {
  if (ev.kind === "spread") notifyRoomOnFire(ev.toRoom);
}
```

## Gotchas

- Spread probability is rolled independently per exit per tick. A room with 4
  exits at 0.3 probability has a ~76 % chance of spreading to at least one
  neighbour each tick.
- Rooms already holding an active wavefront are skipped (no double-seeding per
  tick). A room can hold only one wavefront per `seed` call.
- Hidden exits block propagation by default. Set `includeHidden: true` to let
  wavefronts spread through hidden passages (e.g. ventilation in a facility sim).
- The `spreadGate` predicate receives `refs.self = toRoomId` (a room id, not an
  actor id). Predicates that resolve actor-specific refs will not work here;
  use `world-flag` or `custom` predicates for room-level gates.
