/*
 * recursive-key-expansion.ts — SillyTavern WI recursion / NovelAI
 * cascading-activation composer. Walks key matchers across the chat
 * window; injected text is re-scanned up to `maxDepth` times so that
 * an injected entry can itself trigger further entries.
 *
 * Composes: Registry<WIEntry> + tag-parser (key scanner) +
 * ContextAssembler (re-runs scan on injected text up to maxDepth).
 *
 * Source: SillyTavern WI recursion; NovelAI cascading activation.
 */

import type { ContextContributor, Section } from "../../context";
import { estimateTokens } from "../../context";
import type { Registry } from "../../registry";
import type { ComposedSubsystem } from "./types";

export interface WIEntry {
  id: string;
  /** Substrings whose presence in the scan text fires the entry. */
  keys: string[];
  /** Text to inject when fired. */
  content: string;
  /** When true, the injected text is NOT scanned for further keys. */
  noRecurse?: boolean;
  priority?: number;
}

export interface RecursiveKeyExpansionOptions {
  entries: Registry<WIEntry>;
  /** Maximum cascade depth. Default 3 (SillyTavern's sane default). */
  maxDepth?: number;
  /** Returns true if `id`'s injection should NOT seed further scans. */
  preventFurther?: (id: string) => boolean;
  /** Scan source. Default reads `state.scanText` if present. */
  scanTextOf?: (state: unknown) => string;
  id?: string;
  priority?: number;
}

export interface RecursiveKeyExpansionState {
  depth: number;
  fired: Set<string>;
}

export function recursiveKeyExpansionPattern(
  opts: RecursiveKeyExpansionOptions,
): ComposedSubsystem<RecursiveKeyExpansionState> {
  const state: RecursiveKeyExpansionState = { depth: 0, fired: new Set() };
  const maxDepth = opts.maxDepth ?? 3;
  const scanTextOf =
    opts.scanTextOf ??
    ((s) => (s && typeof (s as { scanText?: string }).scanText === "string"
      ? (s as { scanText: string }).scanText
      : ""));

  const contributor: ContextContributor = {
    id: opts.id ?? "wi-recursive",
    priority: opts.priority ?? 60,
    contribute(ctx) {
      state.depth = 0;
      state.fired.clear();
      let scan = scanTextOf(ctx.stage);
      const out: string[] = [];
      while (state.depth < maxDepth) {
        const newly: WIEntry[] = [];
        for (const [, e] of opts.entries.entries()) {
          if (state.fired.has(e.id)) continue;
          if (e.keys.some((k) => scan.includes(k))) {
            newly.push(e);
            state.fired.add(e.id);
          }
        }
        if (newly.length === 0) break;
        const block = newly.map((e) => e.content).join("\n");
        out.push(block);
        const seedFurther = newly
          .filter((e) => !e.noRecurse && !(opts.preventFurther?.(e.id) ?? false))
          .map((e) => e.content)
          .join("\n");
        if (!seedFurther) break;
        scan = seedFurther;
        state.depth++;
      }
      if (out.length === 0) return null;
      const content = `<lore>\n${out.join("\n")}\n</lore>`;
      const sec: Section = {
        id: opts.id ?? "wi-recursive",
        content,
        tokens: estimateTokens(content),
        optional: true,
      };
      return sec;
    },
  };

  return {
    state,
    contributors: [contributor],
    shards: [{ id: opts.id ?? "wi-recursive", value: state }],
  };
}
