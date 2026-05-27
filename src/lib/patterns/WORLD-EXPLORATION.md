# world-exploration — Parser-IF composer

`worldExplorationPattern(init)` wires the classic parser-IF turn loop:
scope → intent parse → move → look. All three IF shapes (CCA, Zork, HHGTTG)
use the same wiring; this composer collapses it to a single declaration.

Enables CCA-shape (#1), Zork-shape (#2), HHGTTG-shape (#3).

## Composed primitives

- `world` — room graph; `move`; `scope`; `describe`
- `actorPool` — entity pool (items, NPCs)
- `intent` — verb-noun-prep grammar + optional LLM fallback
- `timeline` — world-event log (optional; created if absent)
- `predicate` (via `worldResolvers`) — gate evaluation on exit traversal

## API [`src/lib/patterns/world-exploration.ts`](./world-exploration.ts)

```ts
function worldExplorationPattern(init: WorldExplorationInit): WorldExplorationBundle
```

`WorldExplorationInit`:
- `world: World`
- `actorPool: ActorPool`
- `parseOptions?: ParseIntentOptions`
- `scopeOpts?: ScopeOptions` — `includeCarried` hook for inventory
- `timeline?: Timeline<WorldEvent>`
- `resolvers?: Resolvers<unknown, any>` — merged with `worldResolvers(world)`

`WorldExplorationBundle`:
- `.world`, `.actorPool`, `.timeline` — raw primitives
- `.scope(playerId)` → `Set<string>`
- `.parseIntent(text, playerId)` → `Promise<Intent | null>`
- `.look(playerId)` → `string` — description + exits + entities
- `.move(playerId, dir, resolvers?)` → `WorldEvent[] | null`
- `.logEvents(events: WorldEvent[])` — push to timeline

## Example

```ts
import { worldExplorationPattern } from "./lib/patterns/world-exploration";
import { World } from "./lib/world";
import { ActorPool } from "./lib/actor";

const world = new World()
  .addRoom({ id: "cave", name: "Cave Entrance", description: "Damp stone walls.", exits: {} })
  .addRoom({ id: "hall", name: "Great Hall", description: "Vaulted ceiling.", exits: {} });
world.connect("cave", "north", "hall", "south");
world.locate("player", "cave");

const bundle = worldExplorationPattern({ world, actorPool: new ActorPool() });
console.log(bundle.look("player"));
// "Damp stone walls.\nExits: north."

const events = bundle.move("player", "north");
bundle.logEvents(events ?? []);
```

## Gotchas

- `look` excludes the player id from the entity list automatically.
- `move` merges `worldResolvers(world)` into any caller-supplied resolvers, so
  `located-at` predicates on exit gates work without manual wiring.
- If the player is detached from the world, `look` returns `"You are nowhere."` —
  the stage should call `world.locate(playerId, startRoom)` at init.
