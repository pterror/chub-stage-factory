# Combat-Realtime — tick-based spatial combat

`combat-realtime.ts` manages a live 2D world of combatants and in-flight
attacks. Each `tick(dt, now)` integrates positions, rebuilds the spatial
hash, steps attacks through collision detection, and returns the event
stream. `combat-turn.ts` handles the turn-based counterpart.

## Concepts

- **RealtimeCombatant** — has `pos`, `vel`, `radius`, `hp`, optional `team`
  and `tags`. Combatants are clamped to `ArenaBounds` on each tick (never
  culled).
- **AttackDef** — shape (`circle | aabb | segment`), lifetime, optional
  pierce count, `effects`, and an optional `hitFilter`. Pure data; shared
  across any number of live `Attack` instances.
- **Attack** — a live projectile/swing instance. Carries its own `bounds`
  (mutable each tick), `vel`, `bornAt`, and a `hits` set so each combatant
  is struck at most once per attack (unless pierce allows more).
- **pierces** — `0` means unlimited hits; default `1` means single-target.
- **Serialization gap** — `toJSON` / `fromJSON` persist combatants only.
  In-flight attacks are dropped on round-trip; they reference stage-side
  `AttackDef` objects that cannot be serialized generically.

## API

- `interface RealtimeCombatant` (`src/lib/combat-realtime.ts:36-44`)
- `interface AttackDef` (`src/lib/combat-realtime.ts:47-55`)
- `interface Attack` (`src/lib/combat-realtime.ts:57-65`)
- `type RealtimeEvent` — moved | attack_spawned | attack_hit | attack_expired | downed | out-of-bounds (`src/lib/combat-realtime.ts:67-73`)
- `interface ArenaBounds` (`src/lib/combat-realtime.ts:75-80`)
- `class RealtimeWorld` (`src/lib/combat-realtime.ts:82-259`)
  - `constructor(cellSize=64, bounds?)` — cellSize controls spatial hash granularity
  - `add(c)` — register a combatant
  - `spawnAttack(def, owner, initial, now): Attack` — add a live attack
  - `tick(dt, now): RealtimeEvent[]` — integrate, collide, age, cull
  - `toJSON()` / `static fromJSON(data)` — combatants only

## Gotchas

- Attacks outside `ArenaBounds` emit `out-of-bounds` and are removed
  before expiry check — they will not fire `attack_expired`.
- `hitFilter` receives the owner `RealtimeCombatant`, which must still be
  alive in `combatants`; if the owner was removed between spawn and tick,
  `owner` is `undefined` and the filter is skipped (all hits pass).
- Damage is applied directly to `target.hp` inside `tick`. There is no
  separate damage-apply step; effects from `AttackDef.effects` are
  recorded as events but not applied — the stage is responsible for
  wiring effects to `EffectStore`.
