# `3d/physics.ts` — Rapier 3D rigid-body world

Thin facade over `@dimforge/rapier3d-compat`. Compat package inlines the WASM
as base64, so no asset routing is needed for Chub iframes.

## Init

WASM init is lazy and idempotent. Call once before constructing a world:

```ts
import {initRapier, Physics3DWorld} from "./lib/3d/physics";

await initRapier();
const world = new Physics3DWorld({gravity: {x: 0, y: -9.81, z: 0}});
```

`initRapier()` resolves immediately on subsequent calls. First call takes
~50-150ms depending on device.

## Bodies + colliders

Each `add*` method creates a rigid body + collider in one call and returns a
`BodyId`. The body type defaults to `'dynamic'`; pass `type: 'static'` for
immovable terrain, `'kinematic-position'` for character-controlled bodies that
move via `setKinematicPosition`.

```ts
const ground = world.addStaticPlane({x: 0, y: 1, z: 0}, {x: 0, y: 0, z: 0});
const ball = world.addSphere(0.5, {position: {x: 0, y: 5, z: 0}}, {restitution: 0.7});
```

## Stepping

```ts
world.step(1 / 60); // default
```

Prefer a fixed timestep. Variable timesteps break determinism and produce
"tunneling" on slow frames. For physics paired with R3F, drive
`world.step()` from a `useFrame` hook with a fixed accumulator:

```ts
useFrame((_, delta) => {
  acc += delta;
  while (acc >= STEP) { world.step(STEP); acc -= STEP; }
});
```

## Queries

```ts
const hit = world.castRay({x: 0, y: 10, z: 0}, {x: 0, y: -1, z: 0});
if (hit) console.log(hit.bodyId, hit.toi, hit.point);
```

## Determinism

Rapier is deterministic across runs given the same inputs and step order.
`physics.test.ts` asserts that two worlds with the same setup converge to the
same transform after N steps.

## Lifecycle

Always call `world.dispose()` on stage unmount. Rapier holds WASM memory; not
disposing leaks until the page reloads.

```ts
useEffect(() => () => world.dispose(), [world]);
```

## Caveats

- `addStaticPlane` is a 1000-unit slab, not a true infinite plane (Rapier has
  no infinite plane collider). Bodies escaping ±1000 from origin fall through.
- Compat package is ~600KB minified+inlined. Dynamic-import `lib/3d/physics`
  so stages that don't use physics don't pay the cost.
