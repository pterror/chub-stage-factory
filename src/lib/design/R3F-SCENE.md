# Wave 2F src/lib/3d/scene.tsx design
> Synthesized 2026-05-24 from src/lib/mining/R3F.md + ROADMAP Wave 2F spec.
> Implementation-ready: own/expose/configure split fixed, footgun mitigations encoded as defaults.
---

## API surface

```ts
interface ThreeSceneProps {
  children: ReactNode;
  cameraRig?: ReactNode;
  frameloop?: 'always' | 'demand' | 'never';     // default 'demand'
  dpr?: number | [number, number];                // default [1, 1.5]
  shadows?: boolean;                              // default false (cost)
  onCreated?: (state: RootState) => void;
  imperativeRef?: Ref<ThreeSceneHandle>;
}

interface ThreeSceneHandle {
  invalidate(): void;
  resetCamera(): void;
  getSnapshot(): Promise<Blob>;
}

function ThreeScene(props: ThreeSceneProps): JSX.Element;
```

## What the scene wrapper owns (internal, hidden)

These are never exposed as props; the stage author cannot override them without forking `scene.tsx`.

- `<Canvas>` with mining-recommended defaults: `frameloop="demand"`, `dpr={[1, 1.5]}`, `gl={{ antialias: true, powerPreference: 'high-performance' }}`. Changing `frameloop` or `dpr` is exposed as a prop; the gl options are not.
- ResizeObserver-aware wrapper div: `style={{ width: '100%', height: '100%', position: 'relative' }}`. This is the contract boundary with Chub — the stage sizes to 100% of whatever container Chub provides; Chub owns the container dimension. The `100vw`/`100vh` pattern in the current `Stage.render()` template is an iframe-only assumption that scene.tsx does not repeat.
- Root `<Suspense fallback={<DefaultLoader />}>` boundary. Each asset-loading component inside should add its own nested boundary; this root catches anything that falls through.
- `<PerspectiveCamera makeDefault position={[0, 0, 5]} />` as the initial camera. Overridable via `ConfigType` (see below).
- `useEffect` cleanup: renderer `.dispose()` on unmount, unregistering the `webglcontextlost` listener.
- Pointer-events CSS guard: the canvas wrapper carries `pointer-events: none`; interactive meshes opt back in individually. R3F's internal raycaster fires regardless of CSS `pointer-events`, so Three.js mesh event handlers still work.
- Context-loss listener via `webglcontextlost` event on the canvas element. On loss, sets a flag and renders a "Reload 3D scene" fallback UI (a DOM overlay, not a Three.js element). Does not attempt auto-restore — the manual `webglcontextrestored` path is unreliable in practice (R3F mining §3).

## What's exposed via props

Per `ThreeSceneProps` above:

- `children` — the stage's Three.js scene graph. Mounts inside the `<Canvas>` tree.
- `cameraRig` — slot for the active camera controller (see composition section below). Mounts alongside `children` inside the `<Canvas>` tree, after `<PerspectiveCamera>`.
- `frameloop` — let camera-rig components that animate continuously opt into `'always'`. Default `'demand'` keeps idle CPU cost near zero.
- `dpr` — for low-power mode overrides. Default `[1, 1.5]` caps mobile Retina.
- `shadows` — default `false`; enabling shadows has non-trivial GPU cost; stages that need it opt in explicitly.
- `onCreated` — escape hatch for imperative Three.js access at startup (set tone mapping, add custom passes, etc.).
- `imperativeRef` — narrow imperative handle (invalidate, resetCamera, getSnapshot); see `use-three-handle.ts` below.

## What stages configure via their ConfigType

These are Chub configuration schema fields consumed by the stage class, translated into props when calling `<ThreeScene>`:

- **Background color / skybox** — hex color string or cubemap URL; stage passes result as a child `<color>` or `<Environment>` inside `children`.
- **Shadows enabled** — boolean; maps directly to the `shadows` prop.
- **Initial camera position** — `[x, y, z]` tuple; stage passes as `position` on a `<PerspectiveCamera makeDefault>` it owns inside `children`, overriding the wrapper default.
- **Initial camera FOV** — number (degrees); same mechanism as above.
- **OrbitControls fallback enabled** — boolean; when true the stage passes `<OrbitControls>` as `cameraRig`; when false it passes nothing (or a character-driven rig from Wave 2H).

The distinction: `ThreeSceneProps` is the component API; `ConfigType` is the Chub user-facing config schema. The stage class bridges them in `render()`.

## What is NOT exposed

- **Renderer / scene / camera direct access** — use `imperativeRef` narrow interface (`invalidate`, `resetCamera`, `getSnapshot`) instead. Three.js internals must not leak into stage code; they break with R3F version bumps and create coupling that prevents the wrapper from managing cleanup.
- **Internal Suspense boundaries** — each asset-loading component (`useGLTF`, `useTexture`, etc.) owns its own nested `<Suspense>`; the root boundary is not configurable. Exposing it would let callers bypass the `<DefaultLoader />` fallback without providing a replacement, producing a blank canvas during load.
- **`frameloop="never"` as default** — it requires all consumers to call `advance(timestamp)` manually and get the timing right. Too error-prone as a default; available as a prop value for stages that genuinely need it (e.g. replay-driven scenes).
- **Canvas `key` prop** — changing it forces a full Three.js remount and context destruction. Not exposable.

## Composition with character controllers (Wave 2H)

Camera rigs are slot props, not baked-in logic.

- `cameraRig` accepts any `ReactNode`. The stage passes a controller component (e.g. `<FPSCameraRig>`, `<ThirdPersonOrbitalRig>`) that mounts inside the Canvas tree and drives camera position via `useFrame`.
- All Wave 2H controllers conform to a `CameraRig` interface (defined in Wave 2H controller design; not duplicated here). The interface contract: the rig component reads character position from a shared ref and updates camera transform each frame.
- Switching controllers is a prop swap: change the `cameraRig` value, React unmounts the old controller (removing its event listeners and frame callbacks) and mounts the new one. No scene remount, no context loss.
- When `cameraRig` is `undefined`, the default `<PerspectiveCamera makeDefault position={[0, 0, 5]} />` is static. Stages that want `OrbitControls` pass `<OrbitControls>` as `cameraRig`.
- Character-driven rigs that animate continuously should set `frameloop="always"` on `ThreeScene` to avoid `invalidate()` calls on every frame tick.

## Footgun defaults encoded

Each item names the mining-flagged failure mode and the wrapper's mitigation.

- **Height zero on mount** (§1, §8) — wrapper enforces `width: 100%, height: 100%`. Dev-mode `useEffect` warns if `parentElement.offsetHeight === 0` on mount.
- **8-context limit** (§2) — documented only; no automatic mitigation. `react-three-scissor` and Drei `<View>` flagged as future options. Irrelevant if Chub runs stages in iframes (one context per iframe).
- **Context loss** (§3) — automatic `webglcontextlost` listener; renders DOM overlay "Reload 3D scene" on loss. Does not attempt auto-restore.
- **Frame-rate hog** (§4) — `frameloop="demand"` default; renders only on state change or `invalidate()`.
- **DPR mobile blowup** (§4) — `dpr={[1, 1.5]}` cap default.
- **Pointer event hijack** (§8, §11) — canvas wrapper `pointer-events: none`; interactive meshes opt back in.
- **Conditional unmount kills scene** (§6) — documented in `src/lib/3D-SCENE.md`: use `display: none`, not `{cond && <ThreeScene>}`. No runtime enforcement possible at the wrapper layer.

## Bundle strategy

Per ROADMAP modular packaging: stages that don't use 3D pay nothing.

- `src/lib/3d/scene.tsx` imports `@react-three/fiber`, `@react-three/drei`, and `three`. All three must be behind a dynamic-import boundary at the call site: `const ThreeScene = lazy(() => import('lib/3d/scene').then(m => ({ default: m.ThreeScene })))`. The file is a normal export; the lazy boundary belongs in the stage's `render()`.
- **Vite alias shaking**: for a smaller Three.js subset, create `src/three-exports.ts` re-exporting only used classes and alias `'three'` to it in `vite.config.ts`. Document in `src/lib/3D-SCENE.md`; not a library concern.
- `three`, `@react-three/fiber`, and `@react-three/drei` are **peer dependencies** in `package.json`. Wave 2F implementation must add them to `peerDependencies` (avoids double-bundling if the host already carries Three.js).

## File layout

```
src/lib/3d/
  scene.tsx              — ThreeScene component (~250 LOC)
  loader.tsx             — DefaultLoader Suspense fallback (~40 LOC)
  use-three-handle.ts    — useImperativeHandle factory for ThreeSceneHandle (~40 LOC)
  index.ts               — re-exports: ThreeScene, ThreeSceneHandle, ThreeSceneProps
src/lib/
  3D-SCENE.md            — pattern doc: usage recipes, "display:none not conditional unmount", lazy import pattern
```

`3D-SCENE.md` is the stage-author-facing pattern doc; this `R3F-SCENE.md` is the implementation design doc. Both ship together in Wave 2F.

## Estimated LOC + complexity

- `scene.tsx` — ~250 LOC. Bulk is wrapper plumbing: the ResizeObserver height-warning effect, the context-loss listener + fallback UI state, the `useImperativeHandle` delegation, and the `<Canvas>` prop forwarding. The actual JSX is ~30 lines.
- `loader.tsx` — ~40 LOC. A centered spinner using Drei `<Html center>` or a plain DOM overlay.
- `use-three-handle.ts` — ~40 LOC. `useImperativeHandle` wiring for `invalidate` (via `useThree`), `resetCamera` (position + quaternion reset), `getSnapshot` (canvas `toBlob`).
- `index.ts` — ~5 LOC.
- Total: ~335 LOC. No algorithmic complexity; all plumbing and event wiring.

## Open questions

1. **Shared canvas mode.** Should we ship a built-in `react-three-scissor` shared-canvas mode alongside `ThreeScene`, or document it as a future enhancement and flag the 8-context limit? Recommendation: flag only — shipping scissor mode requires host cooperation (the host must provide the `<ScissorCanvas>`), which is outside Wave 2F scope.
2. **Embedded vs. fullscreen variant.** One `ThreeScene` component sized to `100%` of its container, or two variants (`<EmbeddedThreeScene>` / `<FullscreenThreeScene>`) with different sizing contracts? Current design uses one component; the Chub host owns the container dimensions. A `mode` prop would let the component self-size to `100vw/100vh` as a convenience for stages that know they're fullscreen — low value given iframe context guarantees.
3. **AudioContext placement.** If a stage uses Three.js `AudioListener`, browsers suspend the `AudioContext` until a user gesture (stricter inside iframes — the gesture must happen inside the iframe, not the host page). Does `ThreeScene` own an `AudioContext` / `AudioListener` and provide a gesture-gate UI, or does Wave 2G `src/lib/sensory/audio.ts` own the `AudioContext` and stages compose it independently? The answer affects whether `scene.tsx` has any audio coupling at all. Current design: `ThreeScene` has no audio coupling; Wave 2G owns the `AudioContext`.
