/*
 * scheduled-self-check.ts — SillyTavern Objectives Task Check
 * Frequency composer. Every N turns, fires a quiet sub-call asking
 * the LLM a yes/no (or short-form) question about progress; the
 * verdict feeds back into pipeline state via `onVerdict`.
 *
 * Composes: Scheduler-style turn counter + LlmPipelineRunner.runQuiet
 * + verdict reducer.
 *
 * Source: SillyTavern Objectives Task Check Frequency.
 */

import type { LlmPipelineRunner } from "../../llm-pipeline";
import type { ComposedSubsystem } from "./types";

export interface ScheduledSelfCheckOptions<S> {
  runner: LlmPipelineRunner<S>;
  /** Run the check every N turns. */
  everyN: number;
  /** Prompt fed to runQuiet. Receives current state for templating. */
  prompt: string | ((state: S) => string);
  /** Receives the verdict; return a partial state delta to merge. */
  onVerdict?: (verdict: string, state: S) => Partial<S> | void;
}

export interface ScheduledSelfCheckState {
  /** Turn count of the most recent self-check; 0 if none yet. */
  lastCheck: number;
  /** Total turns seen by `tick`. */
  turns: number;
}

export function scheduledSelfCheckPattern<S>(
  opts: ScheduledSelfCheckOptions<S>,
): ComposedSubsystem<ScheduledSelfCheckState> & {
  tick: () => Promise<void>;
} {
  const state: ScheduledSelfCheckState = { lastCheck: 0, turns: 0 };

  async function tick(): Promise<void> {
    state.turns++;
    if (state.turns - state.lastCheck < opts.everyN) return;
    state.lastCheck = state.turns;
    const pipelineState = opts.runner.pipeline.state;
    const prompt = typeof opts.prompt === "function" ? opts.prompt(pipelineState) : opts.prompt;
    const verdict = await opts.runner.runQuiet(prompt);
    const delta = opts.onVerdict?.(verdict, pipelineState);
    if (delta) Object.assign(pipelineState as object, delta);
  }

  return { state, tick, hooks: { tick }, shards: [{ id: "self-check", value: state }] };
}
