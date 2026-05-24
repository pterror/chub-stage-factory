/*
 * recency-frequency-eviction.ts — AID Story Cards prioritization
 * composer. Each entry gets a dynamic priority score computed from
 * `recency` (how long since it last fired) + `frequency` (how often
 * it has fired). Drives ContextAssembler.drop-on-overflow indirectly
 * by varying each contributor's priority per turn.
 *
 * Composes: ContextAssembler (already drops on overflow) + per-entry
 * `{ lastFiredAt, fireCount }` stats + a custom priority function.
 *
 * Source: AID Story Cards prioritization.
 */

import type { ContextContributor } from "../../context";
import { estimateTokens } from "../../context";
import type { ComposedSubsystem } from "./types";

export interface EvictionEntry {
  id: string;
  content: string;
  matches: (scan: string) => boolean;
  /** Static base priority before recency/freq adjustments. Default 40. */
  basePriority?: number;
}

export interface EvictionWeights {
  recency: number;
  freq: number;
}

export interface RecencyFrequencyEvictionOptions {
  entries: EvictionEntry[];
  weights?: EvictionWeights;
  scanTextOf?: (state: unknown) => string;
}

export interface EvictionStats {
  stats: Map<string, { at: number; n: number }>;
}

export function recencyFrequencyEvictionPattern(
  opts: RecencyFrequencyEvictionOptions,
): ComposedSubsystem<EvictionStats> {
  const weights = opts.weights ?? { recency: 0.7, freq: 0.3 };
  const scanTextOf =
    opts.scanTextOf ??
    ((s) => (s && typeof (s as { scanText?: string }).scanText === "string"
      ? (s as { scanText: string }).scanText
      : ""));
  const state: EvictionStats = { stats: new Map() };

  function score(id: string, now: number, base: number): number {
    const s = state.stats.get(id);
    if (!s) return base;
    const recency = Math.max(0, 1 - (now - s.at) / 1000); // normalise by sec
    return base + weights.recency * recency * 100 + weights.freq * s.n;
  }

  const contributors: ContextContributor[] = opts.entries.map((e) => ({
    id: e.id,
    get priority() {
      return score(e.id, Date.now(), e.basePriority ?? 40);
    },
    contribute(ctx) {
      const scan = scanTextOf(ctx.stage);
      if (!e.matches(scan)) return null;
      const now = Date.now();
      const cur = state.stats.get(e.id) ?? { at: 0, n: 0 };
      state.stats.set(e.id, { at: now, n: cur.n + 1 });
      return {
        id: e.id,
        content: e.content,
        tokens: estimateTokens(e.content),
        optional: true,
      };
    },
  } as ContextContributor));

  return { state, contributors, shards: [{ id: "rfe-stats", value: state }] };
}
