# Trigger — conditional probabilistic events

`ConditionalTrigger<S, E>` pairs a `Predicate<S>` gate with a fire
probability, an opaque `effect: E` payload, and optional cooldown /
one-shot flags. `TriggerSet` owns a list of triggers and their
firing-state (cooldowns, one-shot fired flags), and `evaluate(state,
refs, rng, now?)` returns the effects that fired this call. The caller
applies the effects — the primitive doesn't legislate what an effect
does.

Use across every "X% chance under Y conditions" mechanic:
mutations, faction encounters, fire spread, escape attempts,
morning sickness, grue attacks.

## Probability shapes

```ts
// 1. Constant — serializes trivially.
{ probability: 0.05 }

// 2. Modifier list — serializes; modifiers are predicate-gated multipliers.
{ probability: {
    base: 0.05,
    modifiers: [
      { when: P.tagOn("self", "fire-suppressed"), mult: 0.1 },
      { when: P.statTier("self", "heat", "critical"), mult: 3.0 },
    ],
  },
}

// 3. Escape-hatch function — DOES NOT serialize.
{ probability: (state) => state.tickCount > 100 ? 0.5 : 0.01 }
```

Prefer 1 or 2. The function form is for prototyping; predicate-modifier
form covers every real use case while round-tripping cleanly through
Shard persistence.

## Cooldown

```ts
import { TriggerSet, type ConditionalTrigger } from "./lib/trigger";
import { P } from "./lib/predicate";

const triggers: ConditionalTrigger<State, Effect>[] = [
  {
    id: "guard-patrol",
    when: P.and(P.locatedAt("player", "cell"), P.not(P.flag("guard-bribed"))),
    probability: 0.3,
    effect: { kind: "patrol" },
    cooldown: 60_000,    // ms — won't re-fire within a minute
  },
];

const set = new TriggerSet(triggers, resolvers);

// Per tick:
const fired = set.evaluate(state, refs, rng.mechanical, now);
for (const e of fired) dispatch(e);
```

## One-shot

```ts
{
  id: "first-encounter",
  when: P.and(P.locatedAt("player", "throne-room"), P.tagOn("player", "armed")),
  probability: 1.0,
  effect: { kind: "monarch-greets" },
  oneShot: true,        // never fires again across this TriggerSet's lifetime
}
```

`oneShot` state lives in the TriggerSet (`fired` set) and round-trips
through `toJSON`. Reset on demand with `set.reset("first-encounter")`
or `set.reset()` to clear all firing-state.

## Persistence

```ts
import { shardOf, chubTreeHistory } from "./lib/persistence";

triggerState: shardOf(
  "triggers", this.incidentTriggers,
  (d) => TriggerSet.fromJSON(this.triggerDefs, d, this.resolvers),
  this.layers.messageStateBackend, chubTreeHistory(),
),
```

Only the firing-state (`lastFiredAt` + `fired`) is persisted; the
trigger definitions themselves are stage-author authored data
re-supplied on load. Match the persistence paradigm to the mechanic —
branchy combat triggers → messageState; canon world-flags →
chatState + `forbidBranching`.

## Composition

- With `Timeline`: push fired effects as events; downstream
  observation surfaces them.
- With `Scheduler`: drive `evaluate(now)` on each tick.
- With `procgen.recombine`: mutations are predicate-gated triggers
  (see ROADMAP Wave 1.5).
- With `tag-parser`: parse LLM output for effects matching the
  trigger payloads; reducers apply them deterministically.

## Related

- `predicate.ts` — the gate DSL.
- `rng.ts` — supplies the deterministic stream for probability rolls.
- `timeline.ts` — natural sink for fired effects.
