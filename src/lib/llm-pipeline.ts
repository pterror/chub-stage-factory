/*
 * llm-pipeline.ts — composable LLM-call envelope (Wave 2I primitive).
 *
 * WHAT: `LlmPipeline<S>` is a record of four optional hooks plus a
 *       persistent `state: S`. `LlmPipelineRunner<S>` threads `state`
 *       through each hook around every `textGen` call:
 *
 *         1. `inputModifier(input, state)` — rewrites the player input
 *            and may return a `stateDelta`.
 *         2. `contextModifier(assembler, state)` — mutates the
 *            assembler (register / unregister / re-prioritise
 *            contributors) before assembly.
 *         3. `assembler.assemble(...)` builds the prompt.
 *         4. `textGen({ prompt, max_tokens })` produces the raw output.
 *         5. `outputModifier(output, state)` — rewrites the output and
 *            may return a `stateDelta`.
 *
 *       `runQuiet(prompt)` routes through `quietCall` if supplied,
 *       otherwise falls back to a direct `textGen` call. Quiet results
 *       never enter the transcript; they exist to inform `state`.
 *
 *       State is mutated in-place via shallow `Object.assign` from every
 *       hook's `stateDelta`. The runner does not own persistence — the
 *       stage author shards `pipeline.state` like any other primitive.
 *       `LlmPipelineRunner` does not assume a particular shard layout;
 *       persistence is the consumer's call.
 *
 * WHY: Surfaced from the SYNERGY mining run (src/lib/mining/SYNERGY.md
 *      §52) as the load-bearing wrapper shape that the 14 new synergy
 *      patterns compose inside. AID Scripting's
 *      `triple-hook-pipeline + quiet-generation-sub-call + state-object`
 *      trio doesn't reduce to existing primitives — `ContextAssembler`
 *      assembles, but no primitive owns the input/context/output/quiet
 *      envelope or threads persistent state through it.
 *
 *      Design decision: ships as a NEW PRIMITIVE in Wave 2I, not a
 *      pattern. Per the supply-driven rule in COMPOSITION.md: distinct
 *      architectural shape + earns its keep across 14 synergy patterns
 *      → primitive. Detail in src/lib/design/SYNERGY-EXTENSIONS.md §1.
 *
 *      Existing 8 synergy patterns can OPTIONALLY be re-expressed inside
 *      LlmPipeline; this primitive does not break them. New 14 patterns
 *      live inside it by construction.
 *
 * SHAPE:
 *   interface PipelineDelta<S> { rewritten: string; stateDelta?: Partial<S> }
 *   interface QuietResult<S>   { result: string; stateDelta?: Partial<S> }
 *   interface LlmPipeline<S> {
 *     state: S;
 *     inputModifier?(input, state): PipelineDelta<S> | Promise<PipelineDelta<S>>;
 *     contextModifier?(assembler, state): void | Promise<void>;
 *     outputModifier?(output, state): PipelineDelta<S> | Promise<PipelineDelta<S>>;
 *     quietCall?(prompt, state): Promise<QuietResult<S>>;
 *   }
 *   interface TurnResult { input: string; prompt: string; output: string }
 *   class LlmPipelineRunner<S>
 *     constructor(pipeline, assembler, generator, options?)
 *     pipeline: LlmPipeline<S>
 *     runTurn(playerInput): Promise<TurnResult>
 *     runQuiet(prompt): Promise<string>
 */

import type { GenerationService } from "@chub-ai/stages-ts";
import type { Message } from "@chub-ai/stages-ts/dist/types/message";
import type { AssemblyContext, ContextAssembler } from "./context";

export interface PipelineDelta<S> {
  rewritten: string;
  stateDelta?: Partial<S>;
}

export interface QuietResult<S> {
  result: string;
  stateDelta?: Partial<S>;
}

export interface LlmPipeline<S> {
  /** Mutable state threaded through every hook. The runner applies any
   *  `stateDelta` returned from a hook via `Object.assign(state, delta)`
   *  before invoking the next hook. */
  state: S;
  /** Rewrites the player input before assembly. Most commonly used for
   *  scripted command translation (`/recap` → quiet summary, etc.). */
  inputModifier?: (
    input: string,
    state: S,
  ) => PipelineDelta<S> | Promise<PipelineDelta<S>>;
  /** Mutates the assembler in place — register, unregister, or
   *  re-prioritise contributors. Runs before `assemble`. */
  contextModifier?: (
    assembler: ContextAssembler,
    state: S,
  ) => void | Promise<void>;
  /** Rewrites the raw LLM output before the runner returns. Typical
   *  uses: regex post-clean, profanity filter, tag-parser extraction. */
  outputModifier?: (
    output: string,
    state: S,
  ) => PipelineDelta<S> | Promise<PipelineDelta<S>>;
  /** Routes `runQuiet` calls. Stages override this when their quiet
   *  sub-calls need different sampling parameters, a different model,
   *  or schema-validated retries. Defaults to a plain `textGen` call. */
  quietCall?: (prompt: string, state: S) => Promise<QuietResult<S>>;
}

export interface TurnResult {
  /** Input after `inputModifier` (or the raw input if no modifier). */
  input: string;
  /** Final prompt fed to `textGen`. */
  prompt: string;
  /** Output after `outputModifier` (or the raw output if no modifier). */
  output: string;
}

export interface LlmPipelineRunnerOptions {
  /** Token budget passed to the assembler. Defaults to the assembler's
   *  own configured budget. */
  budget?: number;
  /** `textGen.max_tokens`. Default 500 (mirrors `generate.ts`). */
  maxTokens?: number;
  /** `textGen.max_tokens` for quiet sub-calls. Default 300. Quiet
   *  prompts are typically smaller (judgement / summary / verdict). */
  quietMaxTokens?: number;
  /** Build the `AssemblyContext` fed to `assembler.assemble`. By default
   *  the runner constructs `{ budget, turnInputMessage }` from the
   *  rewritten input. */
  buildContext?: (input: string, state: unknown) => AssemblyContext;
}

const DEFAULT_MAX_TOKENS = 500;
const DEFAULT_QUIET_MAX_TOKENS = 300;

/**
 * Wraps every LLM call in a four-hook envelope (input → context →
 * output) with a fifth out-of-band route (`runQuiet`) for sub-calls.
 * Threads `pipeline.state` through every hook and applies any returned
 * `stateDelta` shallowly. Does NOT own persistence — shard
 * `pipeline.state` directly via the persistence cluster.
 */
export class LlmPipelineRunner<S> {
  readonly pipeline: LlmPipeline<S>;
  readonly assembler: ContextAssembler;
  readonly generator: GenerationService;
  private readonly maxTokens: number;
  private readonly quietMaxTokens: number;
  private readonly budget: number | undefined;
  private readonly buildContext: (
    input: string,
    state: S,
  ) => AssemblyContext;

  constructor(
    pipeline: LlmPipeline<S>,
    assembler: ContextAssembler,
    generator: GenerationService,
    options: LlmPipelineRunnerOptions = {},
  ) {
    this.pipeline = pipeline;
    this.assembler = assembler;
    this.generator = generator;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.quietMaxTokens = options.quietMaxTokens ?? DEFAULT_QUIET_MAX_TOKENS;
    this.budget = options.budget;
    this.buildContext =
      (options.buildContext as (input: string, state: S) => AssemblyContext) ??
      this.defaultBuildContext.bind(this);
  }

  /**
   * Run one player turn end-to-end:
   *   1. inputModifier → rewritten input + stateDelta
   *   2. contextModifier → assembler mutations
   *   3. assembler.assemble → prompt
   *   4. generator.textGen → raw output
   *   5. outputModifier → rewritten output + stateDelta
   */
  async runTurn(playerInput: string): Promise<TurnResult> {
    const { pipeline } = this;

    // 1. Input.
    let input = playerInput;
    if (pipeline.inputModifier) {
      const delta = await pipeline.inputModifier(input, pipeline.state);
      input = delta.rewritten;
      this.applyDelta(delta.stateDelta);
    }

    // 2. Context modification.
    if (pipeline.contextModifier) {
      await pipeline.contextModifier(this.assembler, pipeline.state);
    }

    // 3. Assemble.
    const ctx = this.buildContext(input, pipeline.state);
    const prompt = this.assembler.assemble(ctx);

    // 4. Generate.
    const resp = await this.generator.textGen({
      prompt,
      max_tokens: this.maxTokens,
    });
    let output = resp?.result ?? "";

    // 5. Output.
    if (pipeline.outputModifier) {
      const delta = await pipeline.outputModifier(output, pipeline.state);
      output = delta.rewritten;
      this.applyDelta(delta.stateDelta);
    }

    return { input, prompt, output };
  }

  /**
   * Quiet sub-call. Result is returned to the caller and never enters
   * the transcript. Routes through `pipeline.quietCall` if supplied;
   * otherwise falls back to a plain `textGen`. Any `stateDelta` from
   * `quietCall` is applied before the result is returned.
   */
  async runQuiet(prompt: string): Promise<string> {
    const { pipeline } = this;
    if (pipeline.quietCall) {
      const r = await pipeline.quietCall(prompt, pipeline.state);
      this.applyDelta(r.stateDelta);
      return r.result;
    }
    const resp = await this.generator.textGen({
      prompt,
      max_tokens: this.quietMaxTokens,
    });
    return resp?.result ?? "";
  }

  /** Shallow-merge a partial state delta into `pipeline.state`. */
  private applyDelta(delta: Partial<S> | undefined): void {
    if (!delta) return;
    Object.assign(this.pipeline.state as object, delta);
  }

  /** Default AssemblyContext builder. Wraps the rewritten input in a
   *  Chub `Message` shape with `isBot=false`; stages that need finer
   *  control pass `options.buildContext`. */
  private defaultBuildContext(input: string, _state: S): AssemblyContext {
    const turnInputMessage = {
      content: input,
      isBot: false,
    } as unknown as Message;
    return {
      budget: this.budget ?? this.assembler.budget,
      turnInputMessage,
    };
  }
}
