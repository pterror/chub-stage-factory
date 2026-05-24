# Wave 2H Character Controller Patterns design
> Synthesized 2026-05-24 from src/lib/mining/RAPIER.md + ROADMAP Wave 2H spec.
> Implementation-ready: 6 controller composers, shared infrastructure, footgun defaults.
---

## Shared infrastructure

All six controllers compose a single substrate hook: `useCharacterController` in `src/lib/3d/character-controller.ts`.

```ts
// src/lib/3d/character-controller.ts
function useCharacterController(options?: {
  offset?: number;           // default 0.01 — MUST be non-zero (mining §2)
  snapToGround?: number;     // default 0.5 — prevents downhill bounce (mining §8)
}): CharacterControllerHandle;

interface CharacterControllerHandle {
  controller: KinematicCharacterController;
  isOnGround(): boolean;     // wraps computedIsOnGround(); call AFTER computeColliderMovement only
  dispose(): void;
}
```

**Lifecycle:** `useEffect` creates `world.createCharacterController(offset)`, calls `enableSnapToGround(snapToGround)`, returns cleanup that calls `world.removeCharacterController`. Controllers subscribe to `useBeforePhysicsStep` for the compute step.

**Zero-vector guard** (issue #485 mitigation): every controller guards its compute step:
```ts
if (desired.length() < 1e-5) return;
```

**Self-collision filter:** each controller passes a `filterPredicate` that excludes the character's own collider. Not `filterGroups` — mining §9 flags `filterGroups` as unreliable (issue #497).

**`computedIsOnGround()`** is accessed only after `computeColliderMovement`, never before (mining §9).

**Default gravity:** manual per-controller, not world gravity. `world.gravity` only affects dynamic bodies (mining §5). Reset `yVelocity` to a small negative constant (e.g. `-0.1`) when grounded so snap-to-ground's downward cast stays active (mining §8).

---

## Per-controller pattern APIs

### fps.ts

FPS WASD + mouselook. Kinematic position body. Manual gravity. PointerLockControls camera locked to rigid body position. Invisible character collider.

```ts
// src/lib/patterns/controllers/fps.ts
function fpsController(options: {
  rigidBodyRef: RefObject<RapierRigidBody>;
  colliderRef: RefObject<Collider>;
  moveSpeed?: number;           // default 5
  jumpSpeed?: number;           // default 8
  gravity?: number;             // default 9.81; manual accumulation per mining §5
  mouseSensitivity?: number;    // default 0.002
  enableAutoStep?: boolean;     // default false
  maxSlopeClimb?: number;       // default Math.PI / 4 (45°)
  minSlopeSlide?: number;       // default Math.PI / 6 (30°)
  platformAttachment?: PlatformAttachmentCallback; // moving-platform workaround hook
}): CharacterControllerHandle;
```

Renders an `<PointerLockControls>` + a `<PerspectiveCamera>` whose position tracks `rigidBodyRef` each frame via `useFrame`. Camera yaw drives horizontal movement direction. Uses shared `useCharacterController` with `snapToGround` enabled.

Jump pattern per mining §6: `yVelocity = jumpSpeed` on ground + jump input; accumulate `yVelocity -= gravity * dt` each frame; zero (to `-0.1`) when `computedIsOnGround()`.

### third-person.ts

Souls-like orbital camera. Character mesh visible. Lerp camera follow.

```ts
function thirdPersonController(options: {
  rigidBodyRef: RefObject<RapierRigidBody>;
  colliderRef: RefObject<Collider>;
  moveSpeed?: number;           // default 5
  jumpSpeed?: number;           // default 8
  gravity?: number;             // default 9.81
  cameraDistance?: number;      // default 5
  cameraHeight?: number;        // default 2
  cameraLerpFactor?: number;    // default 0.1
  orbitSensitivity?: number;    // default 0.003
  maxSlopeClimb?: number;       // default Math.PI / 4
  minSlopeSlide?: number;       // default Math.PI / 6
  platformAttachment?: PlatformAttachmentCallback;
}): CharacterControllerHandle;
```

Camera orbits a pivot point lerp-following the rigid body. Movement direction is camera-relative. Uses `snapToGround` enabled.

### top-down.ts

Hotline Miami / Diablo overhead view. Camera fixed at configurable height and angle. WASD or click-to-move input. Autostep off by default (flat environments).

```ts
function topDownController(options: {
  rigidBodyRef: RefObject<RapierRigidBody>;
  colliderRef: RefObject<Collider>;
  moveSpeed?: number;           // default 6
  cameraHeight?: number;        // default 20
  cameraTilt?: number;          // default 0 (straight down); radians
  enableClickToMove?: boolean;  // default true
  enableAutoStep?: boolean;     // default false
  maxSlopeClimb?: number;       // default Math.PI / 4
  minSlopeSlide?: number;       // default Math.PI / 6
  platformAttachment?: PlatformAttachmentCallback;
}): CharacterControllerHandle;
```

No gravity accumulation when camera is overhead-fixed and world is flat; controller still applies a grounding force. Click-to-move uses pointer raycasting against a ground plane.

### platformer.ts

2D sidescroller. Movement constrained to XY plane (Z locked). Autostep enabled by default. Coyote time tracking.

```ts
function platformerController(options: {
  rigidBodyRef: RefObject<RapierRigidBody>;
  colliderRef: RefObject<Collider>;
  moveSpeed?: number;           // default 5
  jumpSpeed?: number;           // default 10
  gravity?: number;             // default 20 (stronger feel)
  coyoteTime?: number;          // default 0.12 (seconds)
  autostepMaxHeight?: number;   // default 0.5
  autostepMinWidth?: number;    // default 0.2
  maxSlopeClimb?: number;       // default Math.PI / 3
  minSlopeSlide?: number;       // default Math.PI / 4
  platformAttachment?: PlatformAttachmentCallback;
}): CharacterControllerHandle;
```

Autostep enabled: `controller.enableAutostep(autostepMaxHeight, autostepMinWidth, false)` (mining §7 — `onDynamicBodies: false` for most platforms). `snapToGround` enabled. Coyote time: tracks timestamp of last `computedIsOnGround() === true`; jump input accepted within `coyoteTime` seconds of leaving ground. Z axis translation always zeroed before applying movement.

### vehicle.ts

Cars / ships / planes / spacecraft. Uses `DynamicRayCastVehicleController` (NOT kinematic character controller). Rigid body type is **dynamic**, not kinematic. No R3F wrapper exists (issue #323 open) — uses raw Rapier via `useRapier().world`.

```ts
function vehicleController(options: {
  chassisRef: RefObject<RapierRigidBody>;   // must be "dynamic" rigid body
  wheelConfigs: WheelConfig[];
  engineForce?: number;         // default 500
  brakeForce?: number;          // default 10
  steeringMax?: number;         // default 0.6 radians
  chassisLocalForwardDir?: Vector3; // default { x: 0, y: 0, z: -1 }
  chassisLocalUp?: Vector3;        // default { x: 0, y: 1, z: 0 }
}): VehicleControllerHandle;

interface WheelConfig {
  position: Vector3;
  radius: number;
  suspensionLength?: number;   // default 0.3
  suspensionStiffness?: number; // default 24
}
```

Does NOT use `useCharacterController` substrate — vehicle physics is solver-driven, not collide-and-slide. `useBeforePhysicsStep` applies engine force, brake, and steering each tick via `vehicleController.setWheelEngineForce` / `setWheelBrake` / `setWheelSteering`. No `snapToGround` or `enableAutostep`.

### cursor.ts

RTS / point-and-click adventure. No character rigid body. Cursor is a projected point on the ground plane. Reuses `src/lib/ai/pathfinding.ts` (Wave 2H AI sub-deliverable) for agent navigation.

```ts
function cursorController(options: {
  camera: RefObject<Camera>;
  groundPlane?: Plane;             // default y=0
  pathfindingAgent?: PathfindingAgent; // from lib/ai/pathfinding.ts
  onCursorMove?: (worldPos: Vector3) => void;
  onSelect?: (worldPos: Vector3) => void;
}): CursorControllerHandle;

interface CursorControllerHandle {
  cursorPosition: Vector3;   // current world-space cursor intersection
  selectedPosition: Vector3 | null;
}
```

Raycasts pointer against `groundPlane` each frame. No kinematic body. No gravity. No autostep. Pairs with top-down or fixed camera.

---

## Footgun mitigations encoded as defaults

Each mitigation is a direct encoding of a failure documented in mining §9:

| Footgun | Default encoding |
|---|---|
| `offset = 0` causes stuck/instability | `useCharacterController` default `offset: 0.01`; asserts `offset > 0` |
| Downhill bounce without snap | `enableSnapToGround(0.5)` called in `useCharacterController` for fps, third-person, platformer |
| Zero-vector clipping (issue #485) | `if (desired.length() < 1e-5) return;` in every controller's compute step |
| Self-collision | `filterPredicate` excludes own collider; `filterGroups` not used (issue #497) |
| `computedIsOnGround()` before compute | asserted in dev: guard that throws if checked before `computeColliderMovement` |
| Friction on collider has no effect | documented per-controller; `surfaceDamping` knob on fps/third-person/platformer controls in-controller velocity damping |
| Moving platform dip/bounce (issue #488) | optional `platformAttachment` callback on fps/third-person/top-down/platformer; when provided, platform velocity is added to `desiredTranslation` each frame |
| Rapier version API renames | both `@react-three/rapier` and `@dimforge/rapier3d-compat` pinned together; see Bundle section |

---

## Composition with R3F scene

The sibling design doc (`src/lib/design/R3F-SCENE.md`, Wave 2F) defines a `<ThreeScene>` component with a `cameraRig` slot prop. Each controller in this wave is a React component that mounts inside that slot.

```ts
// Conformance interface (each controller satisfies this as a React component)
interface CameraRig {
  // React component lifecycle: mount = useEffect setup, unmount = useEffect cleanup
  // Props are controller-specific; all controllers accept rigidBodyRef + colliderRef
}

// Usage
<ThreeScene
  cameraRig={<FpsController rigidBodyRef={bodyRef} colliderRef={collRef} />}
>
  {/* scene contents */}
</ThreeScene>
```

Switching controllers is a re-render of `<ThreeScene cameraRig={...}>` with a different component value. React unmounts the old controller (triggers cleanup: `world.removeCharacterController`, PointerLockControls exit) and mounts the new one. No imperative teardown required from the stage author.

`vehicleController` and `cursorController` do not use the `cameraRig` slot — they are composed separately (vehicle camera is a separate rig; cursor has no character).

---

## Composition with input abstraction (Wave 2G)

Controllers consume `src/lib/sensory/input.ts` for keyboard / mouse / gamepad / touch unification. Each controller declares required bindings; the stage can rebind.

```ts
// Default binding declarations (each controller exports its binding map)
const FPS_BINDINGS = {
  moveForward:  { keyboard: "KeyW", gamepad: "LeftStickUp" },
  moveBack:     { keyboard: "KeyS", gamepad: "LeftStickDown" },
  moveLeft:     { keyboard: "KeyA", gamepad: "LeftStickLeft" },
  moveRight:    { keyboard: "KeyD", gamepad: "LeftStickRight" },
  jump:         { keyboard: "Space", gamepad: "ButtonA" },
} satisfies ControllerBindings;
```

Stage rebind:
```ts
<FpsController bindings={{ ...FPS_BINDINGS, jump: { keyboard: "KeyF" } }} />
```

Touch input (mobile WASD) is a per-binding concern in `input.ts`, not a separate controller variant — each base controller receives unified `InputState`; `input.ts` maps touch events to the same logical axes.

---

## AI / pathfinding sub-deliverable

Wave 2H second piece. Three files:

**`src/lib/ai/pathfinding.ts`** — wrap `yuka.js` for navmesh + A* + waypoint graphs. Exposes:
```ts
class PathfindingAgent {
  navMesh: NavMesh;
  findPath(from: Vector3, to: Vector3): Vector3[];
  followPath(agent: RigidBody, dt: number): void;
}
```
Lazy-imported — stages that don't use pathfinding pay nothing.

**`src/lib/ai/perception.ts`** — cone-of-vision (field-of-view angle + max distance raycast check) + hearing radius (sphere query). Composes with `VoronoiInfluenceMap` (Wave 2E) for visualization: each NPC's awareness radius is a Voronoi cell.
```ts
function buildPerceptionSensor(options: {
  fovAngle: number;    // radians
  fovRange: number;    // units
  hearingRadius: number;
}): PerceptionSensor;
```

**`src/lib/patterns/behavior-tree.ts`** — composer over `fsm.ts` + decision nodes. Sequence / Selector / Condition / Action node types. Wraps `Fsm` transitions as Condition nodes so existing `fsm.ts` behavior stays compatible.
```ts
function behaviorTree(root: BtNode): BehaviorTree;
type BtNode = BtSequence | BtSelector | BtCondition | BtAction | BtDecorator;
```

---

## File layout

```
src/lib/3d/
  character-controller.ts       shared useCharacterController hook + substrate (~150 LOC)

src/lib/patterns/controllers/
  fps.ts                        (~100 LOC)
  third-person.ts               (~100 LOC)
  top-down.ts                   (~80 LOC)
  platformer.ts                 (~110 LOC)
  vehicle.ts                    (~120 LOC)
  cursor.ts                     (~70 LOC)

src/lib/ai/
  pathfinding.ts                yuka.js wrapper (~100 LOC)
  perception.ts                 cone-of-vision + hearing (~80 LOC)

src/lib/patterns/
  behavior-tree.ts              Fsm + decision composer (~100 LOC)
```

Pattern doc ships alongside: `src/lib/CONTROLLERS.md` (separate from this design doc; the stage-author-facing recipe page).

---

## Bundle / dependency strategy

| Dep | Version | Note |
|---|---|---|
| `@react-three/rapier` | `^1.4.0` peer | pin together with rapier-compat |
| `@dimforge/rapier3d-compat` | `^0.19.x` peer | pin together with R3R; API renames between versions (mining §12) |
| `yuka` | `^0.7.x` | lazy-imported in `lib/ai/pathfinding.ts` only |

**Pin both `@react-three/rapier` and `@dimforge/rapier3d-compat` together.** The `0.12` → `0.19` range has had multiple breaking renames on `KinematicCharacterController` properties; upgrading one independently will break the other (mining §12).

**Vite WASM plugin (optional):** use `@dimforge/rapier3d` (non-compat) with `vite-plugin-wasm` to save ~0.5MB and avoid base64 overhead (mining §11). Stages that don't need the savings stay on `-compat`. Config documented in `src/lib/3d/README.md`.

**Bundle cost summary:** Rapier WASM ~1.4–1.9MB uncompressed (both variants wire-compress similarly). Three.js ~600KB. These are dynamic-imported per Wave 2F modular packaging strategy — stages that don't render 3D pay nothing.

---

## Estimated LOC

| File | Est. LOC |
|---|---|
| `3d/character-controller.ts` | ~150 |
| `patterns/controllers/fps.ts` | ~100 |
| `patterns/controllers/third-person.ts` | ~100 |
| `patterns/controllers/top-down.ts` | ~80 |
| `patterns/controllers/platformer.ts` | ~110 |
| `patterns/controllers/vehicle.ts` | ~120 |
| `patterns/controllers/cursor.ts` | ~70 |
| `ai/pathfinding.ts` | ~100 |
| `ai/perception.ts` | ~80 |
| `patterns/behavior-tree.ts` | ~100 |
| **Wave 2H total** | **~1010 LOC** |

---

## Open questions

1. **Animation state machine.** Each controller has movement states (idle / walk / run / jump / fall) that drive animation. Is this a separate `src/lib/3d/animation-state.ts` primitive (probably), or a per-controller field? Probably a sibling primitive — `animationStatePattern` — that all controllers accept as an optional prop and call with their current locomotion state. Deserves its own design doc before Wave 2H implementation begins.

2. **Vehicle R3F wrapper.** No official R3F wrapper for `DynamicRayCastVehicleController` exists (issue #323 open). Options: (a) expose raw Rapier and let stage authors integrate, (b) ship our own thin `<VehicleController>` component. Recommendation: ship our own thin wrapper — the raw API surface is manageable (~150 LOC) and the stage author should not need to drop to `useRapier().world` for a first-class use case. Revisit if issue #323 ships before we do.

3. **Touch controller variants.** Mobile WASD (on-screen joystick) is handled as a touch binding in `input.ts`, not a separate controller. But some controllers (top-down click-to-move, cursor) have a gesture model rather than a joystick model. Touch-specific controller variants vs. per-controller touch-input-binding-overrides: the binding-overrides path is leaner; evaluate after `input.ts` (Wave 2G) is designed.
