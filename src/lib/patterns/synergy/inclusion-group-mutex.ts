/*
 * inclusion-group-mutex.ts — SillyTavern Inclusion Groups composer.
 * Entries are tagged with a `group`; at most one entry per group
 * fires per turn. Tie-break by `weight` (default) or by `order`
 * (registration order).
 *
 * Composes: Registry-style entry list + per-group selection + a
 * single ContextContributor that emits the winners.
 *
 * Source: SillyTavern Inclusion Groups.
 */

import type { ContextContributor, Section } from "../../context";
import { estimateTokens } from "../../context";
import type { ComposedSubsystem } from "./types";

export interface GroupedEntry {
  id: string;
  group: string;
  content: string;
  /** Inclusion test: does this entry want to fire for `scan`? */
  matches: (scan: string) => boolean;
  weight?: number;
}

export interface InclusionGroupMutexOptions {
  entries: GroupedEntry[];
  tieBreak?: "weight" | "order";
  scanTextOf?: (state: unknown) => string;
  id?: string;
  priority?: number;
}

export function inclusionGroupMutexPattern(
  opts: InclusionGroupMutexOptions,
): ComposedSubsystem<Record<string, never>> {
  const tieBreak = opts.tieBreak ?? "weight";
  const scanTextOf =
    opts.scanTextOf ??
    ((s) => (s && typeof (s as { scanText?: string }).scanText === "string"
      ? (s as { scanText: string }).scanText
      : ""));

  const contributor: ContextContributor = {
    id: opts.id ?? "wi-groups",
    priority: opts.priority ?? 60,
    contribute(ctx) {
      const scan = scanTextOf(ctx.stage);
      const byGroup = new Map<string, GroupedEntry[]>();
      opts.entries.forEach((e, i) => {
        if (!e.matches(scan)) return;
        const bucket = byGroup.get(e.group) ?? [];
        bucket.push({ ...e, weight: e.weight ?? (tieBreak === "order" ? -i : 1) });
        byGroup.set(e.group, bucket);
      });
      if (byGroup.size === 0) return null;
      const winners: GroupedEntry[] = [];
      for (const bucket of byGroup.values()) {
        bucket.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
        winners.push(bucket[0]);
      }
      const content = winners.map((w) => w.content).join("\n");
      const sec: Section = {
        id: opts.id ?? "wi-groups",
        content,
        tokens: estimateTokens(content),
        optional: true,
      };
      return sec;
    },
  };

  return { state: {}, contributors: [contributor] };
}
