/*
 * patterns/lifecycle/focus.ts — attention director: surfaces the most salient
 *                               events / actors / locations right now.
 *
 * WHAT: `focusPattern(init)` ranks a set of `ObservationSource`s by their
 *       habituated salience score and returns the top-N as `FocusItem`s —
 *       structured pointers to "the interesting thing right now." Intended
 *       for high-action-density managerial stages where many things compete
 *       for player attention simultaneously.
 *
 *         1. `rank(state, now)` — runs `assembleObservations`, applies
 *            habituation, returns items sorted high→low. Writes
 *            `lastEmittedAt` so habituation carries across calls.
 *         2. `top(state, now, n?)` — convenience alias for `rank` sliced to
 *            `n` items (default: `init.maxFocus`).
 *         3. `asContributor()` — returns a `ContextContributor` that renders
 *            the current top-N focus items as a `<focus>` XML block. Register
 *            with a `ContextAssembler`; the contributor calls `rank` each
 *            time `contribute` is invoked.
 *
 * WHY: Facility-management-shape (#20), RTS-shape (#15), FC-shape (#8), and
 *      every other high-action-density managerial stage need a uniform answer
 *      to "what should the player look at right now?" The observation system
 *      already scores and habituates sources; `focusPattern` is the thin
 *      director layer that turns that into actionable focus pointers without
 *      prescribing how the stage renders or surfaces them.
 *
 *      Placed in `lifecycle/` because it is a cross-cutting attention director
 *      that wires across world, character, and combat observation sources —
 *      it belongs to the turn lifecycle, not to any single mechanic bucket.
 *
 * SHAPE:
 *   interface FocusItem { id; channels; salience; values }
 *   interface FocusInit<S>
 *     { sources: ObservationSource<S>[]; maxFocus?; priority?; id? }
 *   interface FocusBundle<S>
 *     { rank(state, now): FocusItem[];
 *       top(state, now, n?): FocusItem[];
 *       asContributor(getState: () => S, getNow: () => number): ContextContributor; }
 *   function focusPattern<S>(init): FocusBundle<S>
 */

import {
  assembleObservations,
  formatObservations,
  type AssembledObservation,
  type ObservationSource,
} from "../../observation";
import type { ContextContributor } from "../../context";
import { estimateTokens } from "../../context";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A ranked attention item — same shape as `AssembledObservation`. */
export type FocusItem = AssembledObservation;

export interface FocusInit<S> {
  /** The observation sources competing for player attention. */
  sources: ObservationSource<S>[];
  /**
   * Maximum focus items returned by `top()` and rendered by the contributor.
   * Default: 3.
   */
  maxFocus?: number;
  /** `ContextContributor` priority. Default: 70 (high — focus is near-essential). */
  priority?: number;
  /** `ContextContributor` id. Default: "focus". */
  id?: string;
}

export interface FocusBundle<S> {
  /**
   * Rank all sources by habituated salience against `state` at `now`.
   * Updates the internal `lastEmittedAt` map so habituation carries forward.
   */
  rank(state: S, now: number): FocusItem[];
  /**
   * Return the top `n` focus items (default: `init.maxFocus`).
   * Delegates to `rank`.
   */
  top(state: S, now: number, n?: number): FocusItem[];
  /**
   * Return a `ContextContributor` that renders the current top-N focus items
   * as a `<focus>` XML block on each `contribute` call.
   *
   * @param getState — called each turn to get the current stage state.
   * @param getNow   — called each turn to get the current game timestamp.
   */
  asContributor(getState: () => S, getNow: () => number): ContextContributor;
}

// ─── Implementation ───────────────────────────────────────────────────────────

export function focusPattern<S>(init: FocusInit<S>): FocusBundle<S> {
  const maxFocus = init.maxFocus ?? 3;
  const lastEmittedAt = new Map<string, number>();

  function rank(state: S, now: number): FocusItem[] {
    return assembleObservations(init.sources, state, {
      now,
      lastEmittedAt,
    });
  }

  function top(state: S, now: number, n: number = maxFocus): FocusItem[] {
    return rank(state, now).slice(0, n);
  }

  function asContributor(getState: () => S, getNow: () => number): ContextContributor {
    const id = init.id ?? "focus";
    const priority = init.priority ?? 70;
    return {
      id,
      priority,
      contribute() {
        const items = top(getState(), getNow());
        if (items.length === 0) return null;
        const body = formatObservations(items);
        const content = `<focus>\n${body}\n</focus>`;
        return {
          id,
          content,
          tokens: estimateTokens(content),
          optional: true,
        };
      },
    };
  }

  return { rank, top, asContributor };
}
