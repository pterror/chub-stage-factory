# factionPattern

**File:** `src/lib/patterns/faction.ts`
**Composes:** `Stat` + `thresholdTiers` + `Predicate` evaluate
**Enables:** LT-shape (#6)

## Purpose

Manages per-faction reputation scores as `Stat`s with tier labels. `adjust` modifies reputation; `tierOf` returns the current label; `gate` checks whether the player's standing with a faction matches a required tier (used for content/dialogue gating).

ROADMAP decision: Faction is not a primitive. It reduces to Stat-with-tier + predicate. This pattern is that reduction.

## API

```ts
factionPattern({ factions, resolvers? }): FactionBundle<S, A>
```

### `FactionDef`

```ts
interface FactionDef {
  id: string;
  name: string;
  tiers: { below: number; label: string }[];
  fallbackTier: string;
  base?: number;
}
```

### `FactionBundle<S, A>`

| Method/Field | Description |
|---|---|
| `stats` | `Map<string, Stat<string>>` — one per faction |
| `adjust(id, delta)` | Add delta to faction reputation; returns new value |
| `tierOf(id)` | Current tier label for the faction |
| `gate(factionId, tier)` | True when faction's current tier matches `tier` |

### `factionGatePredicate(statKey, tier)`

Builds a `stat-tier` `Predicate` for use inside `TriggerSet.when` or compound predicates. Use when you need the gate inside a trigger; use `bundle.gate()` for direct boolean checks.

## Example

```ts
const factions = factionPattern({
  factions: [
    {
      id: "city_guard",
      name: "City Guard",
      tiers: [
        { below: -50, label: "enemy" },
        { below: 0,   label: "hostile" },
        { below: 30,  label: "neutral" },
        { below: 70,  label: "friendly" },
      ],
      fallbackTier: "ally",
    },
  ],
});

factions.adjust("city_guard", 40);
console.log(factions.tierOf("city_guard")); // "friendly"
if (factions.gate("city_guard", "ally")) {
  // unlock guard captain dialogue
}
```

## Gotchas

- `gate()` reads directly from the bundled `Stat` — it does NOT use the `Predicate` DSL. For trigger-set gates that need a serializable predicate, use `factionGatePredicate` instead.
- `adjust` throws on unknown faction ids; seed all factions at construction time.
- Faction stats are plain `Stat.base` increments with no habituation — use `Stat.addModifier` if you want time-decaying reputation.
