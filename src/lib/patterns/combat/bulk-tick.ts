/*
 * patterns/bulk-tick.ts — Weekly tick: ActorPool.forEach → collect events →
 *                          push Timeline → render report.
 *                          Enables FC-shape (#8), FS-shape (#7).
 *
 * WHAT: `bulkTickPattern(init)` wires the managerial tick loop that FC/FS
 *       shapes require:
 *
 *         1. `tick(now?)` — calls `ActorPool.forEach`, passes each actor to
 *            the stage-author's `processActor` callback which returns zero or
 *            more typed events. Collects all events, pushes them to `Timeline`,
 *            and returns the full list.
 *         2. `report(events, render)` — projects the event list into a
 *            human-readable string (one line per event via the caller-supplied
 *            `render` function), returned as the weekly management report.
 *         3. `tickAndReport(render, now?)` — convenience: calls `tick` then
 *            `report` in one call.
 *
 *       Composes: `ActorPool` + `Timeline`.
 *
 * WHY: ROADMAP Wave 2C: "weekly tick = advance all actors via
 *      `ActorPool.forEach`, collect events, push to `Timeline`, render
 *      report. No new primitives." FC-shape needs to run 100+ actors per
 *      tick and surface a summary report; FS-shape needs to advance
 *      infection/mutation state across a survivor pool. This pattern wires
 *      the invariant part — the forEach + collect + push + render loop —
 *      leaving all domain logic in the stage-author's `processActor`.
 *
 * SHAPE:
 *   type TickEventProcessor<E> = (actor: Actor, now: number) => E[]
 *   interface BulkTickBundleInit<E>
 *     { pool: ActorPool; processActor: TickEventProcessor<E>;
 *       timeline?: Timeline<E> }
 *   interface BulkTickBundle<E>
 *     { pool; timeline;
 *       tick(now?): E[];
 *       report(events, render): string;
 *       tickAndReport(render, now?): { events, report } }
 *   function bulkTickPattern<E>(init): BulkTickBundle<E>
 */

import { type Actor, ActorPool } from "../actor";
import { Timeline } from "../timeline";

export type TickEventProcessor<E> = (actor: Actor, now: number) => E[];

export interface BulkTickBundleInit<E> {
  pool: ActorPool;
  /**
   * Called once per actor per tick. Returns the events produced for that
   * actor this tick. Stage author mutates actor state here (stats, location,
   * owner, tags) and returns the events describing what happened.
   */
  processActor: TickEventProcessor<E>;
  /** Bring-your-own Timeline. Created if omitted. */
  timeline?: Timeline<E>;
}

export interface BulkTickBundle<E> {
  pool: ActorPool;
  timeline: Timeline<E>;
  /**
   * Advance all actors. Calls `processActor` on each, collects events,
   * pushes them to the Timeline. `now` defaults to `Date.now()`.
   */
  tick(now?: number): E[];
  /**
   * Render a flat text report from a list of events. One entry per event
   * via the caller-supplied `render` function, joined by newlines.
   */
  report(events: readonly E[], render: (event: E) => string): string;
  /**
   * Convenience: tick + report in one call.
   */
  tickAndReport(
    render: (event: E) => string,
    now?: number,
  ): { events: E[]; report: string };
}

export function bulkTickPattern<E>(init: BulkTickBundleInit<E>): BulkTickBundle<E> {
  const timeline = init.timeline ?? new Timeline<E>({ id: "bulk-tick", windowSize: 50 });

  return {
    pool: init.pool,
    timeline,
    tick(now?: number): E[] {
      const ts = now ?? Date.now();
      const collected: E[] = [];
      init.pool.forEach((actor) => {
        const events = init.processActor(actor, ts);
        for (const evt of events) {
          collected.push(evt);
          timeline.push(evt, ts);
        }
      });
      return collected;
    },
    report(events: readonly E[], render: (event: E) => string): string {
      if (events.length === 0) return "(no events this tick)";
      return events.map(render).join("\n");
    },
    tickAndReport(
      render: (event: E) => string,
      now?: number,
    ): { events: E[]; report: string } {
      const events = this.tick(now);
      return { events, report: this.report(events, render) };
    },
  };
}
