# scorePattern

**File:** `src/lib/patterns/score.ts`
**Composes:** `Stat` + `thresholdTiers` + `Timeline`
**Enables:** Zork-shape (#2)

## Purpose

Bundles a score `Stat` (integer counter) with a `Timeline<ScoreEvent>` and a list of `ScoreUnlock` entries — tier-keyed rewards that become available when the score crosses a threshold. `award` increments the score and records an event. `check` returns unlocks whose tier matches the current tier.

## API

```ts
scorePattern({ base?, tiers, fallbackTier, unlocks?, timeline? }): ScoreBundle<T>
```

### `ScoreBundle<T>`

| Method/Field | Description |
|---|---|
| `stat` | Raw `Stat<string>` instance |
| `timeline` | `Timeline<ScoreEvent>` |
| `unlocks` | The registered `ScoreUnlock<T>[]` |
| `award(delta, reason?, now?)` | Add points; returns `ScoreEvent` |
| `value()` | Current effective score |
| `tier()` | Current tier label |
| `check()` | Unlocks whose `tier` matches the current tier |

## Example

```ts
const score = scorePattern({
  tiers: [
    { below: 10, label: "Amateur Adventurer" },
    { below: 40, label: "Seasoned Adventurer" },
    { below: 100, label: "Expert Adventurer" },
  ],
  fallbackTier: "Master Adventurer",
  unlocks: [
    { id: "unlock-lamp-discount", tier: "Seasoned Adventurer", payload: { itemId: "lamp", discount: 0.5 } },
  ],
});

score.award(15, "solved the maze");
console.log(score.tier());   // "Seasoned Adventurer"
const fired = score.check(); // [{ id: "unlock-lamp-discount", ... }]
```

## Gotchas

- `check()` does NOT mark unlocks as consumed. Track consumed ids yourself and filter before acting on the result.
- Score is stored as `Stat.base` (no modifiers by default). You can add `Stat.addModifier` entries for temporary bonuses.
- `tier()` returns the label whose `below` threshold is the first one greater than the current score.
