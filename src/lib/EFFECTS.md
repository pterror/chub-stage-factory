# Effects — buffs, debuffs, and status effects

`EffectStore` manages a set of active `EffectInstance` entries. Each
instance references an `EffectDef` that declares what axes it modifies
(stats, tags, abilities), how long it lasts, a stacking policy, and an
optional trajectory that varies magnitudes over the effect's lifetime.

Used for temporary stat modifiers, ongoing tag injections (e.g. `"stunned"`),
arousal ramps, and any buff/debuff that should expire or be dispelled.
Pairs with `stats.ts` (for stat modifiers) and `body.ts` (for tag effects,
applied by the stage from `totalMagnitudes`).

## Concepts

**Stacking policies** when the same effect id is applied while active:
- `"replace"` — reset startTime and count (default)
- `"extend"` — push the end time forward by one more duration
- `"stack"` — increment count; magnitudes scale linearly with count
- `"highest"` — keep whichever instance has higher total magnitude

**Trajectories** `(elapsedFraction, elapsed) => EffectMagnitudes` let an
effect ramp in or out. The trajectory output is merged with (added to)
`baseMagnitudes`; it does not replace it.

**Dispel** by tag: any effect whose `dispelTags` includes the dispatched
tag is removed in bulk.

## API [`src/lib/effects.ts`](./effects.ts#L104-L216)

- `store.apply(def, now)` — apply or update; returns the instance
- `store.remove(id)` — unconditional removal; returns `true` if it existed
- `store.dispelByTag(tag)` — remove all effects with that dispel tag; returns removed list
- `store.active()` — snapshot of all active instances
- `store.magnitudesFor(id, now)` — `EffectMagnitudes | null` for one effect
- `store.totalMagnitudes(now)` — merged magnitudes across all active effects
- `store.tick(now)` — removes expired effects; returns expired list
- `store.toJSON()` / `EffectStore.fromJSON(data, defs)` — defs catalog required for restore

## Gotchas

- `toJSON` omits `def` references. `fromJSON` silently skips instances
  whose id is absent from the supplied catalog.
- `totalMagnitudes` merges stat values additively and concatenates tag
  lists. The stage is responsible for deduplicating tag lists before
  applying them to a `TagSet`.
- The `"extend"` policy math extends the effective end time but uses
  startTime as the trajectory anchor, which may produce unexpected
  trajectory fractions if applied multiple times rapidly.
