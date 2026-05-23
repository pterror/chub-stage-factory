# `examples/` — reference stages composed from `src/lib/`

Each subdirectory is a self-contained Chub stage that exercises one of the
patterns documented in `src/lib/PATTERNS.md`. The dev picker UI
(`src/ExamplePicker.tsx`) loads any of them under `yarn dev`; CI matrix-builds
all of them on every push.

## Layout

```
examples/
  registry.ts                 # central index, imported by ExamplePicker + App
  README.md                   # you are here
  <name>/
    Stage.tsx                 # StageBase implementation, composes src/lib/*
    test-init.json            # InitialData fixture for TestStageRunner
    chub_meta.yaml            # Chub project metadata
    scenario.yaml             # Chub scenario file
    characters/*.yaml         # Chub character cards
    README.md                 # what the example demonstrates
```

## Adding a new example

1. `mkdir examples/<name> examples/<name>/characters`
2. Author `Stage.tsx`, `test-init.json`, `chub_meta.yaml`, `scenario.yaml`,
   and at least one character.
3. Add an entry to `examples/registry.ts`.
4. `node scripts/build-example.mjs <name>` to verify the production bundle
   builds cleanly.

## Build & deploy

| script | purpose |
|---|---|
| `node scripts/build-example.mjs <name>` | swap `examples/<name>/` into `public/`, run `vite build --outDir dist/<name>`, restore `public/`. |
| `node scripts/build-all-examples.mjs` | loop over every example dir. |
| `STAGE_ID_<NAME_UPPER>=… CHUB_AUTH_TOKEN=… node scripts/deploy-example.mjs <name>` | zip + POST to the Chub extension API. |

CI verifies every example builds; deploy is opt-in per example via the
secret.

## Index

| name | mechanic | PATTERNS.md recipe |
|---|---|---|
| `inventory` | spot-based stacks, carry-class | §1 Inventory |
| `effects` | buffs/debuffs/status with trajectories | §5 Buffs / debuffs / effects |
| `turn-combat` | initiative-ordered rounds | §4 Turn-based combat |
| `tits-body` | part-tracked body with gradual TF | §2 TiTS-style body transformation |
| `cyber-slots` | equipment×TF tag interop | §3 Cyberpunk slot modding |
| `physics` | AABB/circle collision sandbox | §7 Physics |
| `realtime-combat` | tick-based spatial combat | §6 Realtime combat |
| `composite-showcase` | cyberpunk clinic combining many | §1+§2+§3+§4+§5 |
