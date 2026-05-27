# patterns/managerial.ts

## Purpose

Player-issues-policy + report-rendering loop. The stage's weekly cycle:
1. Player issues directives (policy form).
2. All actors advance in bulk (`tick` delegates to `advance` per actor).
3. Timeline accumulates events.
4. `renderReport` produces a prose narrative over the tick window.

Enables **FC-shape (#8)**: "every arcology has unique slaves, unique events,
unique trade arcs." Also partial FS-shape (#7) and LT-shape (#6).

Coordinates with `bulk-tick.ts` (sibling Wave 2C): managerial wraps the
actor-advance loop; bulk-tick provides the per-actor advance logic. Build
bulk-tick first for cleaner separation; managerial is usable standalone by
passing a custom `advance` function.

## API

```ts
function managerialPattern<P, E>(init: ManagerialInit<P, E>): ManagerialBundle<P, E>
```

**`ManagerialInit<P, E>`**

| Field | Type | Description |
|---|---|---|
| `timeline` | `Timeline<E>` | Receives tick events; source for report summary |
| `generator` | `GenerationService` | LLM for report prose |
| `reportPrompt` | `(summary, now) => string` | Build the report LLM prompt |
| `applyPolicy` | `(fields: P) => void` | Mutate stage state from player directives |
| `advance` | `(actor: Actor) => E[]` | Per-actor tick; returns events for this actor |
| `renderEvent` | `(e, at) => string` | Project event to summary line (default: JSON) |
| `reportMaxTokens` | `number` | Default 600 |

**`ManagerialBundle<P, E>`**

| Method | Description |
|---|---|
| `applyPolicy(fields)` | Issue player directives |
| `tick(pool, now)` | Advance all actors; push events to timeline |
| `renderReport(events, now)` | Generate prose report; async |
| `lastTickEvents` | Events from the most recent tick |
| `timeline` | Direct timeline access |

## Example

```ts
import { managerialPattern } from "lib/patterns/managerial";
import { Timeline } from "lib/timeline";

type Policy = { foodRation: "normal" | "reduced"; workShift: "standard" | "extended" };
type SlaveEvent = { slaveId: string; kind: string; mood: number };

const timeline = new Timeline<SlaveEvent>();
const managerial = managerialPattern<Policy, SlaveEvent>({
  timeline,
  generator: stage.generator,
  reportPrompt: (summary, now) =>
    `Week ${now} report. Events:\n${summary}\nWrite a 2-paragraph arcology report.`,
  applyPolicy: (fields) => { state.policy = fields; },
  advance: (actor) => {
    // Return events for this actor's weekly tick
    const mood = computeMood(actor, state.policy);
    return [{ slaveId: actor.id, kind: "week-tick", mood }];
  },
  renderEvent: (e, at) => `[${at}] ${e.slaveId}: mood=${e.mood} (${e.kind})`,
});

// Weekly cycle:
managerial.applyPolicy({ foodRation: "reduced", workShift: "extended" });
const events = managerial.tick(actorPool, weekNumber);
const report = await managerial.renderReport(events, weekNumber);
```

## Gotchas

- `generate<string>` is called with no schema parser — the raw LLM response
  string is returned as the report. If you need structured output, pass a
  `reportPrompt` that elicits JSON and wrap `renderReport` with a parser.
- `tick` pushes events into the timeline with the `now` timestamp passed in.
  Ensure `now` is monotonically increasing (e.g., week number) across ticks.
- `lastTickEvents` is replaced on every `tick` call. If you need to accumulate
  across multiple ticks, collect from `timeline.since(lastTickAt)` directly.
