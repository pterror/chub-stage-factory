/*
 * patterns/realtime-combat.ts — RealtimeWorld + Timeline + Rng composer.
 *
 * WHAT: `realtimeCombatPattern(init)` wires a `RealtimeWorld` with a
 *       `Timeline<RealtimeEvent>`, an `Rng` cosmetic stream, and an
 *       `ObservationSource` that feeds world state as visual observations.
 *       Returns a bundle with:
 *         - `world` — the `RealtimeWorld` instance.
 *         - `events` — the `Timeline<RealtimeEvent>`.
 *         - `rng` — the cosmetic Rng stream.
 *         - `tick(dt, now)` — run one physics tick, push events to the
 *           timeline, return the fired events.
 *         - `spawnAttack(def, ownerId, bounds, vel, now)` — convenience
 *           wrapper over `world.spawnAttack`.
 *         - `observationSources()` — default visual observation of
 *           combatants + active attacks.
 *
 * WHY: `realtime-combat/Stage.tsx` wired world + events + rng + observation
 *      manually. The wiring is the same for any arena-style stage; the only
 *      stage-specific bits are the arena bounds, the attack defs, and the
 *      spawn logic. This composer isolates the reusable scaffold.
 *
 *      No new mechanics. No private state. The underlying primitives are
 *      directly accessible on the returned bundle.
 *
 * SHAPE:
 *   interface RealtimeCombatInit
 *     { seed: number; bounds: ArenaBounds; timelineOpts?; }
 *   interface RealtimeCombatBundle
 *     { world; events; rng;
 *       tick(dt, now): RealtimeEvent[];
 *       spawnAttack(def, ownerId, state, now): void;
 *       observationSources(): ObservationSource<{ now: number }>[]; }
 *   function realtimeCombatPattern(init): RealtimeCombatBundle
 */

import {
  RealtimeWorld,
  type AttackDef,
  type Attack,
  type RealtimeEvent,
  type ArenaBounds,
} from "../../combat-realtime";
import { Rng } from "../../rng";
import { Timeline } from "../../timeline";
import type { ObservationSource } from "../../observation";

export interface RealtimeCombatInit {
  /** Seed for the `RealtimeWorld` tick counter. */
  seed: number;
  /** Arena collision bounds — passed directly to `RealtimeWorld`. */
  bounds: ArenaBounds;
  /** Options forwarded to the `Timeline<RealtimeEvent>` constructor.
   *  Defaults: windowSize=15, channels=["auditory"], key="last",
   *  saliencePer=6, habituationTau=1. */
  timelineOpts?: Partial<{
    id: string;
    channels: string[];
    key: "last" | "first";
    windowSize: number;
    saliencePer: number;
    habituationTau: number;
  }>;
  /** Seed string for the cosmetic Rng stream. Defaults to "arena". */
  rngSeed?: string;
}

export interface RealtimeCombatBundle {
  world: RealtimeWorld;
  events: Timeline<RealtimeEvent>;
  /** Cosmetic Rng stream — use for spread, spin jitter, etc. */
  rng: Rng;
  /** Run one physics dt, push resulting events onto the timeline. */
  tick(dt: number, now: number): RealtimeEvent[];
  /** Spawn an attack. Thin wrapper for `world.spawnAttack`. */
  spawnAttack(def: AttackDef, ownerId: string, state: { bounds: Attack["bounds"]; vel?: { x: number; y: number } }, now: number): void;
  /** Default visual observation of combatants + active attack count.
   *  Stage can extend or replace with its own sources. */
  observationSources(): ObservationSource<{ now: number }>[];
}

export function realtimeCombatPattern(init: RealtimeCombatInit): RealtimeCombatBundle {
  const world = new RealtimeWorld(init.seed, init.bounds);
  const rng = Rng.fromSeed(init.rngSeed ?? "arena");
  const events = new Timeline<RealtimeEvent>({
    id: init.timelineOpts?.id ?? "events",
    channels: init.timelineOpts?.channels ?? ["auditory"],
    key: init.timelineOpts?.key ?? "last",
    windowSize: init.timelineOpts?.windowSize ?? 15,
    saliencePer: init.timelineOpts?.saliencePer ?? 6,
    habituationTau: init.timelineOpts?.habituationTau ?? 1,
  });

  const tick = (dt: number, now: number): RealtimeEvent[] => {
    const fired = world.tick(dt, now);
    for (const e of fired) events.push(e, now);
    return fired;
  };

  const spawnAttack = (
    def: AttackDef,
    ownerId: string,
    state: { bounds: Attack["bounds"]; vel?: { x: number; y: number } },
    now: number,
  ): void => {
    world.spawnAttack(def, ownerId, state, now);
  };

  const observationSources = (): ObservationSource<{ now: number }>[] => [
    {
      id: "world",
      channels: ["visual"],
      salience: () => 1,
      habituationTau: 0,
      properties: {
        visual: {
          combatants: () =>
            [...world.combatants.values()].map((c) => ({
              id: c.id,
              team: c.team,
              hp: c.hp,
              pos: { x: Math.round(c.pos.x), y: Math.round(c.pos.y) },
            })),
          attacks: () => world.attacks.length,
        },
      },
    },
  ];

  return { world, events, rng, tick, spawnAttack, observationSources };
}
