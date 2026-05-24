/*
 * positional-injection-depth.ts — SillyTavern WI position field / AID
 * Front-Memory + Author's-Note depth composer. Emits one
 * `ContextContributor` per entry, each marking its `Section.position`
 * with an explicit depth so the assembler injects it at a known
 * offset from the end of the prompt.
 *
 * Composes: ContextAssembler + Section.position (added in Wave 2I).
 *
 * Source: SillyTavern WI position field; AID Front Memory / Author's
 * Note depth ~3.
 */

import type { ContextContributor, SectionRole } from "../../context";
import { estimateTokens } from "../../context";
import type { ComposedSubsystem } from "./types";

export interface PositionedEntry {
  id: string;
  content: string;
  /** Depth from the bottom of the assembled prompt. 0 = last section,
   *  3 = three sections from the end. Defaults to `defaultDepth`. */
  depth?: number;
  role?: SectionRole;
  priority?: number;
  optional?: boolean;
}

export interface PositionalInjectionDepthOptions {
  entries: PositionedEntry[];
  /** Default depth when an entry omits one. SillyTavern default is 4. */
  defaultDepth?: number;
}

export function positionalInjectionDepthPattern(
  opts: PositionalInjectionDepthOptions,
): ComposedSubsystem<Record<string, never>> {
  const defaultDepth = opts.defaultDepth ?? 4;
  const contributors: ContextContributor[] = opts.entries.map((e) => ({
    id: e.id,
    priority: e.priority ?? 50,
    contribute() {
      return {
        id: e.id,
        content: e.content,
        tokens: estimateTokens(e.content),
        optional: e.optional ?? true,
        position: { depth: e.depth ?? defaultDepth },
        role: e.role,
      };
    },
  }));
  return { state: {}, contributors };
}
