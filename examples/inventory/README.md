# inventory — Pak the pack-rat shopkeeper

Stage demonstrating `src/lib/inventory.ts` end-to-end. Pak's stall has
named spots (counter, under-counter, hanging-hook, back-room, pak-pocket)
holding stacks of ItemDefs with different carry-classes. Each turn the
stage assembles an observation payload listing every spot's contents +
accessibility scores and emits it as `stageDirections` for the LLM.

## Primitives

- `inventory` — `Inventory` holds the spots/stacks; `accessibility` is the
  read-time computed score the LLM consumes.
- `observation` — two `ObservationSource`s (stall contents + disorder)
  with habituation so the LLM doesn't hear about the same thing every
  turn.
- `chub-adapters` — `emitStageDirections` pairs the prose register block
  with the observation payload.
- `prose-register` — `close-2nd-present` + `accumulation` +
  `body_then_world` for the close-shop-keeper vibe.

## PATTERNS.md recipe

Maps to `## 1. Inventory`. The `resolveLeaveLocation` call shown in the
recipe is wired into the stage but only fires when the scene actually
shifts location (not exercised in the dev fixture; see TODO).

## Run

```
EXAMPLE=inventory yarn dev:example         # dev with picker bypass
node scripts/build-example.mjs inventory   # production build to dist/inventory/
```

## Deploy

```
STAGE_ID_INVENTORY=... CHUB_AUTH_TOKEN=... \
  node scripts/deploy-example.mjs inventory
```
