/*
 * procgen-validates-llm.ts — LLM proposes a value; a deterministic
 * procgen invariant checker either accepts or rejects with a reason.
 * On rejection the pattern re-prompts with the failure reason appended,
 * up to `maxAttempts` times. This is the only pattern in this library
 * that implements hard rejection + retry (SYNERGY.md §51: "genuinely
 * novel territory").
 *
 * Composes: generate (LLM proposal) + procgen invariant function.
 */

import type { GenerationService } from "@chub-ai/stages-ts";
import type { SchemaParser } from "../../generate";
import type { ComposedSubsystem } from "./types";

export type InvariantResult = { ok: true } | { ok: false; reason: string };

export interface ProcgenValidatesLlmOptions<T> {
  generator: GenerationService;
  /** Builds the initial prompt asking the LLM to produce a T. */
  buildPrompt: () => string;
  /** Parses the raw LLM response into T (or null on parse failure). */
  schema: SchemaParser<T>;
  /** Deterministic invariant check. Receives the parsed T; returns ok or
   *  a human-readable failure reason that is fed back into the next prompt. */
  validate: (value: T) => InvariantResult;
  maxAttempts?: number;
  maxTokens?: number;
}

export interface ProcgenValidatesState {
  attempts: number;
  lastRejectionReason: string | null;
}

export function procgenValidatesLlmPattern<T>(
  opts: ProcgenValidatesLlmOptions<T>,
): ComposedSubsystem<ProcgenValidatesState> & {
  propose(): Promise<T>;
} {
  const state: ProcgenValidatesState = { attempts: 0, lastRejectionReason: null };
  const maxAttempts = opts.maxAttempts ?? 3;
  const maxTokens = opts.maxTokens ?? 500;

  async function propose(): Promise<T> {
    let prompt = opts.buildPrompt();
    state.attempts = 0;
    state.lastRejectionReason = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      state.attempts = attempt;
      const resp = await opts.generator.textGen({ prompt, max_tokens: maxTokens });
      const raw = resp?.result ?? "";
      const parsed = opts.schema(raw);

      if (parsed === null) {
        const reason = `response did not parse (attempt ${attempt})`;
        state.lastRejectionReason = reason;
        if (attempt < maxAttempts) {
          prompt = [prompt, "", `Your previous response could not be parsed. Reason: ${reason}. Try again.`].join("\n");
        }
        continue;
      }

      const check = opts.validate(parsed);
      if (check.ok) {
        state.lastRejectionReason = null;
        return parsed;
      }

      state.lastRejectionReason = check.reason;
      if (attempt < maxAttempts) {
        prompt = [
          prompt,
          "",
          `Your previous response was rejected by the world rules.`,
          `Reason: ${check.reason}`,
          "Please propose a different value that satisfies all constraints.",
        ].join("\n");
      }
    }

    throw new Error(
      `procgen-validates-llm: proposal rejected after ${maxAttempts} attempts (${state.lastRejectionReason ?? "unknown"})`,
    );
  }

  return {
    state,
    shards: [{ id: "procgen-validates-llm", value: state }],
    propose,
  };
}
