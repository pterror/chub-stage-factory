# `3d/camera-rigs/` — camera controllers as React Three Fiber components

Each rig is a self-contained React component that:

- Renders a `<PerspectiveCamera makeDefault>` inside the R3F Canvas tree.
- Installs the input listeners it needs (pointer-lock for FPS, drag for
  third-person, wheel + WASD for top-down, click for fixed).
- Publishes a static `VerbDescriptor[]` for `StageIntrospect.availableVerbs`
  (`fpsRigVerbs`, `thirdPersonRigVerbs`, `topDownRigVerbs`, `fixedRigVerbs`).
- Fires `onVerbInvoke(name, args?)` when the user triggers a verb via input.

Pass into `<ThreeScene cameraRig={…}>`. The scene wrapper does NOT remount
when `cameraRig` changes — only event listeners turn over, so swapping rigs
mid-game is cheap.

## Rigs

| Rig                | Input                        | Verbs published                  |
|--------------------|------------------------------|----------------------------------|
| `FPSRig`           | Mouse + WASD (pointer-locked)| `fps:fire`, `fps:interact`       |
| `ThirdPersonRig`   | Drag-orbit, scroll-zoom      | `third-person:lock-on`           |
| `TopDownRig`       | WASD pan, scroll-zoom, LMB   | `top-down:select` (NDC coords)   |
| `FixedRig`         | Click anywhere               | `fixed:advance`                  |

## StageIntrospect integration

```tsx
// In Stage class:
availableVerbs(): VerbDescriptor[] {
  return [...this.gameplayVerbs(), ...fpsRigVerbs];
}

// In render:
<ThreeScene cameraRig={<FPSRig onVerbInvoke={(n, a) => this.invokeVerb(n, a)} />}>
  …
</ThreeScene>
```

`invokeVerb` then routes the rig-published verb through the stage's normal
lifecycle (synthesize a `Message`, call `beforePrompt`), so input is
state-shaped, persistable, and replayable — same contract as any other verb.

## Why "rig publishes verbs, stage routes them"

The rig knows what user inputs it has (LMB while pointer-locked, scroll
wheel, etc.); the stage knows what those inputs *mean* in its mechanics
(fire bullet, select unit, advance dialogue). Coupling the input layer to
the verb layer keeps both honest and lets a CLI driver invoke the same
verbs without rendering DOM.

## Caveat: target tracking

`ThirdPersonRig` and `TopDownRig` accept `targetRef` for following a moving
object. The ref must point to a Three.js `Object3D` whose `position` is
updated each frame (typically a player capsule's mesh). For Rapier-driven
players, sync the mesh from the body's transform in a `useFrame`:

```tsx
useFrame(() => {
  const t = world.getTransform(playerId);
  if (t) playerRef.current.position.set(t.position.x, t.position.y, t.position.z);
});
```
