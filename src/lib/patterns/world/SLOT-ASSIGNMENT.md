# slot-assignment — worker-to-room-slot assignment with per-slot constraints

`slotAssignmentPattern(init)` models the facility-management mechanic of
assigning worker actors to named room slots. Each slot has a capacity and an
optional `Predicate<S>` constraint gate. The ledger is a private map; the
pattern exposes typed query helpers.

Enables Facility-management-shape (#20).

## Composed primitives

- `world` — rooms as the slot namespace (validates `roomId` on assign)
- `actor` — worker ids are opaque strings; the pattern does not inspect actors
- `predicate` — per-slot constraint gate; `refs.self` is the candidate actor id

## API [`src/lib/patterns/slot-assignment.ts`](./slot-assignment.ts)

```ts
function slotAssignmentPattern<S>(init: SlotAssignmentInit<S>): SlotAssignmentBundle<S>
```

`SlotDef<S>`:
- `roomId: string`
- `slotName: string`
- `capacity?: number` — default 1
- `constraint?: Predicate<S>` — gate evaluated against `refs.self = actorId`

`SlotAssignmentInit<S>`:
- `world: World`
- `slotDefs: readonly SlotDef<S>[]`
- `resolvers?: Resolvers<S, any>`

`SlotAssignmentBundle<S>`:
- `.assign(actorId, roomId, slotName, state, refs)` → `AssignResult`
  - `{ ok: true }` or `{ ok: false; reason: "constraint-failed" | "slot-full" | "unknown-room" }`
- `.unassign(actorId)` — remove from current slot (no-op if unassigned)
- `.slotFor(actorId)` → `{ roomId, slotName } | null`
- `.actorsAt(roomId, slotName?)` → `string[]`
- `.isSlotFull(roomId, slotName)` → `boolean`

## Example

```ts
import { slotAssignmentPattern } from "./lib/patterns/slot-assignment";

const slots = slotAssignmentPattern({
  world,
  slotDefs: [
    { roomId: "kitchen", slotName: "cook", capacity: 2 },
    { roomId: "lobby",   slotName: "receptionist",
      constraint: { kind: "tag-on", target: "self", tag: "trained" } },
  ],
});

const result = slots.assign("worker-1", "kitchen", "cook", state, refs);
if (result.ok) world.locate("worker-1", "kitchen");

console.log(slots.actorsAt("kitchen", "cook")); // ["worker-1"]
```

## Gotchas

- `assign` does NOT call `world.locate` — the caller co-locates the actor in the
  world separately if desired. The pattern tracks the assignment ledger only.
- Slots not listed in `slotDefs` still accept assignments (default capacity 1,
  no constraint). Add an explicit `SlotDef` to impose constraints.
- The assignment ledger is in-memory; persist `slotFor`/`actorsAt` data through
  your stage's Shard if needed.
