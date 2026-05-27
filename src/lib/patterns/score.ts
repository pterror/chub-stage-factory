/*
 * patterns/score.ts — Stats + Timeline with tier-based unlock conditions.
 *                     Enables Zork-shape (#2).
 *
 * WHAT: `scorePattern(init)` bundles a named `Stat` (the score counter) with
 *       a `Timeline` for score events and a list of `ScoreUnlock` entries —
 *       tier-keyed rewards that become available when the score crosses a
 *       threshold. `award(delta, reason?, now?)` increments the score and
 *       records an event. `tier()` delegates to `Stat.tier()`. `check()` walks
 *       unlocks and returns any whose tier threshold is newly crossed.
 *
 *       Composes: `Stat` + `thresholdTiers` + `Timeline`.
 *
 * WHY: Zork-shape needs a Zork-style score (integer points) whose value gates
 *      rank labels and content unlocks. `Stat` already handles the numeric +
 *      tier logic; this pattern adds the "award points and surface unlocks"
 *      vocabulary and records events to Timeline so score history is visible.
 *
 * SHAPE:
 *   interface ScoreEvent { delta; total; reason? }
 *   interface ScoreUnlock<T> { id; tier: string; payload: T }
 *   interface ScoreBundleInit<T>
 *     { base?; tiers: { below, label }[]; fallbackTier;
 *       unlocks?: ScoreUnlock<T>[]; timeline? }
 *   interface ScoreBundle<T>
 *     { stat; timeline; unlocks;
 *       award(delta, reason?, now?): ScoreEvent;
 *       value(): number; tier(): string | null;
 *       check(): ScoreUnlock<T>[] }
 *   function scorePattern<T>(init): ScoreBundle<T>
 */

import { Stat, thresholdTiers } from "../stats";
import { Timeline } from "../timeline";

export interface ScoreEvent {
  delta: number;
  total: number;
  reason?: string;
}

export interface ScoreUnlock<T = unknown> {
  id: string;
  /** Tier label that must be active for this unlock to become available. */
  tier: string;
  payload: T;
}

export interface ScoreBundleInit<T = unknown> {
  /** Starting score value. Default 0. */
  base?: number;
  /** Threshold bands for Stat.thresholdTiers. */
  tiers: { below: number; label: string }[];
  /** Label returned when no band matches (i.e. score ≥ highest threshold). */
  fallbackTier: string;
  /** Content unlocked at specific tier labels. */
  unlocks?: ScoreUnlock<T>[];
  /** Bring-your-own Timeline. Created if omitted. */
  timeline?: Timeline<ScoreEvent>;
}

export interface ScoreBundle<T = unknown> {
  stat: Stat<string>;
  timeline: Timeline<ScoreEvent>;
  unlocks: ScoreUnlock<T>[];
  /** Add `delta` points. Records a ScoreEvent on the timeline. */
  award(delta: number, reason?: string, now?: number): ScoreEvent;
  /** Current effective score. */
  value(): number;
  /** Current tier label (null when no TierFn configured, which won't happen here). */
  tier(): string | null;
  /**
   * Returns unlocks whose tier matches the current tier and that have not yet
   * been triggered. Does NOT mark them consumed — the stage decides when to
   * consume. Filter against `deliveredUnlockIds` yourself after consuming.
   */
  check(): ScoreUnlock<T>[];
}

export function scorePattern<T = unknown>(init: ScoreBundleInit<T>): ScoreBundle<T> {
  const tierFn = thresholdTiers(init.tiers, init.fallbackTier);
  const stat = new Stat<string>({ base: init.base ?? 0, tiers: tierFn });
  const timeline = init.timeline ?? new Timeline<ScoreEvent>({ id: "score", windowSize: 20 });
  const unlocks: ScoreUnlock<T>[] = init.unlocks ?? [];

  return {
    stat,
    timeline,
    unlocks,
    award(delta: number, reason?: string, now?: number): ScoreEvent {
      stat.base += delta;
      const evt: ScoreEvent = { delta, total: stat.base, reason };
      timeline.push(evt, now);
      return evt;
    },
    value(): number {
      return stat.effective();
    },
    tier(): string | null {
      return stat.tier();
    },
    check(): ScoreUnlock<T>[] {
      const currentTier = stat.tier();
      return unlocks.filter((u) => u.tier === currentTier);
    },
  };
}
