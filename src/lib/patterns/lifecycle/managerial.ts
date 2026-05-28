/*
 * patterns/managerial.ts — player-issues-policy + report-rendering loop
 *                           (Wave 2C). Enables FC-shape (#8).
 *
 * WHAT: `managerialPattern(init)` wires:
 *   1. A policy-issue surface: `applyPolicy(fields)` mutates stage state from
 *      a typed policy form (structured player input — FC's "arcology directives",
 *      FS's "colony orders", etc.).
 *   2. A report-rendering surface: `renderReport(events, now)` projects the
 *      tick window's Timeline events into a prose report via `Timeline.summarize`
 *      and hands it to a generator call for narrative rendering.
 *   3. `tick(pool, now)` — delegates to the caller-provided bulk-tick function
 *      and captures the resulting events for the next `renderReport` call.
 *
 *      `bulk-tick.ts` (sibling Wave 2C) is the actor-advance loop. Managerial
 *      composes over it: the stage calls `tick` to advance actors, then
 *      `renderReport` to produce the weekly narrative summary.
 *
 * COORDINATE WITH PARALLEL AGENT: This file assumes `bulkTick` has the shape:
 *   `(pool: ActorPool, now: number, advance: (a: Actor) => Event[]) => Event[]`
 *   If that assumption is wrong, only the `tick` wrapper needs updating.
 *
 * WHY: FC-shape (#8) — "every arcology has unique slaves, unique events, unique
 *      trade arcs." The managerial loop is the weekly cycle: player sets policy,
 *      actors advance in bulk, events accumulate, report renders. No new
 *      primitives; pure wiring.
 *
 * SHAPE:
 *   interface ManagerialInit<P, E> { timeline; generator; reportPrompt;
 *     applyPolicy: (fields: P) => void;
 *     advance: (actor: Actor) => E[];
 *     renderEvent?: (e: E, at: number) => string; }
 *   interface ManagerialBundle<P, E> { applyPolicy(fields): void;
 *     tick(pool, now): E[]; renderReport(events, now): Promise<string>;
 *     lastTickEvents: E[]; timeline: Timeline<E>; }
 *   function managerialPattern<P, E>(init): ManagerialBundle<P, E>
 */

import type { GenerationService } from "@chub-ai/stages-ts";
import type { Actor, ActorPool } from "../../actor";
import { generate } from "../../generate";
import { Timeline, summarize } from "../../timeline";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ManagerialInit<P, E> {
  /** Timeline to push tick events into and summarize from. */
  timeline: Timeline<E>;
  /** GenerationService for the report prose call. */
  generator: GenerationService;
  /**
   * Build the LLM prompt for a report. Receives the rendered event summary
   * string and the current game-time timestamp. Should return a complete
   * prompt string (system + user combined, or just user if stage uses PARC).
   */
  reportPrompt: (summary: string, now: number) => string;
  /**
   * Apply a typed policy form to stage state. Called when the player issues
   * directives. The stage author mutates their own state object here.
   * `P` is the policy shape (e.g. `{ foodRation: "reduced"; workerShift: "extended" }`).
   */
  applyPolicy: (fields: P) => void;
  /**
   * Per-actor advance function. Called by `tick` over all actors in the pool.
   * Return the events produced for this actor during the tick.
   */
  advance: (actor: Actor) => E[];
  /**
   * Project an event into a summary line for `Timeline.summarize`.
   * Default: `JSON.stringify(e)`.
   */
  renderEvent?: (e: E, at: number) => string;
  /**
   * Max tokens for the report prose call. Default: 600.
   * FC reports are dense; standard 500-token default is too tight.
   */
  reportMaxTokens?: number;
}

export interface ManagerialBundle<P, E> {
  /** Issue a policy directive; delegates to init.applyPolicy. */
  applyPolicy(fields: P): void;
  /**
   * Advance all actors in `pool`, push resulting events to the timeline.
   * Returns the flat list of events from this tick.
   */
  tick(pool: ActorPool, now: number): E[];
  /**
   * Render a prose report over `events` (typically the result of the last
   * `tick` call). Returns the generated prose string.
   */
  renderReport(events: readonly E[], now: number): Promise<string>;
  /** Events from the most recent `tick` call. Empty until first tick. */
  readonly lastTickEvents: E[];
  /** Direct access to the underlying Timeline. */
  readonly timeline: Timeline<E>;
}

// ─── Implementation ───────────────────────────────────────────────────────────

export function managerialPattern<P, E>(init: ManagerialInit<P, E>): ManagerialBundle<P, E> {
  const renderEvent = init.renderEvent ?? ((e: E, at: number) => `${at}: ${JSON.stringify(e)}`);
  let lastTickEvents: E[] = [];

  return {
    applyPolicy(fields: P): void {
      init.applyPolicy(fields);
    },

    tick(pool: ActorPool, now: number): E[] {
      const events: E[] = [];
      pool.forEach((actor) => {
        const actorEvents = init.advance(actor);
        for (const e of actorEvents) {
          events.push(e);
          init.timeline.push(e, now);
        }
      });
      lastTickEvents = events;
      return events;
    },

    async renderReport(events: readonly E[], now: number): Promise<string> {
      const timelineEvents = events.map((payload) => ({ at: now, payload }));
      const summary = summarize(timelineEvents, renderEvent);
      const prompt = init.reportPrompt(summary, now);
      return generate<string>({
        prompt,
        generator: init.generator,
        maxTokens: init.reportMaxTokens ?? 600,
      });
    },

    get lastTickEvents(): E[] {
      return lastTickEvents;
    },

    get timeline(): Timeline<E> {
      return init.timeline;
    },
  };
}
