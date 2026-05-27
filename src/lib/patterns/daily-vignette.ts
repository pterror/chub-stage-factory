/*
 * patterns/daily-vignette.ts — one well-grounded vignette per game-day tick
 *                               with continuity from past vignettes.
 *
 * WHAT: `dailyVignettePattern(init)` is the slice-of-life equivalent of
 *       bulkTickPattern: where bulkTick advances *many actors in parallel*,
 *       daily-vignette advances *one subject deeply through time*.
 *
 *   Each call to `tick(subject, now)`:
 *     1. Assembles observations from `sources` (body state, effects, stats,
 *        recent timeline events — whatever the stage registered).
 *     2. Builds a grounding prompt from the formatted observations + a window
 *        of recent past vignettes for continuity.
 *     3. Calls `generate()` to produce the vignette prose.
 *     4. Pushes a `VignetteEvent` (prose + snapshot of key observations) onto
 *        the timeline for continuity on the next tick.
 *     5. Returns the prose string.
 *
 * WHY: Pregnancy-sim (#17): "every daily vignette procgen-grounded and
 *      LLM-rendered." Subject-life-sim (#19): daily vignette is the content
 *      unit for "The Sims with explicit content." The meta-category note in
 *      ROADMAP §68 names this pattern explicitly as the load-bearing composer
 *      for all slice-of-life-texture shapes.
 *
 * SHAPE:
 *   interface VignetteEvent { prose: string; dayStamp: number;
 *                              observations: string; }
 *   interface DailyVignetteInit<S> { sources; timeline; generator;
 *     vignettePrompt; continuityWindow?; maxTokens?; assembleState: () => S; }
 *   interface DailyVignetteBundle<S, E> { tick(subject, now): Promise<string>;
 *     timeline: Timeline<VignetteEvent>; }
 *   function dailyVignettePattern<S>(init): DailyVignetteBundle<S>
 */

import type { GenerationService } from "@chub-ai/stages-ts";
import type { Actor } from "../actor";
import { generate } from "../generate";
import { Timeline } from "../timeline";
import { assembleObservations, formatObservations } from "../observation";
import type { ObservationSource, AssembleOptions } from "../observation";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single daily vignette stored on the timeline for continuity. */
export interface VignetteEvent {
  /** The rendered prose for this day. */
  prose: string;
  /** Game-time stamp for this day tick (caller's time unit). */
  dayStamp: number;
  /** Formatted observations snapshot assembled at tick time. */
  observations: string;
}

export interface DailyVignetteInit<S> {
  /**
   * ObservationSources to assemble before generating the vignette.
   * Typically: Timeline<BodyEvent>, EffectStore, Stats, procgen snapshots.
   * The stage registers these; the pattern calls assembleObservations.
   */
  sources: readonly ObservationSource<S>[];
  /**
   * The vignette timeline. New VignetteEvents are pushed here each tick.
   * The pattern reads recent events for continuity context.
   */
  timeline: Timeline<VignetteEvent>;
  /** GenerationService for the vignette prose call. */
  generator: GenerationService;
  /**
   * Build the full vignette prompt. Receives:
   *   - `subject`: the focal Actor for this vignette day.
   *   - `observations`: formatted JSON block from assembleObservations.
   *   - `recentVignettes`: prose strings from the last `continuityWindow` days.
   *   - `now`: game-time timestamp.
   * Return a complete prompt string for the LLM.
   */
  vignettePrompt: (
    subject: Actor,
    observations: string,
    recentVignettes: string[],
    now: number,
  ) => string;
  /**
   * How many past vignette prose strings to include as continuity context.
   * Default: 3. Set to 0 to disable continuity.
   */
  continuityWindow?: number;
  /**
   * Max tokens for the vignette prose call. Default: 500.
   * Rich daily vignettes may need 600–800.
   */
  maxTokens?: number;
  /**
   * Return the current stage state for assembleObservations. Called once per
   * tick immediately before observation assembly.
   */
  assembleState: () => S;
  /**
   * Options forwarded to assembleObservations (maxCount, lastEmittedAt).
   * If omitted, assembles all sources with no habituation tracking.
   */
  assembleOptions?: Omit<AssembleOptions, "now">;
}

export interface DailyVignetteBundle {
  /**
   * Advance one game day for `subject`. Returns the generated vignette prose.
   * Pushes a VignetteEvent to the timeline for continuity on subsequent ticks.
   */
  tick(subject: Actor, now: number): Promise<string>;
  /** Direct access to the vignette timeline. */
  readonly timeline: Timeline<VignetteEvent>;
}

// ─── Implementation ───────────────────────────────────────────────────────────

export function dailyVignettePattern<S>(init: DailyVignetteInit<S>): DailyVignetteBundle {
  const continuityWindow = init.continuityWindow ?? 3;

  return {
    async tick(subject: Actor, now: number): Promise<string> {
      // 1. Assemble observations.
      const state = init.assembleState();
      const assembled = assembleObservations(init.sources, state, {
        now,
        ...(init.assembleOptions ?? {}),
      });
      const observations = formatObservations(assembled);

      // 2. Collect recent vignette prose for continuity.
      const recentVignettes = init.timeline
        .window(continuityWindow)
        .map((ev) => ev.payload.prose);

      // 3. Generate.
      const prompt = init.vignettePrompt(subject, observations, recentVignettes, now);
      const prose = await generate<string>({
        prompt,
        generator: init.generator,
        maxTokens: init.maxTokens ?? 500,
      });

      // 4. Push event to timeline for continuity.
      init.timeline.push({ prose, dayStamp: now, observations }, now);

      return prose;
    },

    get timeline(): Timeline<VignetteEvent> {
      return init.timeline;
    },
  };
}
