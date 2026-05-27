/*
 * programmatic-narrates-llm-decides.ts — LLM picks from a constrained
 * action menu; procgen renders a deterministic narration from the
 * chosen action. Keeps narrative consistent while giving the LLM
 * expressive latitude within guardrails.
 *
 * Composes: ActionDef table (constrained menu) + LLM quiet sub-call
 * (llm-pipeline) + caller-supplied render function (generate).
 *
 * Source: AID Scripting outputModifier direction — LLM picks verb,
 * procgen renders the consequence deterministically.
 */

import type { GenerationService } from "@chub-ai/stages-ts";
import type { ComposedSubsystem } from "./types";

export interface MenuAction {
  id: string;
  displayName: string;
  description?: string;
}

export interface ProgrammaticNarratesLlmDecidesOptions<A extends MenuAction> {
  generator: GenerationService;
  /** The constrained menu of choices the LLM may pick from. */
  actions: A[];
  /** Renders the chosen action into prose. Called only when the LLM
   *  picks a valid id. */
  render: (action: A) => string;
  /** Builds the prompt asking the LLM to pick; receives the menu list.
   *  Defaults to a numbered list with an "respond with the id" instruction. */
  buildPrompt?: (actions: A[], context: string) => string;
  maxTokens?: number;
}

export interface ProgrammaticNarratesState {
  lastChosenId: string | null;
  lastNarration: string;
}

function defaultPrompt<A extends MenuAction>(actions: A[], context: string): string {
  const menu = actions.map((a) => `  ${a.id}: ${a.displayName}${a.description ? ` — ${a.description}` : ""}`).join("\n");
  return [
    context,
    "",
    "Choose one action by responding with exactly its id (no other text):",
    menu,
  ].join("\n");
}

export function programmaticNarratesLlmDecidesPattern<A extends MenuAction>(
  opts: ProgrammaticNarratesLlmDecidesOptions<A>,
): ComposedSubsystem<ProgrammaticNarratesState> & {
  decide(context: string): Promise<string>;
} {
  const state: ProgrammaticNarratesState = { lastChosenId: null, lastNarration: "" };
  const maxTokens = opts.maxTokens ?? 60;
  const buildPrompt = opts.buildPrompt ?? defaultPrompt;
  const actionMap = new Map(opts.actions.map((a) => [a.id, a]));

  async function decide(context: string): Promise<string> {
    const prompt = buildPrompt(opts.actions, context);
    const resp = await opts.generator.textGen({ prompt, max_tokens: maxTokens });
    const chosenId = (resp?.result ?? "").trim().split(/\s+/)[0] ?? "";
    const action = actionMap.get(chosenId);
    if (!action) {
      // Unknown id — fall back to first action.
      const fallback = opts.actions[0];
      if (!fallback) return "";
      const narration = opts.render(fallback);
      state.lastChosenId = fallback.id;
      state.lastNarration = narration;
      return narration;
    }
    const narration = opts.render(action);
    state.lastChosenId = action.id;
    state.lastNarration = narration;
    return narration;
  }

  return {
    state,
    shards: [{ id: "programmatic-narrates-llm-decides", value: state }],
    decide,
  };
}
