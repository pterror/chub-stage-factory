# Wave 2B WORLD design
> Synthesized 2026-05-27 from ROADMAP Wave 2B spec + `examples/world-primary/Stage.tsx`
> (the demand signal — hand-rolls every concept this primitive captures) +
> `src/lib/intent.ts` header ("`world.ts` scope integration" gap).
> Implementation-ready: concrete API, key decisions made, file layout fixed.

---

## What `world.ts` represents

A **graph of `Room`s** with named exits, each room holding **located entities**
(actors, items, scenery). Plus a **scope query** layer that resolves "what can
the player see / refer to / interact with from here?" — the missing piece
`intent.ts` documented but never got.

Concretely, parser-IF axis (Zork / CCA / HHGTTG) wants:

1. `world.rooms` — registry of `Room { id, name, description, exits, contents }`.
2. `world.locate(entityId, roomId)` — put an entity at a room (or detach).
3. `world.move(actorId, direction)` — graph traversal via exit name.
4. `world.scope(observerId)` — visible/addressable entity ids from a vantage.
5. `world.where(entityId)` — reverse lookup.
6. Serialisable, restoration-friendly, ObservationSource-compatible.

## What it does NOT do

- **No inventory mechanics.** Items at a room are bare ids; possession +
  carry-class lives in `inventory.ts`. Room contents are just "located here."
- **No NPC AI / scheduler.** Movement of NPCs is the caller's job; `world`
  provides `locate` so the caller can implement schedulers / wanderers.
- **No prose generation.** Room descriptions are strings the stage author
  supplies; rendering is the caller's job. We expose `describe(roomId)` as
  a convenience that concatenates room desc + visible entities, but it's a
  helper, not a renderer.
- **No physics, lighting, doors-as-state.** Exits can be conditionally gated
  via an optional `Predicate` (composes with `predicate.ts`); anything more
  elaborate is stage-author territory.
- **No coordinates / 2D layout.** Graph topology only. `TileGrid` (Wave 2E)
  + `physics.ts` cover spatial.
- **No multi-world / dimension stacking.** One `World` instance == one
  topology. Compose multiple if needed.

## Room-graph topology

```ts
interface Room {
  id: string;
  name: string;
  description: string;
  exits: Record<string, Exit>;   // "north" → Exit
  tags?: string[];               // free-form for stage queries
}

interface Exit {
  to: string;                    // room id
  gate?: Predicate<unknown>;     // optional gating, evaluated by stage resolvers
  hidden?: boolean;              // omitted from scope unless flag set
}
```

Exits are **directional**. To make a two-way exit, the stage author registers
both — explicit beats clever defaults. Helper `connect(a, dir, b, reverseDir)`
exists for the common case.

Direction labels are arbitrary strings; convention is `n/s/e/w/ne/nw/se/sw/up/down/in/out`
but `"through-the-arch"` works. This matches the synonym table in `intent.ts`
which already canonicalises "enter" → "go" and routes the noun (room/exit name)
as the `target`.

## Item / actor location

Entities are tracked by id in a single **location index**
`Map<entityId, roomId>`. Symmetric lookup `Map<roomId, Set<entityId>>` is
maintained internally; both stay consistent via `locate()` mutations.

Entity-kind (actor vs item vs scenery) is **not** modelled here — the world
just knows "this id is at this room." The stage decides what id-prefixes /
registries to use; this primitive stays generic, per Rule #1 (tag-based
identity).

For finer-grained spatial relations within a room (on/under/inside furniture),
use `inventory.ts` spots — a room is a top-level locus; furniture is an
inventory spot belonging to a scenery entity. The two compose.

## Scope queries — `intent.ts`'s missing piece

```ts
world.scope(observerId, options?): Set<string>
```

Returns the set of entity ids and exit names addressable from the observer's
current room. The default scope includes:

- All exit direction names from the current room.
- All entity ids located at the current room (other than the observer itself).
- Optional: ids "carried by" the observer if a `getCarried(id)` hook is
  passed (lets inventory items participate in scope without coupling).
- Hidden exits are excluded unless a `revealFlag` predicate passes.

This is exactly what `parseIntent(input, scope, …)` consumes today — the
`world-primary` example hand-builds this Set every turn. `world.ts` makes it
a one-liner: `parseIntent(text, world.scope("player"), opts)`.

## Composition with adjacent primitives

| Primitive       | Composition                                                         |
|-----------------|---------------------------------------------------------------------|
| `intent.ts`     | `world.scope(observerId)` feeds `parseIntent` scope arg directly.   |
| `scene.ts`      | A Scene's participants are located via `world.locate(id, roomId)`; when a Scene ends, participants stay where they were placed. World does not own scenes. |
| `actor.ts`      | Actors are entities; `world.locate(actor.id, room)` places them. No structural link — actor.ts knows nothing about world. |
| `inventory.ts`  | Furniture / containers are entities-with-inventories; carry-class transitions on `world.move` can be triggered by the caller via `inv.resolveLeaveLocation`. |
| `timeline.ts`   | World emits `WorldEvent` (`entered`, `exited`, `located`, `detached`) — caller pushes to its Timeline. World does not own a Timeline. |
| `observation.ts`| World implements `ObservationSource<unknown>` so room contents + current location surface to the LLM context without hand-wiring. |
| `predicate.ts`  | Exit `gate` is a `Predicate`; `getLocation` resolver on the stage's predicate-resolver bundle delegates to `world.where`. |
| `context.ts`    | `worldStateContributor(world, observerId)` (referenced in ROADMAP §"Wave 2F deliverables") is trivially derived from `describe(roomId)` — ship it inline. |

## API surface

```ts
// ── types ──
interface Room { id; name; description; exits; tags? }
interface Exit { to; gate?; hidden? }
type WorldEvent =
  | { kind: "entered";  entityId; roomId; from? }
  | { kind: "exited";   entityId; roomId; to?   }
  | { kind: "located";  entityId; roomId        }
  | { kind: "detached"; entityId; from          };

// ── class ──
class World implements ObservationSource<unknown> {
  constructor(init?: { rooms?: Iterable<Room>; locations?: Iterable<[id, roomId]> });

  // rooms
  addRoom(room: Room): this;
  getRoom(id: string): Room | null;
  rooms(): Room[];
  connect(a: string, dir: string, b: string, reverseDir?: string, opts?: Partial<Exit>): this;

  // locations
  locate(entityId: string, roomId: string): WorldEvent[];        // emits exited+entered/located
  detach(entityId: string): WorldEvent | null;
  where(entityId: string): string | null;
  entitiesAt(roomId: string): string[];
  move(entityId: string, direction: string, resolvers?: Resolvers): WorldEvent[] | null;
    // null = no such exit / blocked by gate

  // queries
  scope(observerId: string, opts?: ScopeOptions): Set<string>;
  exitsFrom(roomId: string, opts?: { includeHidden?: boolean; resolvers?: Resolvers }): Record<string, Exit>;
  describe(roomId: string, opts?: { includeEntities?: boolean }): string;

  // observation source — readonly id, channels, salience, properties

  // persistence
  toJSON(): WorldJSON;
  static fromJSON(data: WorldJSON): World;
}

interface ScopeOptions {
  includeCarried?: (observerId: string) => Iterable<string>;  // e.g. inventory ids
  revealFlag?: (exit: Exit) => boolean;                       // hidden-exit reveal
  includeSelf?: boolean;                                      // default false
}
```

**~10 exports total**: 5 types/interfaces + `World` class with ~12 methods.
Fits the ~300 LOC budget comfortably.

## Open questions resolved

- **Multi-occupant rooms?** Yes by default — `Set<entityId>` per room. Stages
  that want exclusivity gate locate-calls themselves.
- **Symmetric exits by default?** No. `connect()` helper makes the common case
  one-line; raw `addRoom` keeps exit-asymmetry possible for one-way drops.
- **Path planning / BFS?** Out of scope for the primitive. Wave 2H AI module
  owns pathfinding. Topology query helpers (`neighbours(roomId)`) stay simple.
- **Conditional exits via stat / item?** Yes via `Exit.gate: Predicate<unknown>`,
  delegated to the caller's resolvers (no internal state assumed).
- **Does `move` push to Timeline?** No — returns the events, caller decides.
  Mirrors `scene.tick`'s contract.

## Implementation notes

- Pure-data structures only (Map / Set / record). No private state coupled to
  external primitives.
- `ObservationSource` implementation surfaces `where(observer)` →
  `{ room: roomId, entities: […] }` on the `visual` channel; salience = 0.5
  baseline. Stages override via `properties` if they want more.
- All "find a missing room/entity" cases return `null` per CONVENTIONS error
  rules; only invariant violations (e.g. JSON restoration with dangling
  location pointers) throw.
- `connect()` validates both rooms exist (throws if not — programmer error).
