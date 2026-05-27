/*
 * quiet-generation-sub-call.ts — SillyTavern Quiet Mode / STscript
 * `/gen quiet=true` composer. A small Registry of named quiet-prompt
 * templates; each is rendered with a context map and dispatched via
 * `LlmPipelineRunner.runQuiet`. Results flow into pipeline state via
 * `onResult`; nothing reaches the transcript.
 *
 * Composes: LlmPipelineRunner.runQuiet + named prompt templates.
 *
 * Source: SillyTavern Quiet Mode; STscript /gen quiet=true.
 */

import type { LlmPipelineRunner } from "../../llm-pipeline";
import type { ComposedSubsystem } from "./types";

export type QuietPromptTemplate = string | ((ctx: Record<string, string>) => string);

export interface QuietGenerationSubCallOptions<S> {
  runner: LlmPipelineRunner<S>;
  prompts: Record<string, QuietPromptTemplate>;
  /** Called with the rendered result; return a partial state delta
   *  to merge into the pipeline state. */
  onResult?: (id: string, result: string, state: S) => Partial<S> | void;
}

export interface QuietState {
  lastQuiet?: string;
}

function render(template: QuietPromptTemplate, ctx: Record<string, string>): string {
  if (typeof template === "function") return template(ctx);
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => ctx[k] ?? "");
}

export function quietGenerationSubCallPattern<S>(
  opts: QuietGenerationSubCallOptions<S>,
): ComposedSubsystem<QuietState> & {
  runQuietNamed: (id: string, ctx?: Record<string, string>) => Promise<string>;
} {
  const state: QuietState = {};

  async function runQuietNamed(id: string, ctx: Record<string, string> = {}): Promise<string> {
    const template = opts.prompts[id];
    if (!template) throw new Error(`quietGenerationSubCallPattern: unknown prompt "${id}"`);
    const prompt = render(template, ctx);
    const result = await opts.runner.runQuiet(prompt);
    state.lastQuiet = result;
    const delta = opts.onResult?.(id, result, opts.runner.pipeline.state);
    if (delta) Object.assign(opts.runner.pipeline.state as object, delta);
    return result;
  }

  return {
    state,
    runQuietNamed,
    shards: [{ id: "quiet-state", value: state }],
  };
}
