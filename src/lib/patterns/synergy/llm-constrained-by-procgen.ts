/*
 * llm-constrained-by-procgen.ts — procgen lays a structured skeleton
 * (constraints, required fields, hard facts); the LLM fills the
 * creative detail within that skeleton. Constraint text is injected as
 * a high-priority context contributor so the LLM always sees the
 * guardrails.
 *
 * Composes: procgen-supplied constraint record + ContextContributor
 * (context) + generate (LLM fill-in with schema validation).
 *
 * Source: Character cards, Plot Essentials, NovelAI Phrase Bias — all
 * procgen-supplied constraint text that scopes LLM generation.
 */

import type { GenerationService } from "@chub-ai/stages-ts";
import type { ContextContributor } from "../../context";
import { estimateTokens } from "../../context";
import { generate, type SchemaParser } from "../../generate";
import type { ComposedSubsystem } from "./types";

export interface LlmConstrainedByProcgenOptions<T> {
  generator: GenerationService;
  /** Procgen builds this on demand; the result is formatted and injected
   *  into context as a constraint block. */
  buildConstraints: () => Record<string, string>;
  /** Renders the constraint record into the prompt fragment that the LLM
   *  sees as its guardrails. */
  renderConstraints?: (constraints: Record<string, string>) => string;
  /** Builds the generation prompt given the current constraints. */
  buildPrompt: (constraints: Record<string, string>) => string;
  /** Parses LLM output into T. If omitted raw string is returned. */
  schema?: SchemaParser<T>;
  maxTokens?: number;
  /** Priority for the constraint contributor. Default 80. */
  priority?: number;
  id?: string;
}

export interface LlmConstrainedState {
  constraints: Record<string, string>;
}

function defaultRender(constraints: Record<string, string>): string {
  const lines = Object.entries(constraints).map(([k, v]) => `${k}: ${v}`);
  return `<constraints>\n${lines.join("\n")}\n</constraints>`;
}

export function llmConstrainedByProcgenPattern<T>(
  opts: LlmConstrainedByProcgenOptions<T>,
): ComposedSubsystem<LlmConstrainedState> & {
  fill(): Promise<T>;
  refresh(): void;
} {
  const id = opts.id ?? "llm-constrained-procgen";
  const render = opts.renderConstraints ?? defaultRender;
  const state: LlmConstrainedState = { constraints: opts.buildConstraints() };

  function refresh(): void {
    state.constraints = opts.buildConstraints();
  }

  async function fill(): Promise<T> {
    const prompt = opts.buildPrompt(state.constraints);
    return generate<T>({
      prompt,
      generator: opts.generator,
      schema: opts.schema,
      maxTokens: opts.maxTokens,
    });
  }

  const contributor: ContextContributor = {
    id,
    priority: opts.priority ?? 80,
    contribute() {
      const content = render(state.constraints);
      return { id, content, tokens: estimateTokens(content), optional: false };
    },
  };

  return {
    state,
    contributors: [contributor],
    shards: [{ id, value: state }],
    fill,
    refresh,
  };
}
