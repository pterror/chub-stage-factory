/*
 * patterns/subject-sandbox.ts — first-person life-sim composer.
 *
 * WHAT: `subjectSandboxPattern(init)` wires the subject-life-sim axis
 *       (Shape #19: "Imagine The Sims with explicit content, but infinite"):
 *
 *         - `world` tracks multi-location life (home, work, town, etc.)
 *         - `actorPool` holds NPCs the subject interacts with
 *         - `triggerSet` fires conditional events (pregnancy, NPC behavior,
 *           relationship shifts) evaluated each advance
 *         - `dailyVignette` generates one prose vignette per game-day
 *         - `timeline` is shared — world events + trigger-fired events +
 *           vignette events all accumulate here
 *
 *       Each call to `advance(subject, now)`:
 *         1. Evaluates `triggerSet` against the caller-supplied state +
 *            refs bundle; returns fired effects.
 *         2. Calls `dailyVignette.tick(subject, now)` and returns the prose.
 *         3. Pushes WorldEvents from any subject move in the same tick.
 *
 *       The bundle exposes the raw primitives so the stage author can call
 *       `world.move(subject.id, dir)`, `actorPool.byLocation(roomId)`, etc.
 *       without going through the pattern.
 *
 * WHY: Subject-life-sim (#19) requires: traversable world, NPC pool, timeline-
 *      based scheduling (scheduler.ts was removed; ConditionalTrigger + timeline
 *      cover the same ground), daily vignette prose. This composer collapses
 *      that wiring. The `dailyVignette` sub-pattern is imported from
 *      `./daily-vignette` and assumed to match the shape shipped in batch 2b.
 *
 *      Enables Subject-life-sim-shape (#19).
 *
 * SHAPE:
 *   interface SubjectSandboxInit<S>
 *     { world; actorPool; triggerSet; dailyVignette; timeline?;
 *       resolvers?; scopeOpts? }
 *   interface SubjectSandboxBundle<S>
 *     { world; actorPool; triggerSet; dailyVignette; timeline;
 *       scope(subjectId): Set<string>;
 *       advance(subject, state, refs, rng, now): Promise<{ prose; effects }>;
 *       logEvents(events: WorldEvent[]): void; }
 *   function subjectSandboxPattern<S>(init): SubjectSandboxBundle<S>
 */

import { type Actor, type ActorPool } from "../actor";
import { type Refs, type Resolvers } from "../predicate";
import { type RngStream } from "../rng";
import { Timeline } from "../timeline";
import { type World, type WorldEvent, type ScopeOptions } from "../world";
import { type TriggerSet } from "../trigger";
import { type DailyVignetteBundle } from "./daily-vignette";

export interface SubjectSandboxInit<S> {
  world: World;
  actorPool: ActorPool;
  /** Trigger set for conditional probabilistic events (pregnancy, NPC actions, etc.). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  triggerSet: TriggerSet<S, any>;
  /**
   * Daily vignette bundle (from `dailyVignettePattern`). Called once per
   * game-day advance to generate prose grounded in current observations.
   */
  dailyVignette: DailyVignetteBundle;
  /** Shared timeline; created if absent. All events flow here. */
  timeline?: Timeline<WorldEvent>;
  /** Options forwarded to `world.scope`. */
  scopeOpts?: ScopeOptions;
  /** Stage resolvers merged into trigger evaluation. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolvers?: Resolvers<S, any>;
}

export interface SubjectSandboxAdvanceResult<E> {
  /** Vignette prose from dailyVignettePattern for this day. */
  prose: string;
  /** Effects fired by the trigger set this tick. */
  effects: E[];
}

export interface SubjectSandboxBundle<S, E = unknown> {
  world: World;
  actorPool: ActorPool;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  triggerSet: TriggerSet<S, any>;
  dailyVignette: DailyVignetteBundle;
  timeline: Timeline<WorldEvent>;
  /** Scope set for the subject — exits + co-located NPC ids + carried items. */
  scope(subjectId: string): Set<string>;
  /**
   * Advance one game day:
   *   1. Evaluate triggers → collect fired effects.
   *   2. Generate daily vignette prose.
   * The caller is responsible for applying effects and any `world.move` calls.
   */
  advance(
    subject: Actor,
    state: S,
    refs: Refs<string>,
    rng: RngStream,
    now: number,
  ): Promise<SubjectSandboxAdvanceResult<E>>;
  /** Push WorldEvents from `world.move` / `world.locate` to the timeline. */
  logEvents(events: WorldEvent[]): void;
}

export function subjectSandboxPattern<S, E = unknown>(
  init: SubjectSandboxInit<S>,
): SubjectSandboxBundle<S, E> {
  const timeline = init.timeline ?? new Timeline<WorldEvent>({ windowSize: 128 });

  const scope = (subjectId: string): Set<string> =>
    init.world.scope(subjectId, init.scopeOpts);

  const advance = async (
    subject: Actor,
    state: S,
    refs: Refs<string>,
    rng: RngStream,
    now: number,
  ): Promise<SubjectSandboxAdvanceResult<E>> => {
    // 1. Evaluate conditional triggers.
    const effects = init.triggerSet.evaluate(state, refs, rng, now) as E[];

    // 2. Generate daily vignette prose.
    const prose = await init.dailyVignette.tick(subject, now);

    return { prose, effects };
  };

  const logEvents = (events: WorldEvent[]): void => {
    const now = Date.now();
    for (const ev of events) timeline.push(ev, now);
  };

  return {
    world: init.world,
    actorPool: init.actorPool,
    triggerSet: init.triggerSet,
    dailyVignette: init.dailyVignette,
    timeline,
    scope,
    advance,
    logEvents,
  };
}
