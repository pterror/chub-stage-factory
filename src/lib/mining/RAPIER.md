# Rapier Kinematic Character Controller: Research Summary

> Mined 2026-05-24 as prior art for chub-stage-factory primitives library.
> Captured verbatim from the mining run; informs the Wave 2H character controller patterns design.

---

Informing `lib/patterns/controllers/{fps,third-person,top-down,platformer,vehicle,cursor}.ts`

---

## 1. Kinematic vs Dynamic Body

**Dynamic bodies** are driven by the physics solver: gravity, impulses, friction, and contact resolution happen automatically. Movement is achieved by setting velocities. The tradeoff is loss of direct control — the solver can push the character in unexpected ways, tunneling can occur at high speeds (discrete collision detection), and fine-tuned "game feel" (e.g., zero-slip turning, instant stops) requires fighting the solver.

**Kinematic bodies** are immune to forces, impulses, gravity, and contacts. The user sets position directly each frame. Rapier offers two kinematic sub-types: `KinematicPositionBased` (you supply the next-frame position; Rapier infers velocity for interaction with dynamic bodies) and `KinematicVelocityBased` (you supply velocity; Rapier integrates position).

**Rapier's `KinematicCharacterController`** is not a rigid body type — it is a standalone utility object (created via `world.createCharacterController(offset)`) that emits the correct ray-casts and shape-casts to compute a safe, obstacle-adjusted translation from a desired translation, implementing collide-and-slide. It works with a `KinematicPositionBased` RigidBody: after calling `computeColliderMovement(collider, desiredTranslation, ...)`, you read the result via `computedMovement()` and apply it with `rigidBody.setNextKinematicTranslation(newPos)`.

Use kinematic + KinematicCharacterController for: FPS, third-person, top-down, platformer, cursor. Use dynamic for: vehicle chassis (Rapier's `DynamicRayCastVehicleController` requires a dynamic or kinematic-velocity-based body). Self-collision must be excluded manually via filter (`filterPredicate` or `QueryFilter::exclude_collider`).

---

## 2. Collide-and-Slide

`computeColliderMovement` implements multi-step collide-and-slide internally. It casts the character's shape along the desired translation, resolves any hit, re-orients the remaining movement tangent to the surface normal, and repeats for a fixed number of sub-steps. The `offset` parameter (constructor, e.g. `0.01`) is a mandatory skin gap preserved between the character collider and geometry to maintain numerical stability — never set it to zero. If `offset` is too large, visible floating occurs.

Corners and concave geometry are handled by the `normal_nudge_factor` (a small push in the direction of contact normals at each sub-step), which prevents the character from getting permanently stuck in an "always-penetrating" state. Tuning is delicate: too large causes artificial bumps along flat surfaces. A known historical bug (issue #485) caused clipping through objects when `desiredTranslation` was exactly zero; workaround: guard with a near-zero magnitude check before calling.

---

## 3. Slope Handling

Two angles govern slope behavior:

- `setMaxSlopeClimbAngle(angle)` — the maximum angle (radians) between the floor normal and the up vector the character can climb. Above this angle, the character cannot move uphill onto the surface.
- `setMinSlopeSlideAngle(angle)` — the minimum angle before the character begins automatically sliding downhill. Below this angle (shallower slopes) the character stands still; above it, they slide.

Typical defaults: climb ~45°, slide ~30°. Both should be tuned per controller type — platformers often want a tighter climb angle; top-down may want flat-only movement.

---

## 4. Up-Vector / Orientation

The up-vector defines "vertical" for the controller, determining what constitutes floor vs. wall. Default is positive Y (`{x:0, y:1, z:0}`). It can be set to any unit vector via the controller's `up` field. For a wall-running FPS, set it dynamically each frame. For vehicle controllers, the up-vector concept does not apply — `DynamicRayCastVehicleController` uses its own `chassisLocalForwardDir` and `chassisLocalUp` configuration independent of the character controller system. For a top-down cursor controller with a tilted camera plane, the up-vector should match world Y (gravity direction), not the camera's local up.

---

## 5. Gravity Application

Gravity is **entirely manual** for kinematic characters. The physics world's global gravity (`world.gravity`) and per-body `gravityScale` only affect **dynamic** bodies. For kinematic characters, you must accumulate a vertical velocity per frame (`yVelocity -= gravity * dt`), include it in `desiredTranslation`, and zero it out when `computedIsOnGround()` returns true (or equivalent grounded detection). Reset to a small negative value (not zero) when grounded to ensure snap-to-ground continues working.

---

## 6. Jump / Vertical Movement

There is no native impulse or velocity API for kinematic controllers — only translation. Pattern:

```ts
if (jumpPressed && isOnGround) yVelocity = jumpSpeed;
yVelocity -= gravity * dt;
desiredTranslation.y = yVelocity * dt;
controller.computeColliderMovement(collider, desiredTranslation);
const corrected = controller.computedMovement();
if (controller.computedIsOnGround()) yVelocity = 0;
```

Ground check: `controller.computedIsOnGround()` reflects the ground state after the most recent `computeColliderMovement` call. This is the correct source for grounded state — do not use ray-casting separately (it can disagree with the controller's internal state). Coyote time is implemented by tracking the timestamp of the last frame `computedIsOnGround()` was true.

---

## 7. Step Climbing (Autostep)

Enabled via `controller.enableAutostep(maxHeight, minWidth, onDynamicBodies)`, disabled by default because it is computationally expensive (additional shape-casts per step). Parameters:

- `maxHeight`: maximum obstacle height the character climbs over (e.g. `0.5`)
- `minWidth`: minimum flat space required on top of the obstacle (e.g. `0.2`)
- `onDynamicBodies`: whether to autostep over dynamic bodies (use `false` for most characters)

Edge cases: autostep can interact badly with slopes — a slope segment that looks like a step can be climbed when it shouldn't be. Disable autostep for vehicle and cursor controllers.

---

## 8. Snap-to-Ground

`controller.enableSnapToGround(distance)` — snaps the character down if the gap to the ground is smaller than `distance`. This prevents the character from launching off the ground when crossing a downhill bump or after autostep. Use an absolute or relative distance (e.g. `0.5` units). Without this, a platformer character visibly "bounces" over slight downhill geometry changes. Reset yVelocity to a small negative constant (e.g. `-0.1`) rather than zero when grounded, so snap-to-ground's downward cast stays active.

---

## 9. Common Footguns

- **Zero-vector input bug (issue #485):** Calling `computeColliderMovement` with a zero translation causes the internal while-loop to be skipped, potentially causing the character to clip into geometry on the next non-zero frame. Guard: `if (desired.length() < 1e-5) return;` or always include the gravity component.
- **Self-collision:** The character's own collider must be excluded from `computeColliderMovement` via `filterPredicate` or it will collide with itself and refuse to move.
- **Moving platforms (issue #488):** Standing on a kinematic moving platform causes dipping and bouncing. There is no built-in solution; a common workaround is to parent the character's position to the platform manually or apply platform velocity to the character's desired translation.
- **Friction is ignored:** Physical friction on colliders has no effect on kinematic character movement. Any "surface friction" (ice, mud, etc.) must be implemented manually via per-surface velocity damping.
- **Offset must not be zero:** Causes numerical instability and character getting stuck.
- **normal_nudge_factor tuning:** Getting stuck at wall/floor junctions is the symptom; increasing this value fixes it but introduces bumping on flat walls.
- **Collision groups filtering may not work as expected:** Issue #497 documents that setting `filterGroups` on `computeColliderMovement` can be unreliable; prefer `filterPredicate` for deterministic exclusion.
- **`computedIsOnGround()` reflects post-correction state:** Do not check grounded before calling `computeColliderMovement`, only after.

---

## 10. R3F Integration Patterns

`@react-three/rapier` does not ship a first-class `useKinematicCharacterController` hook as of v1.x. The recommended pattern is:

1. Create the controller once in a `useEffect` using the raw Rapier world from `useRapier()`:
   ```ts
   const { world, rapier } = useRapier();
   const controller = world.createCharacterController(0.01);
   ```
2. Store a ref to the `<RigidBody type="kinematicPosition">` via `ref`.
3. In `useBeforePhysicsStep` (runs before each physics tick), compute and apply movement:
   ```ts
   useBeforePhysicsStep(() => {
     controller.computeColliderMovement(colliderRef.current, desired);
     const movement = controller.computedMovement();
     rigidBodyRef.current.setNextKinematicTranslation(newPos);
   });
   ```
4. Sync the Three.js mesh position in `useFrame` after the physics step (R3R does this automatically for RigidBody children).

The `RigidBodyType` enum maps to: `"kinematicPosition"` for character controllers, `"dynamic"` for vehicle chassis.

---

## 11. Performance

- The WASM binary (`@dimforge/rapier3d-compat`) is ~1.9 MB uncompressed, ~1.4 MB for the raw WASM variant. Gzipped both land around the same wire size. For chub-stage-factory's browser-only, no-native constraint this is acceptable but is a non-trivial bundle cost.
- Use `@dimforge/rapier3d` (not `-compat`) with a Vite WASM plugin to save ~0.5 MB and avoid base64 overhead.
- Autostep is the single most expensive feature per-character; keep it disabled unless explicitly needed (platformer only).
- Setting `Physics updateLoop="independent"` in R3R decouples the physics step from the render loop, reducing jank on slow frames but requiring careful interpolation for smooth character rendering.
- Each `computeColliderMovement` call does multiple internal shape-casts; for 6 controller types simultaneously, profile under load.

---

## 12. API Stability

- `@react-three/rapier` v1.4.0 bumped the internal `@dimforge/rapier3d-compat` from `0.12.0` to `0.13.1`, which included breaking renames (`allowedLinearError` → `normalizedAllowedLinearError`, `predictionDistance` → `normalizedPredictionDistance`).
- Recent releases (as of early 2026) target `@dimforge/rapier3d-compat@0.19.x`. The `0.12` → `0.19` range has had multiple breaking API renames on the `World` object.
- Pin both `@react-three/rapier` and `@dimforge/rapier3d-compat` together — do not upgrade one independently.
- The `KinematicCharacterController` JS API surface (create, computeColliderMovement, computedMovement, enableAutostep, enableSnapToGround, setMaxSlopeClimbAngle, setMinSlopeSlideAngle) has been stable since ~0.11 but world-level configuration props are where renames happen.
- The `DynamicRayCastVehicleController` has no official R3R wrapper yet (issue #323 is open); use `useRapier().world.createVehicleController()` directly.

---

Sources:
- [Character controller | Rapier (JS)](https://rapier.rs/docs/user_guides/javascript/character_controller/)
- [KinematicCharacterController | @dimforge/rapier3d](https://rapier.rs/javascript3d/classes/KinematicCharacterController.html)
- [DynamicRayCastVehicleController | @dimforge/rapier3d](https://rapier.rs/javascript3d/classes/DynamicRayCastVehicleController.html)
- [character_controller_up_vector | Rapier (Bevy)](https://rapier.rs/docs/user_guides/bevy_plugin/character_controller_up_vector/)
- [KinematicCharacterController in rapier3d::control (Rust)](https://idanarye.github.io/bevy-tnua/rapier3d/control/struct.KinematicCharacterController.html)
- [GitHub: pmndrs/react-three-rapier](https://github.com/pmndrs/react-three-rapier)
- [GitHub: dimforge/rapier - CHANGELOG.md](https://github.com/dimforge/rapier/blob/master/CHANGELOG.md)
- [GitHub: rapier.js testbed characterController.ts](https://github.com/dimforge/rapier.js/blob/master/testbed3d/src/demos/characterController.ts)
- [Issue #485: move_shape clips through objects when desired_translation is zero](https://github.com/dimforge/rapier/issues/485)
- [Issue #488: KCC dips on moving vertical platform](https://github.com/dimforge/rapier/issues/488)
- [Issue #497: Collision groups not working](https://github.com/dimforge/rapier/issues/497)
- [Issue #323: DynamicRayCastVehicleController R3F API](https://github.com/pmndrs/react-three-rapier/issues/323)
- [Bundle size discussion](https://github.com/pmndrs/react-three-rapier/discussions/377)
- [GitHub: icurtis1/fps-sample-project](https://github.com/icurtis1/fps-sample-project)
- [GitHub: doppl3r/kinematic-character-controller-example](https://github.com/doppl3r/kinematic-character-controller-example)
