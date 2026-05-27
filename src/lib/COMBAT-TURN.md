# Combat-Turn — initiative-ordered turn-based combat

`combat-turn.ts` runs a round of turn-based combat as a pure event
stream. It calls into `action.ts` for validation and cost payment, and
`rng.ts` for mechanical dice rolls.

## Concepts

- **Combatant** — has `initiative`, `hp`, optional resources/cooldowns/
  position/stats/tags/effects. `stats` covers `armor`, `dodge`, and
  `critResist`.
- **AttackProfile** — the damage parameters for one attack: raw `damage`,
  `type`, `crit` chance, `accuracy`, and `critMultiplier` (default 2).
- **Damage pipeline** — accuracy roll → dodge roll → crit roll → armor
  reduction → final apply. Each branch emits a distinct `CombatEvent`
  (missed, dodged, hit).
- **TurnChoice** — the value returned by the `choose` callback; carries the
  `ActionDef`, optional target, and optional `AttackProfile`.
- **choose callback** — the stage supplies this function; it is the only
  place AI or player input enters the pipeline.

## API

- `interface Combatant` (`src/lib/combat-turn.ts:39-49`)
- `interface AttackProfile` (`src/lib/combat-turn.ts:51-60`)
- `type CombatEvent` — turn_start | action_chosen | action_invalid | costs_paid | missed | dodged | hit | effect_applied | downed | turn_end (`src/lib/combat-turn.ts:62-72`)
- `interface TurnChoice` (`src/lib/combat-turn.ts:104-108`)
- `interface World { combatants: Combatant[] }` (`src/lib/combat-turn.ts:110-112`)
- `initiativeOrder(combatants, rng?): Combatant[]` — stable sort; RNG breaks ties (`src/lib/combat-turn.ts:74-82`)
- `resolveDamage(attacker, target, profile, rng): { final, crit, dodged, missed }` (`src/lib/combat-turn.ts:84-102`)
- `runTurn(actor, choose, world, now, rng): CombatEvent[]` — single actor's full turn (`src/lib/combat-turn.ts:114-166`)
- `runRound(combatants, choose, world, now, rng): CombatEvent[]` — initiative-ordered loop over all living combatants (`src/lib/combat-turn.ts:168-184`)

## Gotchas

- `runTurn` calls `payCosts` and `markCooldown` from `action.ts`, mutating
  the actor in place. If `choose` returns `null` the turn emits only
  `turn_start` + `turn_end` (pass).
- `effect_applied` events are emitted for every `ActionDef.effects` entry
  regardless of whether the attack hit — only damage resolves to
  missed/dodged. Stages that want hit-conditional effects must filter
  events themselves.
- `runRound` skips combatants with `hp <= 0` and those with
  `isOnCooldown(c, { id: "__round__" }, now)`. The `__round__` cooldown
  key is a convention; the stage can set it externally to stagger turns
  across real-time ticks.
