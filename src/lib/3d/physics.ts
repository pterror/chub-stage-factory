/*
 * physics.ts — Rapier-WASM 3D rigid-body world wrapper for Wave 2F.
 *
 * WHAT: Thin facade over @dimforge/rapier3d-compat with lazy WASM init,
 *       a `Physics3DWorld` class that holds the Rapier world + handle map,
 *       and helpers for the common rigid-body shapes (box, sphere, capsule).
 *
 * WHY: Stages want "throw a sphere, see it bounce" without learning Rapier's
 *      RigidBodyDesc/ColliderDesc handle dance. The wrapper keeps the same
 *      shape as `src/lib/physics.ts` (the 2D primitive): pure-data step
 *      function + spatial query, with a class for stateful holding.
 *
 *      WASM init is lazy and idempotent — first `Physics3DWorld.init()`
 *      call awaits, subsequent calls reuse the cached module.
 *
 * SHAPE:
 *   async initRapier(): Promise<typeof RAPIER>      // idempotent
 *   interface BodyOptions { type?; position?; rotation?; linvel?; angvel?; ccd? }
 *   interface ColliderOptions { restitution?; friction?; density?; sensor? }
 *   class Physics3DWorld
 *     constructor(opts?: { gravity?: Vec3 })       // requires initRapier() first
 *     step(dt?: number): void                       // fixed-step recommended
 *     addBox(half: Vec3, body: BodyOptions, col?: ColliderOptions): BodyId
 *     addSphere(radius, body, col?): BodyId
 *     addCapsule(halfHeight, radius, body, col?): BodyId
 *     addStaticPlane(normal: Vec3, point: Vec3): BodyId
 *     remove(id: BodyId): void
 *     getTransform(id: BodyId): { position: Vec3; rotation: Quat } | null
 *     setKinematicPosition(id, pos): void
 *     applyImpulse(id, impulse: Vec3): void
 *     castRay(origin, dir, maxToi?): RayHit | null
 *     dispose(): void
 *
 * Determinism: Rapier is deterministic given identical inputs and step order.
 *   Tests can rely on this; see `physics.test.ts`.
 */

// We intentionally import the compat package (inlined wasm as base64) — no
// separate fetch needed, works in iframe/sandbox without asset routing.
import type * as RAPIER_NS from "@dimforge/rapier3d-compat";

export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };
export type BodyId = number;

export interface BodyOptions {
  /** Default `'dynamic'`. */
  type?: "dynamic" | "kinematic-position" | "kinematic-velocity" | "static";
  position?: Vec3;
  rotation?: Quat;
  linvel?: Vec3;
  angvel?: Vec3;
  /** Enable continuous collision detection (small fast objects). */
  ccd?: boolean;
}

export interface ColliderOptions {
  restitution?: number;
  friction?: number;
  density?: number;
  /** Sensor colliders detect overlap but do not generate forces. */
  sensor?: boolean;
}

export interface RayHit {
  bodyId: BodyId;
  toi: number;
  point: Vec3;
}

const DEFAULT_GRAVITY: Vec3 = {x: 0, y: -9.81, z: 0};
const DEFAULT_TIMESTEP = 1 / 60;

let rapierModule: typeof RAPIER_NS | null = null;
let rapierInitPromise: Promise<typeof RAPIER_NS> | null = null;

/**
 * Lazy-initialize Rapier WASM. Idempotent. Returns the Rapier module namespace.
 *
 * The compat package inlines the wasm as base64 so no asset routing is needed.
 * First call may take ~50-150ms; subsequent calls resolve synchronously from
 * cache.
 */
export async function initRapier(): Promise<typeof RAPIER_NS> {
  if (rapierModule) return rapierModule;
  if (rapierInitPromise) return rapierInitPromise;
  rapierInitPromise = (async () => {
    const mod = await import("@dimforge/rapier3d-compat");
    await mod.init();
    rapierModule = mod;
    return mod;
  })();
  return rapierInitPromise;
}

/** True after `initRapier()` has resolved at least once. */
export function isRapierReady(): boolean {
  return rapierModule !== null;
}

/**
 * Rigid-body world. Construct AFTER `await initRapier()` — the constructor
 * uses the module synchronously and will throw if WASM is not ready.
 */
export class Physics3DWorld {
  private world: RAPIER_NS.World;
  private bodies = new Map<BodyId, RAPIER_NS.RigidBody>();
  private nextId: BodyId = 1;
  private RAPIER: typeof RAPIER_NS;

  constructor(opts: {gravity?: Vec3} = {}) {
    if (!rapierModule) {
      throw new Error(
        "Physics3DWorld: Rapier not initialized — call `await initRapier()` first.",
      );
    }
    this.RAPIER = rapierModule;
    const g = opts.gravity ?? DEFAULT_GRAVITY;
    this.world = new this.RAPIER.World(g);
  }

  /** Step the world by `dt` seconds. Default 1/60. Prefer a fixed timestep. */
  step(dt: number = DEFAULT_TIMESTEP): void {
    this.world.timestep = dt;
    this.world.step();
  }

  addBox(half: Vec3, body: BodyOptions = {}, col: ColliderOptions = {}): BodyId {
    const rb = this.makeBody(body);
    const cdesc = this.RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z);
    this.applyColliderOptions(cdesc, col);
    this.world.createCollider(cdesc, rb);
    return this.register(rb);
  }

  addSphere(radius: number, body: BodyOptions = {}, col: ColliderOptions = {}): BodyId {
    const rb = this.makeBody(body);
    const cdesc = this.RAPIER.ColliderDesc.ball(radius);
    this.applyColliderOptions(cdesc, col);
    this.world.createCollider(cdesc, rb);
    return this.register(rb);
  }

  addCapsule(
    halfHeight: number,
    radius: number,
    body: BodyOptions = {},
    col: ColliderOptions = {},
  ): BodyId {
    const rb = this.makeBody(body);
    const cdesc = this.RAPIER.ColliderDesc.capsule(halfHeight, radius);
    this.applyColliderOptions(cdesc, col);
    this.world.createCollider(cdesc, rb);
    return this.register(rb);
  }

  /** Infinite static plane. `normal` points "up" (away from solid side). */
  addStaticPlane(normal: Vec3, point: Vec3): BodyId {
    const bdesc = this.RAPIER.RigidBodyDesc.fixed().setTranslation(point.x, point.y, point.z);
    const rb = this.world.createRigidBody(bdesc);
    // Rapier has no infinite-plane collider; approximate with a thin huge box
    // oriented to the normal. For axis-aligned floor (0,1,0), this is a wide
    // thin slab at point.y.
    const slabHalf = 1000;
    const slabThickness = 0.1;
    let cdesc: RAPIER_NS.ColliderDesc;
    if (Math.abs(normal.y) > Math.abs(normal.x) && Math.abs(normal.y) > Math.abs(normal.z)) {
      cdesc = this.RAPIER.ColliderDesc.cuboid(slabHalf, slabThickness, slabHalf)
        .setTranslation(0, -slabThickness * Math.sign(normal.y), 0);
    } else if (Math.abs(normal.x) > Math.abs(normal.z)) {
      cdesc = this.RAPIER.ColliderDesc.cuboid(slabThickness, slabHalf, slabHalf)
        .setTranslation(-slabThickness * Math.sign(normal.x), 0, 0);
    } else {
      cdesc = this.RAPIER.ColliderDesc.cuboid(slabHalf, slabHalf, slabThickness)
        .setTranslation(0, 0, -slabThickness * Math.sign(normal.z));
    }
    this.world.createCollider(cdesc, rb);
    return this.register(rb);
  }

  remove(id: BodyId): void {
    const rb = this.bodies.get(id);
    if (!rb) return;
    this.world.removeRigidBody(rb);
    this.bodies.delete(id);
  }

  getTransform(id: BodyId): {position: Vec3; rotation: Quat} | null {
    const rb = this.bodies.get(id);
    if (!rb) return null;
    const t = rb.translation();
    const r = rb.rotation();
    return {
      position: {x: t.x, y: t.y, z: t.z},
      rotation: {x: r.x, y: r.y, z: r.z, w: r.w},
    };
  }

  setKinematicPosition(id: BodyId, pos: Vec3): void {
    const rb = this.bodies.get(id);
    if (!rb) return;
    rb.setNextKinematicTranslation(pos);
  }

  applyImpulse(id: BodyId, impulse: Vec3): void {
    const rb = this.bodies.get(id);
    if (!rb) return;
    rb.applyImpulse(impulse, true);
  }

  /** Raycast against all colliders. Returns nearest hit or null. */
  castRay(origin: Vec3, dir: Vec3, maxToi: number = 1000): RayHit | null {
    const ray = new this.RAPIER.Ray(origin, dir);
    const hit = this.world.castRay(ray, maxToi, true);
    if (!hit) return null;
    const collider = hit.collider;
    const rb = collider.parent();
    if (!rb) return null;
    // Find our BodyId for this RB.
    let bodyId: BodyId | null = null;
    for (const [id, b] of this.bodies) {
      if (b.handle === rb.handle) {
        bodyId = id;
        break;
      }
    }
    if (bodyId == null) return null;
    const point = ray.pointAt(hit.timeOfImpact);
    return {
      bodyId,
      toi: hit.timeOfImpact,
      point: {x: point.x, y: point.y, z: point.z},
    };
  }

  /** Release Rapier resources. The world is unusable after this. */
  dispose(): void {
    this.world.free();
    this.bodies.clear();
  }

  /** Internal: number of registered bodies. */
  bodyCount(): number {
    return this.bodies.size;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private makeBody(opts: BodyOptions): RAPIER_NS.RigidBody {
    const R = this.RAPIER;
    let bdesc: RAPIER_NS.RigidBodyDesc;
    switch (opts.type ?? "dynamic") {
      case "dynamic":
        bdesc = R.RigidBodyDesc.dynamic();
        break;
      case "kinematic-position":
        bdesc = R.RigidBodyDesc.kinematicPositionBased();
        break;
      case "kinematic-velocity":
        bdesc = R.RigidBodyDesc.kinematicVelocityBased();
        break;
      case "static":
        bdesc = R.RigidBodyDesc.fixed();
        break;
    }
    if (opts.position) bdesc.setTranslation(opts.position.x, opts.position.y, opts.position.z);
    if (opts.rotation) bdesc.setRotation(opts.rotation);
    if (opts.linvel) bdesc.setLinvel(opts.linvel.x, opts.linvel.y, opts.linvel.z);
    if (opts.angvel) bdesc.setAngvel(opts.angvel);
    if (opts.ccd) bdesc.setCcdEnabled(true);
    return this.world.createRigidBody(bdesc);
  }

  private applyColliderOptions(cdesc: RAPIER_NS.ColliderDesc, col: ColliderOptions): void {
    if (col.restitution != null) cdesc.setRestitution(col.restitution);
    if (col.friction != null) cdesc.setFriction(col.friction);
    if (col.density != null) cdesc.setDensity(col.density);
    if (col.sensor) cdesc.setSensor(true);
  }

  private register(rb: RAPIER_NS.RigidBody): BodyId {
    const id = this.nextId++;
    this.bodies.set(id, rb);
    return id;
  }
}
