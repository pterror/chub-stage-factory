# patterns/daily-vignette.ts

## Purpose

One well-grounded vignette per game-day tick with continuity from past vignettes.
The slice-of-life equivalent of `bulkTickPattern`: where bulkTick advances *many
actors in parallel*, daily-vignette advances *one subject deeply through time*.

Enables **Pregnancy-sim (#17)** and **Subject-life-sim (#19)**. Load-bearing
composer for the entire slice-of-life-texture meta-category (ROADMAP §68).

Each `tick` call:
1. Assembles observations (body state, effects, stats, timeline events).
2. Collects recent past vignettes for continuity context.
3. Generates prose via `generate()`.
4. Pushes a `VignetteEvent` (prose + observations snapshot) to the timeline.

## API

```ts
function dailyVignettePattern<S>(init: DailyVignetteInit<S>): DailyVignetteBundle
```

**`DailyVignetteInit<S>`**

| Field | Type | Description |
|---|---|---|
| `sources` | `ObservationSource<S>[]` | State to assemble before generating |
| `timeline` | `Timeline<VignetteEvent>` | Vignette history for continuity |
| `generator` | `GenerationService` | LLM for prose |
| `vignettePrompt` | `(subject, observations, recentVignettes, now) => string` | Build the full prompt |
| `assembleState` | `() => S` | Return current stage state for observation assembly |
| `continuityWindow` | `number` | Past vignettes to include; default 3 |
| `maxTokens` | `number` | Default 500 |
| `assembleOptions` | `Omit<AssembleOptions, "now">` | maxCount, lastEmittedAt |

**`DailyVignetteBundle`**

| Method | Description |
|---|---|
| `tick(subject, now)` | Advance one day; returns prose string; async |
| `timeline` | Direct access to the vignette timeline |

## Example

```ts
import { dailyVignettePattern } from "lib/patterns/daily-vignette";
import { Timeline } from "lib/timeline";

const vignetteTimeline = new Timeline<VignetteEvent>();
const vignette = dailyVignettePattern({
  sources: [bodyObservationSource, effectsObservationSource],
  timeline: vignetteTimeline,
  generator: stage.generator,
  assembleState: () => state,
  continuityWindow: 3,
  vignettePrompt: (subject, observations, recentVignettes, now) => `
Day ${now}. Subject: ${subject.name}.
${observations}
Recent days:
${recentVignettes.map((v, i) => `Day ${now - recentVignettes.length + i}: ${v}`).join("\n")}
Write today's vignette (2-3 paragraphs, first person, present tense).`,
});

// Each in-game day:
const prose = await vignette.tick(playerActor, gameDay);
```

## Gotchas

- The `VignetteEvent` pushed to the timeline includes the raw observations JSON.
  This is intentional: future calls can re-read it for longitudinal analysis or
  debugging without re-running observation assembly.
- `continuityWindow: 0` disables continuity context — useful for testing or
  for stages where each day is intentionally isolated.
- `assembleState()` is called once per tick immediately before observation
  assembly. Keep it cheap (no deep copies). Return a reference to the live
  state object if observation sources read from it by reference.
- The `generate<string>` call uses no schema parser; the LLM response is prose
  verbatim. If your `vignettePrompt` elicits JSON, parse after `tick` returns.
