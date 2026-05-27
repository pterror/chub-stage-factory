# World — graph of places with scope queries

`World` is a directed graph of `Room`s with named exits and a single
location index `entityId → roomId`. Entities (actors, items, scenery) are
bare ids the world doesn't introspect; the stage decides what kinds they
represent. `scope(observerId)` returns the set of exit names + co-located
entity ids — the input `parseIntent` from `intent.ts` consumes.

Used by parser-IF stages (Zork-shape, CCA-shape, HHGTTG-shape), the
world-primary frontend shape, and Wave 3 composers `worldExplorationPattern`,
`subjectSandboxPattern`, `slotAssignmentPattern`, `spatialPropagationPattern`.

## Concepts

**Room** holds `id`, `name`, `description`, an `exits: Record<dir, Exit>`
map, and free-form `tags?`. Directions are arbitrary strings; the
conventional set `n/s/e/w/ne/nw/se/sw/up/down/in/out` matches the verb
synonyms shipped by `intent.ts`.

**Exit** has `to` (destination room id), optional `gate: Predicate` evaluated
through caller-supplied resolvers on `move()`, and optional `hidden` to keep
it out of `scope()` until a `revealFlag` hook permits.

**Scope** = exit names + co-located entity ids (minus observer), optionally
unioned with the observer's carried-item ids via the `includeCarried` hook.
That hook is how `inventory.ts` participates without coupling.

**Events** (`WorldEvent`): `entered`, `exited`, `located`, `detached`. Returned
from `locate`/`move`/`detach`; the caller pushes them to its `Timeline`.
World owns no Timeline.

## API [`src/lib/world.ts`](./world.ts#L107-L319)

- `new World({ rooms?, locations? })` — construct with optional preload
- `world.addRoom(room)` — register a Room
- `world.getRoom(id)` / `world.rooms()` — lookup, list
- `world.connect(a, dir, b, reverseDir?, opts?)` — symmetric-or-not edge helper
- `world.locate(entityId, roomId)` — place; emits exited+entered or located
- `world.detach(entityId)` — remove from world; emits `detached` or null
- `world.where(entityId)` — current roomId or null
- `world.entitiesAt(roomId)` — co-located entity ids
- `world.move(entityId, direction, resolvers?)` — graph traversal; null on bad dir / failed gate
- `world.scope(observerId, opts?)` — visible/addressable set for `parseIntent`
- `world.exitsFrom(roomId, opts?)` — visible exits (honours hidden + gates)
- `world.describe(roomId, opts?)` — room description + entity list
- `world.toJSON()` / `World.fromJSON(data)` — persistence

Implements `ObservationSource<unknown>` on the `visual` channel; supplies
`rooms` (id+name list) and `locations` (entityId→roomId map).

Helper `worldResolvers(world)` returns `{ getLocation }` suitable for
spreading into a `predicate.ts` resolver bundle.

## Example

```ts
import { World } from "./lib/world";
import { parseIntent } from "./lib/intent";

const world = new World()
  .addRoom({ id: "square", name: "Village Square", description: "Dusty heart of the settlement.", exits: {} })
  .addRoom({ id: "inn",    name: "The Inn",        description: "Low-beamed, candle-lit.",         exits: {} })
  .addRoom({ id: "market", name: "Market Stalls",  description: "Weathered stalls in wind.",        exits: {} });

world.connect("square", "north", "inn",    "south");
world.connect("square", "east",  "market", "west");

world.locate("player",     "square");
world.locate("elder-mira", "square");
world.locate("map-fragment", "square");

const intent = await parseIntent("take map-fragment", world.scope("player"));
//  → { verb: "take", target: "map-fragment" }

const events = world.move("player", "north");
//  → [{ kind: "exited", entityId: "player", roomId: "square", to: "inn" },
//     { kind: "entered", entityId: "player", roomId: "inn", from: "square" }]
```

## Gotchas

- `connect` requires both rooms to already be registered — programmer error
  if not (throws). `addRoom` first, then `connect`.
- `locate` to the same room is a no-op and returns `[]` (not null).
- `move` returns `null` for unknown direction *or* failed gate predicate.
  Caller cannot distinguish; query `exitsFrom` first if the distinction
  matters.
- Hidden exits are still traversable via `move` — `hidden` only affects
  visibility surfaces (`scope`, `exitsFrom`). The stage author enforces
  "must be revealed to enter" via a gate predicate.
- Entity kind is opaque to World — it does not know a player from a candle.
  Two-way location consistency is invariant: `locationOf` and the
  per-room `Set` always agree.
- `JSON.parse` round-tripping `Room.exits` re-creates plain-object exits;
  gates serialized as predicate-data round-trip fine, but `custom`
  predicate ids only resolve if the stage re-registers them in its
  resolver bundle (same rule as `predicate.ts`).
