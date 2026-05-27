/*
 * patterns/physics.ts — SpatialHash + AABB simulation + Rng + Observation composer.
 *
 * WHAT: `physicsPattern(init)` builds a `SpatialHash` from a list of named
 *       static obstacles and returns a bundle with:
 *         - `hash` — the `SpatialHash` (for stage-specific queries).
 *         - `rng` — the `Rng` instance (cosmetic stream on `.cosmetic`).
 *         - `simulate(x, y, vx, vy)` — run a bounded projectile sim:
 *           AABB + wall bounces, obstacle collision via `resolvePositional`,
 *           cosmetic spin jitter. Returns `{ hit, final, steps }`.
 *         - `observationSources(lastResult?)` — default visual observation
 *           of room dimensions, obstacles, and last-throw result.
 *
 * WHY: `physics/Stage.tsx` manually built the `SpatialHash`, ran the
 *      simulation loop, and assembled the observation sources inline. All of
 *      that is identical for any physics-sandbox stage; only the obstacle
 *      list, room bounds, and projectile parameters are stage-specific. This
 *      composer collapses the scaffold.
 *
 *      No new mechanics. No private state. `hash` and `rng` are directly
 *      accessible on the bundle for stage-specific extension.
 *
 * SHAPE:
 *   interface PhysicsObstacle { name: string; aabb: AABB }
 *   interface PhysicsInit
 *     { room: AABB; obstacles: PhysicsObstacle[];
 *       cellSize?: number; rngSeed?: string;
 *       simOpts?: { dt?; maxSteps?; friction?; wallRestitution?; obstacleRestitution? } }
 *   interface PhysicsSimResult { hit: string[]; final: AABB; steps: TrajectoryStep[] }
 *   interface PhysicsBundle
 *     { hash; rng;
 *       simulate(x, y, vx, vy): PhysicsSimResult;
 *       observationSources(lastResult?): ObservationSource<{ now: number }>[]; }
 *   function physicsPattern(init): PhysicsBundle
 */

import { type AABB, SpatialHash, aabbOverlap, resolvePositional } from "../physics";
import { Rng } from "../rng";
import type { ObservationSource } from "../observation";

export interface PhysicsObstacle {
  name: string;
  aabb: AABB;
}

export interface PhysicsSimOptions {
  /** Physics timestep. Default 0.1. */
  dt?: number;
  /** Maximum simulation steps. Default 60. */
  maxSteps?: number;
  /** Velocity friction coefficient per step. Default 0.92. */
  friction?: number;
  /** Velocity restitution on wall bounce. Default 0.6. */
  wallRestitution?: number;
  /** Velocity restitution on obstacle bounce. Default 0.5. */
  obstacleRestitution?: number;
  /** Size of the projectile AABB. Default { w: 6, h: 6 }. */
  projectileSize?: { w: number; h: number };
  /** Rest threshold: stop when |v| < threshold. Default 0.5. */
  restThreshold?: number;
}

export interface PhysicsInit {
  room: AABB;
  obstacles: PhysicsObstacle[];
  /** SpatialHash cell size. Default 32. */
  cellSize?: number;
  /** Seed string for cosmetic Rng. Default "physics". */
  rngSeed?: string;
  simOpts?: PhysicsSimOptions;
}

export interface TrajectoryStep {
  x: number;
  y: number;
  bounced: boolean;
}

export interface PhysicsSimResult {
  hit: string[];
  final: AABB;
  steps: TrajectoryStep[];
}

export interface PhysicsBundle {
  hash: SpatialHash<PhysicsObstacle>;
  rng: Rng;
  simulate(x: number, y: number, vx: number, vy: number): PhysicsSimResult;
  /** Default observation sources. Pass `lastResult` to surface throw data. */
  observationSources(lastResult?: PhysicsSimResult): ObservationSource<{ now: number }>[];
}

export function physicsPattern(init: PhysicsInit): PhysicsBundle {
  const hash = new SpatialHash<PhysicsObstacle>(init.cellSize ?? 32);
  for (const o of init.obstacles) hash.insert(o, o.aabb);

  const rng = Rng.fromSeed(init.rngSeed ?? "physics");

  const opts: Required<PhysicsSimOptions> = {
    dt: init.simOpts?.dt ?? 0.1,
    maxSteps: init.simOpts?.maxSteps ?? 60,
    friction: init.simOpts?.friction ?? 0.92,
    wallRestitution: init.simOpts?.wallRestitution ?? 0.6,
    obstacleRestitution: init.simOpts?.obstacleRestitution ?? 0.5,
    projectileSize: init.simOpts?.projectileSize ?? { w: 6, h: 6 },
    restThreshold: init.simOpts?.restThreshold ?? 0.5,
  };

  const simulate = (
    x: number,
    y: number,
    vx: number,
    vy: number,
  ): PhysicsSimResult => {
    const proj: AABB = { x, y, w: opts.projectileSize.w, h: opts.projectileSize.h };
    const steps: TrajectoryStep[] = [{ x: proj.x, y: proj.y, bounced: false }];
    const hit: string[] = [];
    const { dt, maxSteps, friction, wallRestitution, obstacleRestitution, restThreshold } = opts;
    const room = init.room;

    for (let i = 0; i < maxSteps; i++) {
      proj.x += vx * dt;
      proj.y += vy * dt;
      let bounced = false;

      if (proj.x < room.x) { proj.x = room.x; vx = -vx * wallRestitution; bounced = true; }
      if (proj.x + proj.w > room.x + room.w) { proj.x = room.x + room.w - proj.w; vx = -vx * wallRestitution; bounced = true; }
      if (proj.y < room.y) { proj.y = room.y; vy = -vy * wallRestitution; bounced = true; }
      if (proj.y + proj.h > room.y + room.h) { proj.y = room.y + room.h - proj.h; vy = -vy * wallRestitution; bounced = true; }

      const candidates = hash.query(proj);
      for (const c of candidates) {
        if (!aabbOverlap(proj, c.aabb)) continue;
        const adj = resolvePositional(proj, c.aabb);
        proj.x += adj.ax;
        proj.y += adj.ay;
        if (Math.abs(adj.ax) > Math.abs(adj.ay)) {
          vx = -vx * obstacleRestitution;
        } else {
          vy = -vy * obstacleRestitution;
        }
        vx += rng.cosmetic.float() * 0.4 - 0.2;
        bounced = true;
        if (!hit.includes(c.name)) hit.push(c.name);
      }

      vx *= friction;
      vy *= friction;
      steps.push({ x: Number(proj.x.toFixed(2)), y: Number(proj.y.toFixed(2)), bounced });
      if (Math.abs(vx) < restThreshold && Math.abs(vy) < restThreshold) break;
    }

    return { hit, final: { ...proj }, steps };
  };

  const observationSources = (
    lastResult?: PhysicsSimResult,
  ): ObservationSource<{ now: number }>[] => [
    {
      id: "room",
      channels: ["visual"],
      salience: () => 0.5,
      habituationTau: 20,
      properties: {
        visual: {
          room: () => ({ w: init.room.w, h: init.room.h }),
          obstacles: () => init.obstacles.map((o) => ({ name: o.name, ...o.aabb })),
        },
      },
    },
    {
      id: "last-throw",
      channels: ["visual"],
      salience: () => (lastResult ? 1 : 0),
      habituationTau: 0,
      properties: {
        visual: {
          hit: () => lastResult?.hit ?? [],
          ended_at: () => lastResult?.final ?? null,
          steps_count: () => lastResult?.steps.length ?? 0,
        },
      },
    },
  ];

  return { hash, rng, simulate, observationSources };
}
