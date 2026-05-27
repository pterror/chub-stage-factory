# subject-sandbox — first-person life-sim composer

`subjectSandboxPattern(init)` wires the subject-life-sim axis (Shape #19:
"Imagine The Sims with explicit content, but infinite"). The player IS the
subject; the world has multiple locations; NPCs are managed as an `ActorPool`;
conditional triggers drive emergent events; daily vignettes provide texture.

Enables Subject-life-sim-shape (#19).

## Composed primitives

- `world` — multi-location graph (home, work, town square, …)
- `actorPool` — NPCs the subject interacts with
- `triggerSet` — conditional probabilistic events (pregnancy, NPC behavior,
  relationship shifts) evaluated each `advance` call
- `dailyVignette` — one prose vignette per game-day (from `dailyVignettePattern`)
- `timeline` — shared; world events + vignette events accumulate here

Note: `scheduler.ts` was deleted. Timeline-based scheduling replaces it:
trigger evaluation is driven by the caller's game-loop tick, not a hidden
scheduler. The `ConditionalTrigger`'s `cooldown` and `oneShot` fields cover
the cases scheduler handled.

## API [`src/lib/patterns/subject-sandbox.ts`](./subject-sandbox.ts)

```ts
function subjectSandboxPattern<S, E>(init: SubjectSandboxInit<S>): SubjectSandboxBundle<S, E>
```

`SubjectSandboxInit<S>`:
- `world: World`
- `actorPool: ActorPool`
- `triggerSet: TriggerSet<S, any>`
- `dailyVignette: DailyVignetteBundle`
- `timeline?: Timeline<WorldEvent>`
- `scopeOpts?: ScopeOptions`
- `resolvers?: Resolvers<S, any>`

`SubjectSandboxBundle<S, E>`:
- `.world`, `.actorPool`, `.triggerSet`, `.dailyVignette`, `.timeline`
- `.scope(subjectId)` → `Set<string>`
- `.advance(subject, state, refs, rng, now)` → `Promise<{ prose; effects }>`
- `.logEvents(events: WorldEvent[])`

## Example

```ts
import { subjectSandboxPattern } from "./lib/patterns/subject-sandbox";
import { dailyVignettePattern } from "./lib/patterns/daily-vignette";

const vignette = dailyVignettePattern({ sources, timeline: vignetteTimeline,
  generator, vignettePrompt, assembleState });

const bundle = subjectSandboxPattern({ world, actorPool, triggerSet, dailyVignette: vignette });

// Each game-day:
const { prose, effects } = await bundle.advance(subject, state, refs, rng, now);
// Apply effects; call world.move if needed; push world events:
bundle.logEvents(world.move(subject.id, "north") ?? []);
```

## Gotchas

- `advance` does NOT call `world.move` — the caller moves the subject and logs
  world events separately. The advance call is purely: fire triggers + generate
  vignette.
- `dailyVignette` is assumed to match the shape from `./daily-vignette`. If the
  synthesis pass finds a mismatch, reconcile the `DailyVignetteBundle` interface.
- Trigger `refs.self` should be set to `subject.id` by the caller. The pattern
  forwards `refs` unchanged to `triggerSet.evaluate`.
