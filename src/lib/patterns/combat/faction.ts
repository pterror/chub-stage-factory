/*
 * patterns/faction.ts — Reputation as Stat-with-tier + content-gate predicate.
 *                        Enables LT-shape (#6).
 *
 * WHAT: `factionPattern(init)` builds a bundle containing one `Stat` per
 *       faction (the reputation score) and a helper `gate(factionId, tier,
 *       state, refs, resolvers?)` that constructs and evaluates a
 *       `stat-tier` predicate against the player's standing. `adjust(id,
 *       delta)` mutates the reputation stat and returns the new effective
 *       value. `tierOf(id)` returns the label for current standing.
 *
 *       Composes: `Stat` + `thresholdTiers` + `Predicate` evaluate.
 *
 * WHY: LT-shape needs per-faction reputation scores that gate dialogue,
 *      content, and encounter triggers. ROADMAP §"Decision audit" explicitly
 *      rules out a `Faction` primitive: "reduces to Stat-with-tier +
 *      predicate + actor field (representative NPC). Ships as
 *      `patterns/faction.ts` composer." This file is that composer.
 *
 *      The content gate is a `stat-tier` predicate on the faction-keyed stat.
 *      The stage author wires the resolvers once; then `gate()` produces a
 *      ready-to-evaluate predicate without boilerplate.
 *
 * SHAPE:
 *   interface FactionDef
 *     { id; name; tiers: { below, label }[]; fallbackTier; base? }
 *   interface FactionBundleInit
 *     { factions: FactionDef[] }
 *   interface FactionBundle
 *     { stats: Map<string, Stat>;
 *       adjust(id, delta): number;
 *       tierOf(id): string | null;
 *       gate(id, tier, state, refs, resolvers?): boolean }
 *   function factionPattern<S, A>(init): FactionBundle<S, A>
 */

import { Stat, thresholdTiers } from "../stats";
import { evaluate } from "../predicate";

export interface FactionDef {
  id: string;
  name: string;
  /** Threshold bands, ascending `below` values. */
  tiers: { below: number; label: string }[];
  /** Label when score ≥ highest threshold. */
  fallbackTier: string;
  /** Starting reputation. Default 0. */
  base?: number;
}

export interface FactionBundleInit {
  factions: FactionDef[];
}

export interface FactionBundle {
  /** Per-faction Stat instances, keyed by faction id. */
  stats: Map<string, Stat<string>>;
  /**
   * Add `delta` to faction's reputation score. Returns new effective value.
   * Throws if the faction id is unknown.
   */
  adjust(id: string, delta: number): number;
  /** Current tier label for the faction, or null if unconfigured. */
  tierOf(id: string): string | null;
  /**
   * Returns true when the player's standing with `factionId` is currently
   * at `tier`. Evaluates via a `stat-tier` predicate so it composes with
   * any stage-author resolver that reads `getStat` off an actor target —
   * but as a shortcut, we read directly from the bundled Stat here so the
   * stage doesn't need to supply resolvers for basic reputation gates.
   */
  gate(factionId: string, tier: string): boolean;
}

export function factionPattern(
  init: FactionBundleInit,
): FactionBundle {
  const stats = new Map<string, Stat<string>>();
  for (const def of init.factions) {
    stats.set(
      def.id,
      new Stat<string>({
        base: def.base ?? 0,
        tiers: thresholdTiers(def.tiers, def.fallbackTier),
      }),
    );
  }

  return {
    stats,
    adjust(id: string, delta: number): number {
      const s = stats.get(id);
      if (!s) throw new Error(`factionPattern: unknown faction "${id}"`);
      s.base += delta;
      return s.effective();
    },
    tierOf(id: string): string | null {
      return stats.get(id)?.tier() ?? null;
    },
    gate(factionId: string, tier: string): boolean {
      // Direct read — no resolver overhead for the common case.
      return stats.get(factionId)?.tier() === tier;
    },
  };
}

/**
 * Build a `stat-tier` predicate for use with the standard Predicate DSL.
 * Use when you need to compose the gate into a `TriggerSet.when` or a
 * compound `and`/`or` predicate rather than calling `bundle.gate()` directly.
 *
 * The `target` is the ActorRef whose `getStat` resolver must resolve
 * `statKey` to the faction reputation numeric value.
 */
export function factionGatePredicate(
  statKey: string,
  tier: string,
) {
  return { kind: "stat-tier" as const, target: "player" as const, stat: statKey, tier };
}

// Re-export evaluate so callers can compose faction predicates inline.
export { evaluate };
