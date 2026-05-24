/*
 * subcontext-group-budgeting.ts — NovelAI Subcontext composer. Each
 * group owns a NESTED ContextAssembler with its own budget; the
 * outer assembler sees the group's assembled output as a single
 * Section. Mitigates the `budget-poisoning` anti-pattern — one
 * category cannot starve the others because its budget is bounded
 * by construction.
 *
 * Composes: A nested ContextAssembler per group.
 *
 * Source: NovelAI Subcontext.
 */

import type { ContextContributor } from "../../context";
import { ContextAssembler, estimateTokens } from "../../context";
import type { ComposedSubsystem } from "./types";

export interface SubcontextGroup {
  id: string;
  budget: number;
  contributors: ContextContributor[];
  /** Outer priority for the assembled group. Default 50. */
  priority?: number;
  /** Default true — the inner block is droppable under outer
   *  budget pressure even though its inner contributors aren't. */
  optional?: boolean;
}

export interface SubcontextGroupBudgetingOptions {
  group: SubcontextGroup[];
}

export function subcontextGroupBudgetingPattern(
  opts: SubcontextGroupBudgetingOptions,
): ComposedSubsystem<Record<string, never>> {
  const contributors: ContextContributor[] = opts.group.map((g) => {
    const inner = new ContextAssembler({
      budget: g.budget,
      contributors: g.contributors,
    });
    return {
      id: g.id,
      priority: g.priority ?? 50,
      contribute(ctx) {
        const body = inner.assemble({ budget: g.budget, turnInputMessage: ctx.turnInputMessage });
        if (!body) return null;
        const content = `<subcontext id="${g.id}">\n${body}\n</subcontext>`;
        return {
          id: g.id,
          content,
          tokens: estimateTokens(content),
          optional: g.optional ?? true,
        };
      },
    } satisfies ContextContributor;
  });
  return { state: {}, contributors };
}
