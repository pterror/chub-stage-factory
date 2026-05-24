/*
 * patterns/render-trigger.ts — trigger → context → LLM → prose.
 *
 * WHAT: `renderTrigger(opts)` wires the implicit "trigger fires → render
 *       prose" path that the library implies but did not previously codify.
 *       Given a fired trigger effect, a stub describing what should happen,
 *       a `ContextAssembler`, and an `LlmPipelineRunner`, it:
 *
 *         1. Registers the stub as a transient `ContextContributor`.
 *         2. Calls `runner.runQuiet(prompt)` — prose generation is a quiet
 *            call so the stage controls whether output enters the chat log.
 *         3. Unregisters the transient contributor.
 *         4. Returns the rendered prose string.
 *
 *       The stub is a structured directive (not a raw template string).
 *       This mirrors `SceneActionDef.prose` — the stage author describes
 *       *what* the scene should accomplish; the LLM writes the prose.
 *
 * WHY: Named in FRONTEND-SHAPE.md §"Gaps":
 *      "`patterns/render-trigger.ts` — `renderTrigger({ trigger, assembler,
 *      pipeline, stub })`: when trigger fires, assemble context, call main
 *      LLM, return prose." Promotes the implicit convention (trigger → render)
 *      to a named, composable pattern. First use in `examples/world-primary/`.
 *
 *      Rule 2 (patterns as 90% wiring): no private state, no new mechanics.
 *      All state lives in the primitives this pattern composes.
 *
 * SHAPE:
 *   interface RenderStub { tone?; beats?; lengthHint?; pov?; constraints? }
 *   interface RenderTriggerOptions<S, E>
 *     { effect; stub; assembler; runner; contributorId?; priority? }
 *   renderTrigger<S, E>(opts): Promise<string>
 *   stubContributor(stub, id, priority?): ContextContributor
 */

import {
  type ContextAssembler,
  type ContextContributor,
  type Section,
  estimateTokens,
} from "../context";
import type { LlmPipelineRunner } from "../llm-pipeline";

/**
 * Structured prose directive — the "stub" the stage author provides per
 * trigger. The LLM renders it into full prose conditioned on the assembled
 * context. Mirrors the slot concept in `SceneActionDef.prose` but generalised
 * to any trigger effect rather than scene acts.
 */
export interface RenderStub {
  /** Emotional register: "tense", "warm", "ominous", "playful", etc. */
  tone?: string;
  /** Ordered beat list — what should happen in sequence. */
  beats?: string[];
  /** Approximate desired length: "one paragraph", "two sentences", etc. */
  lengthHint?: string;
  /** Point-of-view anchor: "close third on player", "omniscient", etc. */
  pov?: string;
  /** Hard constraints the prose must honour. */
  constraints?: string[];
  /** Free-form additional directive that doesn't fit the above fields. */
  extra?: string;
}

export interface RenderTriggerOptions<S> {
  /** Structured stub describing what the rendered scene should achieve. */
  stub: RenderStub;
  /** Assembler already registered with state contributors. The stub
   *  contributor will be added transiently for this call and removed
   *  afterwards. */
  assembler: ContextAssembler;
  /** Pipeline runner whose `runQuiet` generates the prose. Using quiet so
   *  the stage controls whether prose is exposed to the transcript. */
  runner: LlmPipelineRunner<S>;
  /** Contributor id for the transient stub section. Defaults to
   *  "render-trigger-stub". */
  contributorId?: string;
  /** Priority for the stub contributor. Default 65 (prose-register band). */
  priority?: number;
}

/**
 * Build a `ContextContributor` from a `RenderStub`. Used by `renderTrigger`
 * transiently; exported so stages can register a stub contributor in their
 * own assembler setup if they need it persistently.
 */
export function stubContributor(
  stub: RenderStub,
  id: string,
  priority: number = 65,
): ContextContributor {
  return {
    id,
    priority,
    contribute(): Section | null {
      const lines: string[] = ["<render-directive>"];
      if (stub.tone) lines.push(`  tone: ${stub.tone}`);
      if (stub.pov) lines.push(`  pov: ${stub.pov}`);
      if (stub.lengthHint) lines.push(`  length: ${stub.lengthHint}`);
      if (stub.beats && stub.beats.length > 0) {
        lines.push("  beats:");
        for (const b of stub.beats) lines.push(`    - ${b}`);
      }
      if (stub.constraints && stub.constraints.length > 0) {
        lines.push("  constraints:");
        for (const c of stub.constraints) lines.push(`    - ${c}`);
      }
      if (stub.extra) lines.push(`  extra: ${stub.extra}`);
      lines.push("</render-directive>");
      const content = lines.join("\n");
      return {
        id,
        content,
        tokens: estimateTokens(content),
        optional: false,
      };
    },
  };
}

/**
 * Fire a trigger render: assemble context (including stub), call the LLM
 * via `runner.runQuiet`, and return the prose. The stub contributor is
 * registered transiently and removed after the call regardless of success
 * or failure.
 *
 * The assembled prompt is passed to `runQuiet` so prose never auto-enters
 * the Chub transcript — the stage decides what to show and when.
 */
export async function renderTrigger<S>(
  opts: RenderTriggerOptions<S>,
): Promise<string> {
  const id = opts.contributorId ?? "render-trigger-stub";
  const priority = opts.priority ?? 65;
  const contributor = stubContributor(opts.stub, id, priority);

  opts.assembler.register(contributor);
  try {
    const prompt = opts.assembler.assemble({ budget: opts.assembler.budget });
    return await opts.runner.runQuiet(prompt);
  } finally {
    opts.assembler.unregister(id);
  }
}
