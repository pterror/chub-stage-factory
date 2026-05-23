# effects — Klio the apothecary

Stage exercising `src/lib/effects.ts`. The LLM is told it can apply
tinctures by emitting a `[[apply id=...]]` tag (parsed and stripped by
`tag-parser`); each tincture is an `EffectDef` with a stacking policy
(`replace` / `extend` / `stack` / `highest`) and an optional trajectory.

## Primitives

- `effects` — `EffectStore.apply` / `.tick` / `.dispelByTag`.
- `tag-parser` — extracts `[[apply id=…]]` and `[[dispel tag=…]]`.
- `chub-adapters` — composes observation emission with the prose register.
- `prose-register` — close-second-present + focus_hold.
- `scheduler` — wired in for future scheduled wear-off side-effects.
- `observation` — surfaces active effects + the tincture menu.

## PATTERNS.md recipe

`## 5. Buffs / debuffs / effects` — `EffectStore` per target, `tick(now)`
returns the expired list.

## Run / deploy

```
node scripts/build-example.mjs effects
STAGE_ID_EFFECTS=… CHUB_AUTH_TOKEN=… node scripts/deploy-example.mjs effects
```
