/*
 * patterns/spatial-propagation.ts — events propagate room-to-room through the world graph.
 *
 * WHAT: `spatialPropagationPattern(init)` models events (fire, infection, gossip,
 *       smoke, sound) that spread across the world graph each tick:
 *
 *         - `seed(roomId, payload)` — place an event source in a room.
 *         - `tick(now, state, refs, rng)` — one propagation step:
 *             1. Evaluate each active wavefront via its `trigger` (probability +
 *                predicate gate supplied per-seed type).
 *             2. For each wavefront that fires, attempt to spread into each
 *                adjacent room (honouring exit visibility / gates per caller opts).
 *             3. Return the `PropagationEvent`s emitted this step (new rooms
 *                infected + rooms cleared if `decays` is set).
 *             4. Push events onto the timeline.
 *         - `wavefronts()` — current set of (roomId, payload) pairs.
 *         - `clear(roomId?)` — remove wavefront from a room (or all rooms).
 *
 *       Decay: when `decays` is true, each source has a `ttl` counter; on
 *       reaching 0 the wavefront is removed and a `cleared` event emitted.
 *
 * WHY: Flexible-survival-shape (#7) needs infection vectors; facility-management-
 *      shape (#20) needs fire + panic spread; any multi-room world with dynamic
 *      state spread needs this pattern. The world graph is the substrate; triggers
 *      provide the conditional probability; the timeline records the history.
 *
 *      Composes: world (room graph + exit adjacency), trigger (per-room
 *      conditional probability), timeline (propagation event log).
 *
 * SHAPE:
 *   interface WavefrontDef<S, E>
 *     { id; propagationProbability: number; ttl?: number;
 *       spreadGate?: Predicate<S>; payload: E }
 *   type PropagationEvent<E>
 *     | { kind: "spread"; fromRoom; toRoom; payload: E }
 *     | { kind: "seeded"; roomId; payload: E }
 *     | { kind: "cleared"; roomId; payload: E }
 *   interface SpatialPropagationInit<S, E>
 *     { world; timeline?; resolvers?; includeHidden? }
 *   interface SpatialPropagationBundle<S, E>
 *     { world; timeline;
 *       seed(roomId, def): void;
 *       tick(now, state, refs, rng): PropagationEvent<E>[];
 *       wavefronts(): Map<string, { def; ttlRemaining?: number }>;
 *       clear(roomId?): void; }
 *   function spatialPropagationPattern<S, E>(init): SpatialPropagationBundle<S, E>
 */

import { type Refs, type Resolvers, evaluate as evalPredicate } from "../predicate";
import type { Predicate } from "../predicate";
import { type RngStream } from "../rng";
import { Timeline } from "../timeline";
import { type World } from "../world";

export interface WavefrontDef<S = unknown, E = unknown> {
  /** Unique id for this wavefront type (e.g. "fire", "infection", "gossip"). */
  id: string;
  /**
   * Probability [0..1] of spreading to each adjacent room per tick.
   * Applied independently per neighbour.
   */
  propagationProbability: number;
  /**
   * Optional gate predicate evaluated against the *destination* room with
   * `refs.self` set to the destination room id. Spread is suppressed when
   * the predicate fails.
   */
  spreadGate?: Predicate<S>;
  /**
   * Time-to-live in ticks. When > 0 the wavefront decrements each tick and
   * is cleared on reaching 0. Omit for indefinite spread.
   */
  ttl?: number;
  /** Stage-author payload carried with each propagation event. */
  payload: E;
}

export type PropagationEvent<E> =
  | { kind: "spread"; fromRoom: string; toRoom: string; payload: E }
  | { kind: "seeded"; roomId: string; payload: E }
  | { kind: "cleared"; roomId: string; payload: E };

export interface SpatialPropagationInit<S = unknown, E = unknown> {
  world: World;
  /** Shared timeline for propagation events. Created if absent. */
  timeline?: Timeline<PropagationEvent<E>>;
  /** Resolvers forwarded to `spreadGate` predicate evaluation. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolvers?: Resolvers<S, any>;
  /**
   * When true, spread considers hidden exits. Default false — hidden exits
   * block propagation until a reveal hook is satisfied.
   */
  includeHidden?: boolean;
}

interface ActiveWavefront<S, E> {
  def: WavefrontDef<S, E>;
  ttlRemaining?: number;
}

export interface SpatialPropagationBundle<S = unknown, E = unknown> {
  world: World;
  timeline: Timeline<PropagationEvent<E>>;
  /**
   * Seed a wavefront in `roomId`. If a wavefront with the same `def.id` is
   * already present, the ttl is reset but the payload is unchanged.
   */
  seed(roomId: string, def: WavefrontDef<S, E>): void;
  /**
   * Advance one propagation tick. Spreads wavefronts, decrements ttl,
   * clears exhausted wavefronts. Returns events emitted this tick and
   * pushes them onto the timeline.
   */
  tick(now: number, state: S, refs: Refs<string>, rng: RngStream): PropagationEvent<E>[];
  /** Current wavefront map: roomId → { def, ttlRemaining? }. */
  wavefronts(): Map<string, ActiveWavefront<S, E>>;
  /**
   * Remove wavefront from `roomId` (emits `cleared`). When `roomId` is
   * omitted, clears all wavefronts.
   */
  clear(roomId?: string): void;
}

export function spatialPropagationPattern<S = unknown, E = unknown>(
  init: SpatialPropagationInit<S, E>,
): SpatialPropagationBundle<S, E> {
  const timeline = init.timeline ?? new Timeline<PropagationEvent<E>>({ windowSize: 256 });
  /** roomId → ActiveWavefront */
  const active = new Map<string, ActiveWavefront<S, E>>();

  const seed = (roomId: string, def: WavefrontDef<S, E>): void => {
    const existing = active.get(roomId);
    if (existing && existing.def.id === def.id) {
      // Reset ttl if already present.
      if (def.ttl !== undefined) existing.ttlRemaining = def.ttl;
      return;
    }
    active.set(roomId, { def, ttlRemaining: def.ttl });
    const ev: PropagationEvent<E> = { kind: "seeded", roomId, payload: def.payload };
    timeline.push(ev);
  };

  const tick = (now: number, state: S, refs: Refs<string>, rng: RngStream): PropagationEvent<E>[] => {
    const emitted: PropagationEvent<E>[] = [];
    const toSpread: [string, WavefrontDef<S, E>][] = [];
    const toRemove: [string, E][] = [];

    for (const [roomId, wf] of active) {
      // Decrement ttl.
      if (wf.ttlRemaining !== undefined) {
        wf.ttlRemaining--;
        if (wf.ttlRemaining <= 0) {
          toRemove.push([roomId, wf.def.payload]);
          continue;
        }
      }
      toSpread.push([roomId, wf.def]);
    }

    // Clear exhausted wavefronts.
    for (const [roomId, payload] of toRemove) {
      active.delete(roomId);
      const ev: PropagationEvent<E> = { kind: "cleared", roomId, payload };
      emitted.push(ev);
      timeline.push(ev, now);
    }

    // Spread surviving wavefronts.
    for (const [fromRoom, def] of toSpread) {
      const exits = init.world.exitsFrom(fromRoom, {
        includeHidden: init.includeHidden ?? false,
      });
      for (const exit of Object.values(exits)) {
        const toRoom = exit.to;
        if (active.has(toRoom)) continue; // already infected

        // Roll probability.
        if (rng.float() > def.propagationProbability) continue;

        // Check spread gate against the destination room.
        if (def.spreadGate) {
          const destRefs: Refs<string> = { ...refs, self: toRoom };
          if (!evalPredicate(def.spreadGate, state, destRefs, init.resolvers ?? {})) continue;
        }

        // Spread.
        active.set(toRoom, {
          def,
          ttlRemaining: def.ttl !== undefined ? def.ttl : undefined,
        });
        const ev: PropagationEvent<E> = { kind: "spread", fromRoom, toRoom, payload: def.payload };
        emitted.push(ev);
        timeline.push(ev, now);
      }
    }

    return emitted;
  };

  const wavefronts = (): Map<string, ActiveWavefront<S, E>> => new Map(active);

  const clear = (roomId?: string): void => {
    if (roomId !== undefined) {
      const wf = active.get(roomId);
      if (wf) {
        active.delete(roomId);
        const ev: PropagationEvent<E> = { kind: "cleared", roomId, payload: wf.def.payload };
        timeline.push(ev);
      }
    } else {
      for (const [rId, wf] of active) {
        const ev: PropagationEvent<E> = { kind: "cleared", roomId: rId, payload: wf.def.payload };
        timeline.push(ev);
      }
      active.clear();
    }
  };

  return {
    world: init.world,
    timeline,
    seed,
    tick,
    wavefronts,
    clear,
  };
}
