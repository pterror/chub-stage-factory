# Action — declarative abilities with cost / range / cooldown

`action.ts` defines the `ActionDef` data shape and four pure-function
helpers for validating, paying, and tracking action costs. Both
`combat-turn.ts` and `combat-realtime.ts` consume these.

## Concepts

- **ActionDef** — pure data: resource cost map, optional range, optional
  target filter, list of `EffectDef`s to apply on hit, optional cooldown,
  and free-form tags. No behaviour lives in the def itself.
- **ActorWithResources** — the minimum actor shape the helpers require:
  `resources?`, `cooldowns?`, `position?`.
- **ValidateResult** — tagged union; on failure carries the specific reason
  and relevant numbers so stages can surface readable messages.

## API

- `interface ActionDef<A, T, W>` — action descriptor (`src/lib/action.ts:33-43`)
- `interface ActorWithResources` — actor shape required by helpers (`src/lib/action.ts:45-49`)
- `type ValidateResult` — ok | on_cooldown | insufficient_resource | out_of_range | filter_failed (`src/lib/action.ts:51-57`)
- `validateAction(def, actor, target?, world?, now?): ValidateResult` — checks cooldown, resources, range, filter in order (`src/lib/action.ts:64-86`)
- `payCosts(actor, costs): boolean` — deducts resources; returns false and leaves resources unchanged if any cost cannot be paid (`src/lib/action.ts:88-93`)
- `markCooldown(actor, def, now): void` — writes `now + def.cooldown` into `actor.cooldowns[def.id]` (`src/lib/action.ts:95-102`)
- `isOnCooldown(actor, def, now): boolean` — reads `actor.cooldowns[def.id]` (`src/lib/action.ts:104-110`)

## Gotchas

- `payCosts` mutates `actor.resources` in place and auto-creates the object
  if absent. Call `validateAction` first; `payCosts` does not re-validate.
- `markCooldown` is a no-op when `def.cooldown` is 0 or undefined — calling
  it unconditionally is safe.
- Range check only fires when both `actor.position` and `target.position`
  exist. A position-less actor passes range checks silently.
