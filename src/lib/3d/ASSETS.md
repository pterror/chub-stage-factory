# `3d/assets.ts` — GLTF/OBJ/texture loading with caching

Promise-based wrapper around Three.js loaders. Decoupled from R3F's
Suspense-bound `useGLTF`/`useTexture` so stages can preload assets before
mounting the canvas, or load procgen-generated URLs from anywhere.

## Usage

```ts
import {defaultAssetCache} from "./lib/3d/assets";

// Preload during stage init
await defaultAssetCache.preload([
  "/models/character.glb",
  "/textures/ground.png",
]);

// Retrieve cached
const gltf = defaultAssetCache.getCached<GLTF>("/models/character.glb");
```

The default singleton is what most stages want. Construct a per-stage
`new AssetCache()` only when you need stage-scoped disposal independent of
other stages running in composition.

## Lifecycle

Always dispose on stage unmount:

```ts
useEffect(() => () => defaultAssetCache.disposeAll(), []);
```

GPU memory is not garbage-collected. Textures and geometries leak until
explicit `.dispose()` calls; the cache handles this via `disposeAsset`
walking GLTF/OBJ scene trees.

## Caching contract

- Loads are deduplicated by URL.
- Calling `loadX(url)` twice returns the same Promise (and same Texture/GLTF
  on resolution).
- Refcount is tracked but eviction is currently fully manual — call
  `disposeUrl(url)` or `disposeAll()`.

## Preload by extension

`preload()` dispatches by file extension:
- `.gltf` / `.glb` → `loadGLTF`
- `.obj` → `loadOBJ`
- anything else → `loadTexture`

For other formats (FBX, DRACO-compressed GLTF, KTX2), use the underlying
Three.js loader directly and feed the result into the cache via a custom
`AssetCache` subclass.
