# `src/lib/3d/` — React Three Fiber scene wrapper + Wave 2F substrate

Wave 2F 3D substrate. Modules in this directory cover scene mounting, physics
(Rapier-WASM), asset loading (GLTF/OBJ/texture with caching), camera rigs
(FPS/third-person/top-down/fixed), and 3D UI primitives (TileGrid3D,
VoronoiInfluenceMap3D, GraphView3D).

The R3F scene wrapper provides an embedded R3F canvas safe for Chub-iframe use. For usage recipes (lazy import, sizing, camera rigs,
context loss, pointer events), see `src/lib/3D-SCENE.md`. For design
rationale, see `src/lib/design/R3F-SCENE.md`.

## Files

### `scene.tsx` — `ThreeScene` component

R3F `<Canvas>` wrapper with footgun-mitigating defaults.

- `interface ThreeSceneProps` — `children`, `cameraRig?`, `frameloop?`, `dpr?`, `shadows?`, `onCreated?`, `imperativeRef?`
- `interface ThreeSceneHandle` (re-export from `use-three-handle.ts`) — narrow imperative surface
- `function ThreeScene(props): ReactElement` — the component

Key behaviors baked in: `frameloop="demand"` default, `dpr=[1, 1.5]` cap,
`pointer-events: none` on the wrapper, dev-mode height-zero warning, WebGL
context-loss overlay with manual reload.

### `loader.tsx` — `DefaultLoader` fallback

Pure DOM spinner (no Drei `<Html>`) used as the root `<Suspense>` fallback
when no asset component provides a nested boundary.

- `function DefaultLoader(): ReactElement` — `role="status"` overlay with a CSS animation spinner

### `use-three-handle.ts` — `useThreeHandle` hook

Inside-the-Canvas hook that wires `useImperativeHandle` for `ThreeSceneHandle`.
Must be rendered as a child of `<Canvas>` so `useThree` resolves.

- `interface ThreeSceneHandle { invalidate(), resetCamera(), getSnapshot(): Promise<Blob> }` (lines 13–20)
- `function useThreeHandle(handleRef): null` (line 28)

## Index (`index.ts`)

Re-exports all public symbols: `ThreeScene`, `ThreeSceneProps`, `ThreeSceneHandle`,
`DefaultLoader`, `useThreeHandle`.

## Gotchas

- Do NOT conditionally unmount `<ThreeScene>` with `{cond && <ThreeScene>}`.
  Use `display: none` on a parent instead — browsers cap WebGL contexts at ~8
  and Three.js cannot auto-restore GPU resources after context loss.
- The `lazy()` dynamic import MUST be at module top level, not inside `render()`.
- `useThreeHandle` must be a Canvas-tree child; rendering it outside `<Canvas>`
  will throw because `useThree` requires the R3F provider.
