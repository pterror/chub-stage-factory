# 3D scene pattern

> Stage-author-facing recipes for `src/lib/3d/scene.tsx`. For the design rationale (owns/exposes/configures split, footgun mitigations), see `src/lib/design/R3F-SCENE.md`.

## Lazy import (required)

`@react-three/fiber`, `@react-three/drei`, and `three` together are ~850KB. Stages that don't render 3D should not load them. The `lib/3d` module is dynamic-import-friendly; do the split at the call site:

```tsx
import {lazy, Suspense} from "react";

const ThreeScene = lazy(() =>
  import("./lib/3d").then((m) => ({default: m.ThreeScene})),
);

// In Stage.render():
return (
  <Suspense fallback={<div>Loading 3D…</div>}>
    <ThreeScene>
      <ambientLight />
      <mesh>
        <boxGeometry />
        <meshStandardMaterial color="orange" />
      </mesh>
    </ThreeScene>
  </Suspense>
);
```

The `lazy()` call MUST be at module top level, not inside `render()` — otherwise React remounts the lazy boundary on every render.

## Conditional unmount kills the scene

Do NOT do this:

```tsx
{show3D && <ThreeScene>…</ThreeScene>}
```

Unmounting `<ThreeScene>` destroys its WebGL context. Browsers cap active contexts at ~8 (Safari stricter), and Three.js does not auto-restore GPU resources after a context loss. Cold-restart cost is ~200-500ms.

Do this instead:

```tsx
<div style={{display: show3D ? "block" : "none"}}>
  <ThreeScene>…</ThreeScene>
</div>
```

`display: none` preserves the canvas DOM element and its WebGL context. Same applies to `visibility: hidden`.

## Sizing contract

`<ThreeScene>` fills 100% of its parent container. The parent MUST have a computed height at mount time, or the canvas falls back to 300x150 and may not recover. In dev mode the wrapper logs a warning when `parentElement.offsetHeight === 0` on mount.

Typical parent setups:

```tsx
// Fullscreen inside an iframe:
<div style={{width: "100vw", height: "100vh"}}>
  <ThreeScene>…</ThreeScene>
</div>

// Aspect-ratio panel:
<div style={{width: "100%", aspectRatio: "16 / 9"}}>
  <ThreeScene>…</ThreeScene>
</div>
```

Do NOT use `100vh` if the stage might render inline (non-iframe) in a Chub page — `100vh` is the iframe viewport in iframe-hosted stages, the host viewport otherwise.

## Camera + controls

Default camera is `<PerspectiveCamera makeDefault position={[0, 0, 5]} />`. To override, render your own `<PerspectiveCamera makeDefault …>` inside `children`; R3F's `makeDefault` semantics promote the last-mounted one to the active camera.

For interactive controls (OrbitControls, FlyControls, …) and character-driven rigs, pass them via the `cameraRig` prop:

```tsx
<ThreeScene cameraRig={<OrbitControls />}>…</ThreeScene>
```

Swapping `cameraRig` does NOT remount the scene — only the controller's event listeners and frame callbacks turn over.

If the active rig animates continuously (third-person follow, flythroughs), set `frameloop="always"`. Otherwise the default `'demand'` skips frames until something invalidates.

## Imperative access

Reach for the renderer/scene/camera Three.js objects only when nothing else works. The supported escape hatch is `imperativeRef`:

```tsx
const sceneRef = useRef<ThreeSceneHandle>(null);

<ThreeScene imperativeRef={sceneRef}>…</ThreeScene>

// Elsewhere:
sceneRef.current?.resetCamera();
sceneRef.current?.invalidate();
const blob = await sceneRef.current?.getSnapshot();
```

The handle is intentionally narrow: extending it with renderer/scene/camera accessors couples stage code to R3F internals and breaks across version bumps.

For full Three.js access at startup (custom tone mapping, render passes, …), use `onCreated`:

```tsx
<ThreeScene
  onCreated={(state) => {
    state.gl.toneMapping = THREE.ACESFilmicToneMapping;
  }}
>
  …
</ThreeScene>
```

## Suspense boundaries

Each asset-loading component (`useGLTF`, `useTexture`, …) should wrap itself in its own `<Suspense>`. The root `<Suspense>` inside `ThreeScene` is the catch-all; if everything falls through to it, the user sees `<DefaultLoader />` for the entire scene rather than incremental fill-in.

```tsx
<ThreeScene>
  <Suspense fallback={null}>
    <Character url="/character.glb" />
  </Suspense>
  <Suspense fallback={null}>
    <Environment url="/env.glb" />
  </Suspense>
</ThreeScene>
```

Call `useGLTF.preload('/character.glb')` at module level to start loading before any Suspense tree mounts.

## Pointer events

The canvas wrapper carries `pointer-events: none` so host DOM UI (chat bubbles, menus) overlaid on the scene receives clicks. Three.js mesh event handlers still fire because R3F raycasts independent of CSS pointer-events.

For DOM-flavoured UI inside the canvas (drei `<Html>`), opt back in explicitly:

```tsx
<Html pointerEvents="auto">
  <button>Click me</button>
</Html>
```

## Context loss

On `webglcontextlost`, `ThreeScene` shows a "Reload 3D scene" overlay. The button forces a Canvas remount (bumps a key) and rebuilds the GPU resources. Auto-restore is not attempted — `WEBGL_lose_context` is unreliable and Three.js does not re-upload textures/programs/buffers automatically.

The most common cause of context loss in practice is resource leaks in stage code. Call `.dispose()` on geometries, materials, and textures in cleanup effects:

```tsx
useEffect(() => () => geometry.dispose(), [geometry]);
```

## Bundle trimming

For a smaller Three.js subset, create `src/three-exports.ts` re-exporting only the classes used, then alias `'three'` to it in `vite.config.ts`:

```ts
// vite.config.ts
resolve: {alias: {three: "/src/three-exports.ts"}}
```

This is a host-app concern, not a library concern; `lib/3d` itself imports from `'three'` as normal.

`three`, `@react-three/fiber`, and `@react-three/drei` are declared as peer dependencies. Hosts that already bundle Three.js will not double-load.
