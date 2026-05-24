# R3F Embedded Usage: Best Practices for Wave 2F

> Mined 2026-05-24 as prior art for chub-stage-factory primitives library.
> Captured verbatim from the mining run; informs the Wave 2F `src/lib/3d/scene.tsx` integration design.

---

Reference baseline: React 18.2, R3F (currently v8/v9 line), @react-three/drei, Vite, chub-stage-factory's `StageBase.render(): ReactElement` pattern where Chub hosts the element in its own React tree. The 3D scene is one component in a larger UI, not the whole page.

---

## 1. Canvas Sizing in Embedded Contexts

`<Canvas>` fills its parent container using a built-in ResizeObserver. The gotcha in embedded/iframe contexts: if the parent has no explicit height at mount time, the canvas falls back to the W3C default of 300x150 px and may not recover without a remount.

Rules:
- Give the wrapper element an explicit height before Canvas mounts — `height: 100%` only works if every ancestor up the chain has a computed height. Use `height: 100vh` in the iframe document root, or `aspect-ratio: 16/9` on the wrapper.
- Pass `resize={{ debounce: 0 }}` to `<Canvas>` for immediate response to container changes, or `resize={{ debounce: Infinity }}` to disable auto-resize and drive it manually.
- If the stage receives explicit `width`/`height` props from Chub (many platforms expose iframe dimensions), use `createRoot(canvasEl).configure({ size: { width, height } })` instead of `<Canvas>` for full manual control.
- The `useThree(state => state.size)` hook exposes the live computed size inside the scene tree; use it to keep camera aspect ratios in sync.

---

## 2. Multiple Canvas Instances Per Page

Browsers cap active WebGL contexts at roughly 8 (Chrome/Firefox); Safari is stricter. Exceeding the cap silently kills the oldest context — your stage's canvas disappears without an error. If Chub's host UI already uses R3F (e.g. for a background scene), every stage adding its own `<Canvas>` burns a slot.

Options:
- **react-three-scissor** ([pmndrs/react-three-scissor](https://github.com/pmndrs/react-three-scissor)): One shared canvas with scissor-clipped viewports for each "scene window". Stage code uses `<ScissorScene>` rather than `<Canvas>`. Requires host cooperation to provide the `<ScissorCanvas>`.
- **Drei `<View>`**: Similar pattern — a single offscreen canvas with `<View>` portals that track DOM elements. Works without host changes if the stage controls the root canvas.
- For Wave 2F, if each stage is isolated in its own iframe, the context cap is per-browsing-context, so separate iframes each get their own limit and this is not a problem. Confirm with Chub whether stages run in iframes or inline.

---

## 3. WebGL Context Loss / Restoration

Context loss is triggered by: too many active contexts, GPU driver reset, tab backgrounding on mobile, or long idle periods. Three.js's `WebGLRenderer` listens for `webglcontextlost` / `webglcontextrestored` by default and calls `event.preventDefault()` to request restoration.

Caveats:
- `WEBGL_lose_context` extension (used by `gl.forceContextRestore()`) is not universally supported; the manual restore path may silently fail.
- Context loss wipes all GPU resources (textures, programs, buffers). Even with restoration, Three.js does not automatically re-upload those resources — scenes may go black.
- Memory leaks in stage code (retaining scene graph references, not calling `.dispose()`) are the most common cause of context loss in practice. Fix leaks before assuming the browser is at fault.

Mitigation for re-mountable stages:
- Call `.dispose()` on geometries, materials, and textures in cleanup effects: `useEffect(() => () => geo.dispose(), [geo])`.
- On `webglcontextlost`, set a flag and show a "Reload 3D scene" button rather than trying to auto-restore.
- If the stage is in an iframe and Chub unmounts/remounts it (e.g. on branch switches), prefer `display: none` to full unmount to preserve the WebGL context.

---

## 4. Performance for Low-Allocated Stage Budgets

R3F runs a `requestAnimationFrame` loop at 60 fps by default, consuming CPU/GPU regardless of scene activity. For a component in a larger UI this is wasteful.

Recommended settings:
- `<Canvas frameloop="demand">`: Renders only when R3F detects a prop change or `invalidate()` is called. Best for static/interactive-only scenes.
- `<Canvas frameloop="never">`: Render is entirely manual via `advance(timestamp)`. Use for scenes driven by external state ticks.
- `<Canvas dpr={[1, 1.5]}>`: Caps device pixel ratio. Avoids rendering at 3x on Retina displays — the biggest single performance win on mobile.
- `<Canvas performance={{ min: 0.5 }}>`: Enables R3F's adaptive performance; it lowers resolution automatically when frame time is high.
- FPS cap: R3F does not expose a native FPS cap. Implement inside `useFrame` by tracking `clock.elapsedTime` and early-returning on frames under the target interval.
- For scenes that animate only during interaction (orbit, hover), use `frameloop="demand"` and call `invalidate()` inside pointer event handlers and control callbacks.

---

## 5. Asset Loading + Suspense

`useGLTF(url)` from drei suspends the component while loading. The containing `<Suspense fallback={<LoadingUI />}>` catches the suspension and shows the fallback.

Pattern:
```tsx
<Suspense fallback={<Html center><Spinner /></Html>}>
  <Model url="/assets/character.glb" />
</Suspense>
```

Key points:
- Call `useGLTF.preload(url)` at module level (outside any component) to start loading before the Suspense tree is even mounted. Dramatically reduces perceived load time.
- `useGLTF` caches by URL globally. If the same asset is used by multiple component instances, it is fetched once. Clear the cache with `useGLTF.clear(url)` during cleanup if the asset is large and no longer needed.
- Drei's `<Html>` helper renders DOM nodes inside the canvas coordinate system — useful for loading spinners that track a 3D position. Note: `<Html>` has a known conflict with pointer events; set `pointerEvents="none"` on the `<Html>` wrapper if it overlaps interactive meshes.
- Nest Suspense boundaries at granular levels (per character model, per environment) rather than one root boundary, so models appear incrementally.

---

## 6. Persistence Across React Re-Renders

`TestStageRunner` drives re-renders via a `useState(new Date())` toggle. R3F's `<Canvas>` creates and owns the Three.js scene, camera, and renderer. As long as `<Canvas>` stays mounted — i.e., does not unmount and remount — all Three.js objects survive host re-renders, because React reconciles the canvas subtree rather than recreating it.

What breaks persistence:
- Conditional rendering that unmounts `<Canvas>` entirely (`{condition && <Canvas>…</Canvas>}`). Use `visibility: hidden` or `opacity: 0` instead.
- Changing the `key` prop on `<Canvas>` — this forces a full remount.
- A parent Suspense boundary unsuspending and remounting children wipes local component state but not the Three.js scene (which lives in R3F's internal store, not React state).

For imperative scene access from outside the canvas:
```tsx
const sceneRef = useRef<{ resetCamera: () => void }>(null);
// Inside Canvas tree:
useImperativeHandle(sceneRef, () => ({ resetCamera: () => camera.position.set(0,0,5) }));
```
This lets `Stage.render()` expose a ref to Chub without coupling to Three.js internals.

For scene state that must survive re-renders: store it in a React `useRef` (not `useState`) so it does not trigger downstream re-renders, or in a Zustand store outside the component tree.

---

## 7. Camera + Controls

Drei exports: `OrbitControls`, `FlyControls`, `PointerLockControls`, `FirstPersonControls`, `CameraControls`, `MapControls`, `ArcballControls`.

All drei controls target the default camera (`<PerspectiveCamera makeDefault />`). Pass a custom camera via the `camera` prop on controls when needed.

Runtime switching pattern — conditional mount:
```tsx
{controlMode === 'orbit' && <OrbitControls />}
{controlMode === 'fly' && <FlyControls />}
```
Only one control set should be active at a time; drei controls attach event listeners to the canvas DOM element on mount and remove them on unmount.

`PointerLockControls` requires a user gesture to lock the pointer. Use the `selector` prop to bind it to a "Click to play" button rather than the document, which is critical in embedded contexts where the host page also has interactive elements.

Per-character camera rig pattern: put the rig logic in a `useFrame` callback that reads character position from a ref and lerps the camera toward a computed follow position. Keep the rig as a separate component that is conditionally mounted with the character, so OrbitControls can be swapped back in by simply not rendering the rig.

---

## 8. Common Pitfalls in Embedded Contexts

- **Height zero on mount.** The most common bug. Parent `div` has `height: 0` because its children are all absolute-positioned or the flex/grid row has no intrinsic height. Fix: explicit height on the stage root div (see §1). Current `Stage.render()` uses `100vh` — this is fine inside an iframe but wrong if the stage renders inline in Chub's page.
- **Pointer events stolen from host.** The canvas captures all pointer events over its area. If Chub renders UI (chat bubbles, menus) over the canvas, they may not receive clicks. Fix: set `style={{ pointerEvents: 'none' }}` on the canvas wrapper and re-enable only on interactive 3D objects via `<mesh onPointerDown={…}>`. R3F's internal raycaster still fires regardless of CSS `pointer-events`.
- **Focus lock.** `PointerLockControls` calls `canvas.requestPointerLock()`, which can trap the cursor away from Chub's UI. Always provide an escape mechanism and release the lock on stage unmount.
- **Canvas z-index conflicts.** Three.js renders into a `<canvas>` that by default stacks below Chub's absolutely-positioned overlay elements only if the stacking context is set up correctly. Verify with browser dev tools; add `position: relative; z-index: 0` to the stage root.
- **Audio context resumption.** If the stage uses Three.js `AudioListener`, browsers suspend the AudioContext until a user gesture. This is stricter in iframes; the gesture must happen inside the iframe.
- **Scroll hijacking.** R3F adds a passive `wheel` listener to the canvas. OrbitControls adds its own. Both prevent host-page scrolling over the canvas area. Mitigate by setting `target` on OrbitControls to a specific element, or `eventsPrefix` in `<Canvas events={…}>`.

---

## 9. Bundle Size

Three.js is ~600 KB minified; R3F adds ~50 KB; drei adds ~200 KB uncompressed (tree-shakeable). Three.js itself does not tree-shake well because of how modules re-export.

Strategies:
- **Vite alias shaking**: Create a `src/three-exports.ts` re-exporting only the Three.js classes you use, then alias `'three'` to it in `vite.config.ts`. Removes unused Three.js modules from the bundle.
- **Dynamic import for the scene**: `const Scene3D = lazy(() => import('./lib/3d/scene'))`. The Three.js + R3F chunk only loads when a 3D stage is actually rendered.
- **Drei selective imports**: Import from subpaths rather than the barrel: `import { OrbitControls } from '@react-three/drei'` is fine with Vite's ESM tree-shaking, but avoid importing the entire namespace (`import * as drei`).
- **GLTF compression**: Use Draco or Meshopt compression on assets via `gltf-transform`. Draco-compressed GLBs can be 80% smaller. Drei's `useGLTF` automatically handles Draco decompression if you set `useGLTF.setDecoderPath('/draco/')`.
- The stage is built as a library (`vite build --lib`); Three.js should be `external` in the Vite lib config if the host already bundles it, to avoid double-loading.

---

## 10. Strict Mode + Concurrent React Compatibility

R3F v9 correctly inherits `StrictMode` from the parent react-dom root (this was a bug pre-v9). In React 18 development mode, Strict Mode mounts every component twice (mount → unmount → mount) to surface effect cleanup bugs.

Impact on R3F:
- The WebGL renderer is created, destroyed, and created again on every dev-mode load. This doubles shader compilation time in dev and can trigger "too many contexts" warnings locally.
- Any `useEffect` that registers event listeners, starts animation loops, or allocates GPU resources must return a cleanup function — otherwise the second mount leaks the first mount's resources.
- Test in production build before concluding something is broken; if it works in production and fails in dev, Strict Mode has found a real bug in your cleanup.
- `useRef`-gated initialization patterns (`if (initialized.current) return; initialized.current = true`) defeat Strict Mode's purpose — avoid them. Fix the underlying cleanup instead.

---

## 11. Pointer Event Capture

R3F attaches a single set of DOM listeners to the canvas element and uses a raycaster internally to dispatch synthetic events to Three.js objects. This means:

- **All pointer events over the canvas are consumed by the canvas**, even if no 3D object is under the cursor. Host UI that overlays the canvas does not receive pointer events unless it is in a `position: absolute` div stacked above the canvas with its own pointer-events handling.
- `event.stopPropagation()` inside a mesh handler stops the event from reaching farther Three.js objects (objects behind it in depth), but does not stop the DOM event from reaching host HTML elements — the DOM event already hit the canvas at the outermost level.
- For UI panels rendered via drei `<Html>` inside the scene, use `pointerEvents="auto"` on the Html wrapper but `pointer-events: none` on the canvas itself if the HTML elements should be the primary interaction target.
- To render host-DOM UI that must sit above the canvas and still receive events: use a standard React portal (`ReactDOM.createPortal`) to render it into a sibling div above the canvas in z-order with `pointer-events: auto`, not inside the R3F tree.

---

## 12. Recommendations for `src/lib/3d/scene.tsx`

Based on the patterns above, here is what the wrapper should own, expose, and configure:

**Own (internal, hidden from stage author):**
- The `<Canvas>` element itself with the right defaults: `frameloop="demand"`, `dpr={[1, 1.5]}`, `shadows`, `gl={{ antialias: true, powerPreference: 'high-performance' }}`.
- A `ResizeObserver` watcher on a ref'd wrapper div with explicit `style={{ width: '100%', height: '100%', position: 'relative' }}`.
- A root `<Suspense fallback={<DefaultLoader />}>` boundary.
- A `<PerspectiveCamera makeDefault position={[0, 0, 5]} />` default camera.
- Cleanup of the renderer on unmount via `useEffect`.

**Expose as props:**
- `frameloop?: 'always' | 'demand' | 'never'` — let camera-rig components that animate continuously opt into `'always'`.
- `cameraRig?: ReactNode` — slot for the active camera controller (OrbitControls, FlyControls rig, etc.) so the scene file does not need to know which control mode is active.
- `onCreated?: (state: RootState) => void` — escape hatch for imperative Three.js access at startup.
- `dpr?: number | [number, number]` — for low-power mode overrides.
- `children: ReactNode` — the stage's Three.js scene graph.

**Make configurable via stage `ConfigType`:**
- Background color or skybox.
- Whether shadows are enabled (expensive, not always needed).
- Initial camera position and FOV.
- Whether OrbitControls are enabled at all (for stages with character-driven cameras).

**Do not expose:**
- The renderer, scene, or camera objects directly. Use `useImperativeHandle` with a narrow interface (`{ invalidate(), resetCamera(), getSnapshot() }`).
- Internal Suspense boundaries — let each asset-loading component own its own boundary.
- `frameloop="never"` as a default — it requires all consumers to call `advance()` correctly, which is error-prone.

The key design tension: `Stage.render()` currently uses `100vw / 100vh` which assumes fullscreen iframe. For Wave 2F, `scene.tsx` should size to `100%` of whatever container Chub provides, with the container dimension being Chub's responsibility. The stage should not assume it owns the viewport.

---

Sources:
- [Canvas - React Three Fiber docs](https://r3f.docs.pmnd.rs/api/canvas)
- [Scaling performance - React Three Fiber](https://r3f.docs.pmnd.rs/advanced/scaling-performance)
- [Events - React Three Fiber](https://r3f.docs.pmnd.rs/api/events)
- [v9 Migration Guide - React Three Fiber](https://r3f.docs.pmnd.rs/tutorials/v9-migration-guide)
- [pmndrs/react-three-scissor](https://github.com/pmndrs/react-three-scissor)
- [Too many active WebGL contexts on Safari - Discussion #2457](https://github.com/pmndrs/react-three-fiber/discussions/2457)
- [Proper handling of webglcontextlost - Discussion #723](https://github.com/pmndrs/react-three-fiber/discussions/723)
- [Canvas sizing discussion #630](https://github.com/pmndrs/react-three-fiber/discussions/630)
- [Fix React-three/fiber Canvas Sizing 300x150 Issue](https://www.technetexperts.com/r3f-canvas-viewport-resize-fix/)
- [Controls - Drei docs](https://drei.docs.pmnd.rs/controls/introduction)
- [drei HTML pointer events conflict - Issue #319](https://github.com/pmndrs/drei/issues/319)
- [reduce bundle size discussion #812](https://github.com/pmndrs/react-three-fiber/discussions/812)
- [THREE.WebGLRenderer: Context Lost - Discussion #1151](https://github.com/pmndrs/react-three-fiber/discussions/1151)
- [Dispose of WebGLRenderer when unmounting - Issue #2655](https://github.com/pmndrs/react-three-fiber/issues/2655)
