/*
 * character-filtered-activation.ts — SillyTavern WI Character
 * Filters / per-character lorebooks composer. Each entry declares
 * `forSpeakers`; the contributor only emits the entry when the
 * current speaker matches.
 *
 * Composes: per-character Registry namespaces + ContextAssembler
 * filter at the contributor layer.
 *
 * Source: SillyTavern WI Character Filters; per-character lorebooks.
 */

import type { ContextContributor } from "../../context";
import { estimateTokens } from "../../context";
import type { ComposedSubsystem } from "./types";

export interface CharacterFilteredEntry {
  id: string;
  content: string;
  /** Speaker ids this entry is restricted to. Undefined / empty =
   *  all speakers. */
  forSpeakers?: string[];
  matches?: (scan: string) => boolean;
  priority?: number;
}

export interface CharacterFilteredActivationOptions {
  entries: CharacterFilteredEntry[];
  /** Resolves the current speaker id from `ctx.stage`. */
  speakerOf: (state: unknown) => string | undefined;
  scanTextOf?: (state: unknown) => string;
}

export function characterFilteredActivationPattern(
  opts: CharacterFilteredActivationOptions,
): ComposedSubsystem<Record<string, never>> {
  const scanTextOf =
    opts.scanTextOf ??
    ((s) => (s && typeof (s as { scanText?: string }).scanText === "string"
      ? (s as { scanText: string }).scanText
      : ""));

  const contributors: ContextContributor[] = opts.entries.map((e) => ({
    id: e.id,
    priority: e.priority ?? 55,
    contribute(ctx) {
      const speaker = opts.speakerOf(ctx.stage);
      if (e.forSpeakers && e.forSpeakers.length > 0) {
        if (!speaker || !e.forSpeakers.includes(speaker)) return null;
      }
      if (e.matches && !e.matches(scanTextOf(ctx.stage))) return null;
      return {
        id: e.id,
        content: e.content,
        tokens: estimateTokens(e.content),
        optional: true,
      };
    },
  }));
  return { state: {}, contributors };
}
