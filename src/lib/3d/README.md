# `src/lib/3d/` — React Three Fiber scene wrapper + Wave 2F substrate

Wave 2F 3D substrate. Modules in this directory cover scene mounting, physics
(Rapier-WASM), asset loading (GLTF/OBJ/texture with caching), camera rigs
(FPS/third-person/top-down/fixed), and 3D UI primitives (TileGrid3D,
VoronoiInfluenceMap3D, GraphView3D).

The R3F scene wrapper provides an embedded R3F canvas safe for Chub-iframe use. For usage recipes (lazy import, sizing, camera rigs,
context loss, pointer events), see `src/lib/3D-SCENE.md`. For design
rationale, see `src/lib/design/R3F-SCENE.md`.

## Module index

| Path                          | Doc                                       | Purpose                            |
|-------------------------------|-------------------------------------------|------------------------------------|
| `scene.tsx`                   | `../3D-SCENE.md`                          | R3F `<Canvas>` wrapper             |
| `loader.tsx`                  | (in 3D-SCENE.md)                          | DOM-spinner fallback               |
| `use-three-handle.ts`         | (in 3D-SCENE.md)                          | Imperative handle inside Canvas    |
| `physics.ts`                  | `PHYSICS.md`                              | Rapier-WASM rigid body world       |
| `assets.ts`                   | `ASSETS.md`                               | GLTF/OBJ/texture loader cache      |
| `camera-rigs/fps.tsx`         | `camera-rigs/CAMERA-RIGS.md`              | First-person pointer-lock + WASD   |
| `camera-rigs/third-person.tsx`| `camera-rigs/CAMERA-RIGS.md`              | Orbital follow camera              |
| `camera-rigs/top-down.tsx`    | `camera-rigs/CAMERA-RIGS.md`              | Fixed-angle top-down               |
| `camera-rigs/fixed.tsx`       | `camera-rigs/CAMERA-RIGS.md`              | Static scene-set camera            |
| `ui/TileGrid3D.tsx`           | `ui/TILE-GRID-3D.md`                      | 3D tile board                      |
| `ui/VoronoiInfluenceMap3D.tsx`| `ui/VORONOI-INFLUENCE-MAP-3D.md`          | 3D spheres-of-influence            |
| `ui/GraphView3D.tsx`          | `ui/GRAPH-VIEW-3D.md`                     | 3D nodes + edges                   |

Demo: `examples/_3d-demo/` (underscore-prefixed; internal; not promoted).

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
