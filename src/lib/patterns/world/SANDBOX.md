# sandbox — free-roam stage composer

`sandboxPattern(init)` wires the open-world turn loop for exploration-style
stages. One bundle covers the full intent-parse → world-move cycle so the
stage author writes mechanics, not plumbing.

Enables CoC-shape (#4), LT-shape (#6).

## Composed primitives

- `world` — room graph; location index; scope query
- `actorPool` — all entities in the world
- `rng` — entropy stream for procgen / encounter rolls
- `timeline` — world-event log (optional; created if absent)

## API [`src/lib/patterns/sandbox.ts`](./sandbox.ts)

```ts
function sandboxPattern(init: SandboxInit): SandboxBundle
```

`SandboxInit`:
- `world: World`
- `actorPool: ActorPool`
- `rng: RngStream`
- `parseOptions?: ParseIntentOptions` — synonym table + LLM fallback
- `scopeOpts?: ScopeOptions` — e.g. `includeCarried` for inventory
- `timeline?: Timeline<WorldEvent>` — bring-your-own or created

`SandboxBundle`:
- `.world`, `.actorPool`, `.rng`, `.timeline` — raw primitives
- `.scope(actorId)` → `Set<string>` — exits + co-located entity ids
- `.parseIntent(text, actorId)` → `Promise<Intent | null>`
- `.logEvents(events: WorldEvent[])` — push to timeline

## Example

```ts
import { sandboxPattern } from "./lib/patterns/sandbox";
import { World } from "./lib/world";
import { ActorPool } from "./lib/actor";
import { Rng } from "./lib/rng";

const world = new World()
  .addRoom({ id: "forest", name: "Dark Forest", description: "...", exits: {} });
world.locate("player", "forest");

const bundle = sandboxPattern({ world, actorPool: new ActorPool(), rng: new Rng(42).mechanical });
const intent = await bundle.parseIntent("go north", "player");
```

## Gotchas

- `logEvents` must be called by the stage after each `world.move` — the bundle
  does not auto-push events returned from the world.
- `scope` reflects the world's *current* state at call time; call it fresh each
  turn, not once at load.
- Procgen helpers (`buildGraph`, `instantiate`, etc.) are not bundled here —
  import directly from `../procgen` and feed the same `rng` stream.
