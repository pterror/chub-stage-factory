# Stats — quantitative stats with stacking modifiers and tier functions

`Stat<T>` holds a `base` number, a list of `Modifier` entries, and an
optional `TierFn<T>` that maps the effective value to a qualitative
label. `effective()` recomputes from all modifiers on every call.

Used in `actor.ts` for per-actor quantities (hp, arousal, mood, stamina).
Stage authors wire a `TierFn` via `thresholdTiers` to get label tiers
without branching logic in scene code.

## Concepts

Modifier kinds (applied in declared order):
- `"flat"` — `v += value`
- `"mult"` — `v *= value`
- `"add"` — `v += value` (same as flat; semantically distinct in authoring)
- `"habituation"` — contributes `value` to the sum; `tick` leaks it
  toward `setpoint` at asymmetric rates (`leakUp` above setpoint,
  `leakDown` below). Useful for mood stats that recover unevenly.

`thresholdTiers(bands, fallback)` builds a `TierFn` from
`{ below, label }` pairs sorted ascending; the first band whose
`below` threshold the effective value doesn't reach wins.

## API [`src/lib/stats.ts`](./stats.ts#L54-L152)

- `thresholdTiers(bands, fallback)` — build a `TierFn<T>` from threshold bands
- `new Stat({ base, tiers?, modifiers? })`
- `stat.base` — mutable; read/write directly
- `stat.addModifier(m)` — removes existing modifier with same id first if id is set
- `stat.removeModifier(id)` — returns `true` if found
- `stat.clearModifiers()`
- `stat.getModifiers()` — readonly snapshot
- `stat.effective(now?)` — recompute; `now` is accepted but not used by non-habituation modifiers
- `stat.tier(now?)` — `T | null`; null if no `TierFn` was configured
- `stat.tick(now)` — advance habituation modifiers; no-op for other kinds
- `stat.toJSON()` — `{ base, modifiers }`

## Gotchas

- `"flat"` and `"add"` are identical in computation. The distinction is
  authoring convention only.
- `effective` accepts `now` for API symmetry with `tier`, but only
  habituation modifiers use time — and only during `tick`, not during
  `effective`. The current `value` on each habituation modifier is what
  `effective` reads.
