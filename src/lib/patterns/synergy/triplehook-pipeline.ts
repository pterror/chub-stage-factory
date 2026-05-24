/*
 * triplehook-pipeline.ts — AID-Scripting triple-hook composer that
 * wraps `LlmPipelineRunner`. The pattern itself is a thin convenience
 * around the primitive; it supplies ergonomic defaults (echo-identity
 * input, no-op context, trim+regex-strip output) and threads the
 * author's hooks through.
 *
 * Composes: LlmPipelineRunner with author-supplied input / context /
 * output modifiers.
 *
 * Source: AID Scripting.
 */

import type { GenerationService } from "@chub-ai/stages-ts";
import type { ContextAssembler } from "../../context";
import type {
  LlmPipeline,
  LlmPipelineRunnerOptions,
  PipelineDelta,
} from "../../llm-pipeline";
import { LlmPipelineRunner } from "../../llm-pipeline";
import type { ComposedSubsystem } from "./types";

export interface TriplehookPipelineOptions<S> extends LlmPipelineRunnerOptions {
  state: S;
  inputModifier?: (input: string, state: S) => PipelineDelta<S>;
  contextModifier?: (assembler: ContextAssembler, state: S) => void;
  outputModifier?: (output: string, state: S) => PipelineDelta<S>;
  assembler: ContextAssembler;
  generator: GenerationService;
}

export function triplehookPipelinePattern<S>(
  opts: TriplehookPipelineOptions<S>,
): ComposedSubsystem<S> & { runner: LlmPipelineRunner<S> } {
  const pipeline: LlmPipeline<S> = {
    state: opts.state,
    inputModifier:
      opts.inputModifier ?? ((input) => ({ rewritten: input })),
    contextModifier: opts.contextModifier ?? (() => {}),
    outputModifier:
      opts.outputModifier ?? ((output) => ({ rewritten: output.trim() })),
  };
  const runner = new LlmPipelineRunner<S>(pipeline, opts.assembler, opts.generator, {
    budget: opts.budget,
    maxTokens: opts.maxTokens,
    quietMaxTokens: opts.quietMaxTokens,
    buildContext: opts.buildContext,
  });
  return {
    state: opts.state,
    runner,
    shards: [{ id: "pipeline-state", value: opts.state }],
  };
}
