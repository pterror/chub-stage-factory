# turn-combat — duel on the steps

Stage exercising `src/lib/combat-turn.ts`. PC vs one duellist. The LLM
chooses the PC's next move by emitting `<action>swing|guard|sunder</action>`;
the stage runs one round and feeds the resulting events back as a
structured observation for the next message.

## Primitives

- `combat-turn` — `runRound` + damage pipeline.
- `action` — `ActionDef` with costs/cooldown/effects.
- `effects` — `guarded` / `sundered` as armor mods.
- `rng` — seeded mechanical stream so re-renders don't perturb the next roll.
- `tag-parser` — parses `<action>`.

## PATTERNS.md recipe

`## 4. Turn-based combat`.
