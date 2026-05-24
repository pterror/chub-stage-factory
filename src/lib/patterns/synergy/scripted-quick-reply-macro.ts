/*
 * scripted-quick-reply-macro.ts — SillyTavern STScript / Quick
 * Replies / Guided-Generations composer. Registers a set of named
 * macros; each macro is a small sequence of typed steps (quiet sub-
 * call, show panel, set state). When the player types a macro
 * trigger (e.g. "/recap"), the pipeline's `inputModifier` rewrites
 * the input into either an empty string (macro consumed) or a
 * rephrased prompt, and the registered handler runs the step list.
 *
 * Composes: Inline macro DSL (sequence of MacroStep records) +
 * LlmPipelineRunner.runQuiet for embedded LLM steps.
 *
 * FLAG: `action.ts` covers combat-shaped action defs (costs, range,
 * targetFilter, effects) and is NOT a fit for the scripted-quick-
 * reply macro shape (sequence of quiet/show/set steps). The Wave 2I
 * design (SYNERGY-EXTENSIONS.md §10) anticipated this: "if
 * action.ts coverage insufficient, a tiny macro.ts may be needed."
 * For now this pattern embeds a minimal inline shape (`MacroStep`
 * union below). If future patterns add branching / loops, lift
 * `MacroStep` into a top-level `src/lib/macro.ts` primitive.
 *
 * Source: SillyTavern STScript / Quick Replies; Guided-Generations.
 */

import type { LlmPipelineRunner } from "../../llm-pipeline";
import type { ComposedSubsystem } from "./types";

/** Minimal inline macro DSL. Lift to a dedicated primitive if it
 *  ever needs branching / loops / nested macros. */
export type MacroStep<S> =
  | { kind: "quiet"; promptId: string; promptCtx?: Record<string, string> }
  | { kind: "show"; channel: string; content: string | ((state: S) => string) }
  | { kind: "set"; delta: Partial<S> | ((state: S) => Partial<S>) };

export interface MacroDef<S> {
  trigger: string;
  steps: MacroStep<S>[];
}

export interface ScriptedQuickReplyMacroOptions<S> {
  runner: LlmPipelineRunner<S>;
  macros: Record<string, MacroDef<S>>;
  prompts: Record<string, string | ((ctx: Record<string, string>) => string)>;
  onShow?: (channel: string, content: string) => void;
}

function renderPrompt(
  tpl: string | ((ctx: Record<string, string>) => string),
  ctx: Record<string, string>,
): string {
  if (typeof tpl === "function") return tpl(ctx);
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => ctx[k] ?? "");
}

export function scriptedQuickReplyMacroPattern<S>(
  opts: ScriptedQuickReplyMacroOptions<S>,
): ComposedSubsystem<Record<string, never>> & {
  runMacro: (id: string) => Promise<void>;
  matchAndRun: (input: string) => Promise<boolean>;
} {
  async function runMacro(id: string): Promise<void> {
    const def = opts.macros[id];
    if (!def) throw new Error(`scriptedQuickReplyMacroPattern: unknown macro "${id}"`);
    const state = opts.runner.pipeline.state;
    for (const step of def.steps) {
      if (step.kind === "quiet") {
        const tpl = opts.prompts[step.promptId];
        if (!tpl) throw new Error(`unknown quiet prompt "${step.promptId}"`);
        const prompt = renderPrompt(tpl, step.promptCtx ?? {});
        await opts.runner.runQuiet(prompt);
      } else if (step.kind === "show") {
        const content = typeof step.content === "function" ? step.content(state) : step.content;
        opts.onShow?.(step.channel, content);
      } else if (step.kind === "set") {
        const delta = typeof step.delta === "function" ? step.delta(state) : step.delta;
        Object.assign(state as object, delta);
      }
    }
  }

  async function matchAndRun(input: string): Promise<boolean> {
    const trimmed = input.trim();
    for (const [id, def] of Object.entries(opts.macros)) {
      if (trimmed === def.trigger) {
        await runMacro(id);
        return true;
      }
    }
    return false;
  }

  return { state: {}, runMacro, matchAndRun };
}
