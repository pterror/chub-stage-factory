# cyber-slots — Dr. Cull the ripperdoc

Stage exercising `src/lib/equipment.ts` × `transformation.ts`. Cyberware
mods are EquipmentDefs constrained on body tags; TFs add/remove the tags
mods care about. Equipping a deckjack on a body without `neural-port`
returns a constraint failure; installing fleshweave on a body with a
deckjack equipped surfaces a violation via `checkAllConstraints`.

## Primitives

- `equipment` — `Loadout.equip` / `.fit` / `.checkAllConstraints`.
- `body` + `transformation` — TFs that mutate the tags equipment depends on.
- `constraints` — used internally by equipment.
- `observation` — surfaces body tags + equipped fit + violations.

## PATTERNS.md recipe

`## 3. Cyberpunk arbitrary-slot modding`.
