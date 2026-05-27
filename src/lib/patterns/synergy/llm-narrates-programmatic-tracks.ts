/*
 * llm-narrates-programmatic-tracks.ts — procgen produces a mechanical
 * outcome; the LLM turns it into prose. The stage author runs whatever
 * procgen they like, passes the result here, and gets back a narrative
 * string that the pipeline can inject into its output modifier.
 *
 * Composes: tag-parser (extracts <narrative> from LLM output) +
 * LlmPipelineRunner (quiet sub-call) + caller-supplied procgen output.
 *
 * Source: AID Scripting — procgen owns goal/event list; LLM narrates
 * progress (SYNERGY.md §"Confirmation of existing 8").
 */

import type { GenerationService } from "@chub-ai/stages-ts";
import { parseTags } from "../../tag-parser";
import type { ComposedSubsystem } from "./types";

export interface LlmNarratesProgrammaticTracksOptions {
  generator: GenerationService;
  /** Renders the procgen outcome into a prompt fragment. */
  renderOutcome: (outcome: unknown) => string;
  /** Max tokens for the narration sub-call. Default 300. */
  maxTokens?: number;
  /** Prompt preamble injected before the outcome description. */
  preamble?: string;
}

export interface LlmNarratesState {
  lastNarration: string;
}

export function llmNarratesProgrammaticTracksPattern(
  opts: LlmNarratesProgrammaticTracksOptions,
): ComposedSubsystem<LlmNarratesState> & {
  narrate(outcome: unknown): Promise<string>;
} {
  const state: LlmNarratesState = { lastNarration: "" };
  const maxTokens = opts.maxTokens ?? 300;
  const preamble =
    opts.preamble ??
    "Narrate the following mechanical outcome in second-person present tense. Wrap the narration in <narrative>…</narrative>.";

  async function narrate(outcome: unknown): Promise<string> {
    const prompt = [preamble, "", opts.renderOutcome(outcome)].join("\n");
    const resp = await opts.generator.textGen({ prompt, max_tokens: maxTokens });
    const raw = resp?.result ?? "";
    const { parsed } = parseTags(raw, {
      narrative: { kind: "string" },
    });
    const narration =
      typeof parsed.narrative === "string" && parsed.narrative
        ? parsed.narrative
        : raw.trim();
    state.lastNarration = narration;
    return narration;
  }

  return {
    state,
    hooks: { afterOutput: async (output) => { state.lastNarration = output; } },
    shards: [{ id: "llm-narrates-tracks", value: state }],
    narrate,
  };
}
