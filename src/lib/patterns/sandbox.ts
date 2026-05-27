/*
 * patterns/sandbox.ts — free-roam stage composer: world + actor + intent + procgen.
 *
 * WHAT: `sandboxPattern(init)` wires the full open-world turn loop for
 *       exploration-style stages (CoC-shape #4, LT-shape #6). One call
 *       per player turn:
 *
 *         1. `scope(actorId)` — build the addressable set from the world
 *            (exits + co-located entities) plus any carried items via
 *            inventory hook.
 *         2. `parseIntent(text, scope)` — deterministic grammar, optional
 *            LLM fallback.
 *         3. Caller's `applyIntent(intent)` — stage mutates its own state.
 *         4. `logEvents(events)` — push WorldEvents from `world.move` etc.
 *            onto the timeline.
 *         5. `procgen` helpers — `buildGraph`, `instantiate`, `weightedPick`
 *            exposed for room / encounter generation.
 *
 *       The bundle exposes the raw primitives so the stage author can call
 *       `world.move`, `world.locate`, `actor.pool.byLocation`, etc. without
 *       going through the pattern. The pattern is wiring, not a gate.
 *
 * WHY: CoC-shape (#4) and LT-shape (#6) both need: a traversable world graph,
 *      an actor in that world, a scope-fed intent parser, procgen for infinite
 *      content. `sandboxPattern` collapses the boilerplate of wiring those four
 *      primitives so the stage author writes the mechanics, not the plumbing.
 *
 *      Enables CoC-shape (#4), LT-shape (#6).
 *
 * SHAPE:
 *   interface SandboxInit<S>
 *     { world; actorPool; rng; parseOptions?; scopeOpts?;
 *       timeline?: Timeline<WorldEvent> }
 *   interface SandboxBundle<S>
 *     { world; actorPool; rng; timeline;
 *       scope(actorId): Set<string>;
 *       parseIntent(text, actorId): Promise<Intent | null>;
 *       logEvents(events: WorldEvent[]): void; }
 *   function sandboxPattern<S>(init): SandboxBundle<S>
 */

import { type ActorPool } from "../actor";
import { parseIntent, type Intent, type ParseIntentOptions } from "../intent";
import { type RngStream } from "../rng";
import { Timeline } from "../timeline";
import { type World, type WorldEvent, type ScopeOptions } from "../world";

export interface SandboxInit {
  world: World;
  actorPool: ActorPool;
  rng: RngStream;
  /** Forwarded to `parseIntent`. Includes synonym table + LLM fallback. */
  parseOptions?: ParseIntentOptions;
  /** Options forwarded to `world.scope`. E.g. `includeCarried` for inventory. */
  scopeOpts?: ScopeOptions;
  /** Bring-your-own timeline. Created if absent. */
  timeline?: Timeline<WorldEvent>;
}

export interface SandboxBundle {
  world: World;
  actorPool: ActorPool;
  rng: RngStream;
  timeline: Timeline<WorldEvent>;
  /** Build the scope set for `actorId` — exits + co-located entity ids. */
  scope(actorId: string): Set<string>;
  /**
   * Parse a freeform player command against the actor's current scope.
   * Returns null on grammar miss without LLM fallback configured.
   */
  parseIntent(text: string, actorId: string): Promise<Intent | null>;
  /** Push WorldEvents from `world.move` / `world.locate` etc. to the timeline. */
  logEvents(events: WorldEvent[]): void;
}

export function sandboxPattern(init: SandboxInit): SandboxBundle {
  const timeline = init.timeline ?? new Timeline<WorldEvent>({ windowSize: 64 });

  const scope = (actorId: string): Set<string> =>
    init.world.scope(actorId, init.scopeOpts);

  const parseIntentFn = (text: string, actorId: string): Promise<Intent | null> =>
    parseIntent(text, scope(actorId), init.parseOptions);

  const logEvents = (events: WorldEvent[]): void => {
    const now = Date.now();
    for (const ev of events) timeline.push(ev, now);
  };

  return {
    world: init.world,
    actorPool: init.actorPool,
    rng: init.rng,
    timeline,
    scope,
    parseIntent: parseIntentFn,
    logEvents,
  };
}
