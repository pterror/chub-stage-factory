/*
 * force-activate-with-budget-cap.ts — NovelAI Force Activation /
 * SillyTavern Constant-entries composer. Emits contributors that
 * ALWAYS produce a section (no predicate gate) at very high priority
 * but marked `optional: true` so the assembler drops them silently
 * when the budget is exhausted rather than busting it.
 *
 * Composes: ContextAssembler with always-emit, optional, high-priority
 * contributors.
 *
 * Source: NovelAI Force Activation; SillyTavern Constant entries.
 */

import type { ContextContributor } from "../../context";
import { estimateTokens } from "../../context";
import type { ComposedSubsystem } from "./types";

export interface ForcedEntry {
  id: string;
  content: string;
}

export interface ForceActivateWithBudgetCapOptions {
  entries: ForcedEntry[];
  /** Priority assigned to every forced contributor. Default 90 —
   *  immediately below required system instructions. */
  priority?: number;
}

export function forceActivateWithBudgetCapPattern(
  opts: ForceActivateWithBudgetCapOptions,
): ComposedSubsystem<Record<string, never>> {
  const priority = opts.priority ?? 90;
  const contributors: ContextContributor[] = opts.entries.map((e) => ({
    id: e.id,
    priority,
    contribute() {
      return {
        id: e.id,
        content: e.content,
        tokens: estimateTokens(e.content),
        // optional: true — always produced, but droppable under
        // overflow so we never bust the budget.
        optional: true,
      };
    },
  }));
  return { state: {}, contributors };
}
