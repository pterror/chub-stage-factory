# `_3d-demo/` — Wave 2F substrate demo (internal)

Underscore-prefixed so `build-all-examples.mjs` and `promote-example.mjs`
skip it. Not intended to ship to Chub.

## What it demonstrates

- **`ThreeScene` mounting** (with lazy-loaded R3F bundle, per 3D-SCENE.md).
- **`Physics3DWorld`** (Rapier-WASM): static ground plane + a bouncing
  sphere stepped at fixed 60Hz via a `useFrame` accumulator.
- **`TileGrid3D`**: 3×3 board with click-to-teleport-sphere behavior.
- **`ThirdPersonRig`**: drag-orbit camera around the sphere.
- **`AssetCache`**: instantiated and disposed (no real assets loaded).
- **`StageIntrospect`**: stage publishes `place-tile-N` verbs and the
  camera-rig verbs; `invokeVerb` routes through `setState`-equivalent
  updates.

## Running

```bash
EXAMPLE=_3d-demo bun run dev:example
# open the picker, choose "_3d-demo — Wave 2F substrate demo (internal)"
```

## Headless / smoke caveat

`scripts/run-stage.mjs` runs in jsdom which has no WebGL. The Stage's
lifecycle methods (`load`, `beforePrompt`, `afterResponse`, `invokeVerb`)
DO run headlessly — they exercise the StageIntrospect surface and message
state without touching 3D rendering. The actual scene must be eyeballed
in `bun run dev`.

Smoke scenarios for this example are intentionally minimal; rendering
correctness is verified in-browser.
