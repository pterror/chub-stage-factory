/*
 * classifier.ts — pluggable text classifier with two reference adapters.
 *
 * WHAT: A Classifier is `(text, labels) => Promise<Score[]>`. The library
 *       ships two adapters:
 *         - `llmClassifier(generator, opts?)` — uses the GenerationService's
 *           `textGen` to ask the player's model. Lowest cost, lowest latency
 *           on Chub because the model is already in the pipeline.
 *         - `localTransformerClassifier(opts)` — fence around a user-supplied
 *           local-model handle (e.g. transformers.js Pipeline). The stage
 *           owns the pipeline lifecycle; we just adapt the call signature.
 *
 * WHY: Classification is the second-most-common LLM-bridge primitive after
 *       observation. statosphere uses it heavily. Keeping the interface flat
 *       means swapping local/remote is one line.
 *
 * SHAPE:
 *   interface Score { label: string; score: number }
 *   type Classifier = (text: string, labels: readonly string[]) => Promise<Score[]>
 *   interface LlmClassifierOpts { model?, temperature?, hypothesis?: (label) => string }
 *   llmClassifier(generator, opts?): Classifier
 *   interface LocalPipe { (text: string, labels: string[]): Promise<{labels: string[]; scores: number[]}> }
 *   localTransformerClassifier(pipe): Classifier
 */

import type { GenerationService } from "@chub-ai/stages-ts";

export interface Score {
  label: string;
  score: number;
}

export type Classifier = (text: string, labels: readonly string[]) => Promise<Score[]>;

export interface LlmClassifierOpts {
  temperature?: number;
  /** Build the per-label hypothesis sentence. Default: `"This text is about {label}."`. */
  hypothesis?: (label: string) => string;
}

/**
 * Asks the LLM to assign a confidence (0..1) to each label using a single
 * prompt. Parses a `<scores>` JSON block from the response. Stages should
 * keep `labels.length` small (≤ 10); for larger taxonomies use a local pipe.
 */
export function llmClassifier(
  generator: GenerationService,
  opts: LlmClassifierOpts = {},
): Classifier {
  const hyp = opts.hypothesis ?? ((l: string) => `This text is about ${l}.`);
  return async (text, labels) => {
    const prompt = [
      "You are a strict classifier. Read the text and assign a probability between 0 and 1 to each candidate label.",
      "Labels and their hypotheses:",
      ...labels.map((l) => `- ${l}: ${hyp(l)}`),
      "",
      `Text: ${JSON.stringify(text)}`,
      "",
      'Reply with ONLY a JSON block: <scores>{"label1": 0.0, "label2": 0.0, ...}</scores>',
    ].join("\n");
    // opts.temperature is accepted on the interface but Chub's TextGenRequest
    // doesn't currently expose it; left here for forward-compat once exposed.
    void opts.temperature;
    const resp = await generator.textGen({
      prompt,
      max_tokens: 200,
    });
    const body = resp?.result ?? "";
    const m = /<scores>([\s\S]*?)<\/scores>/i.exec(body);
    if (!m) return labels.map((l) => ({ label: l, score: 0 }));
    try {
      const parsed = JSON.parse(m[1]) as Record<string, number>;
      return labels.map((l) => ({ label: l, score: Math.max(0, Math.min(1, parsed[l] ?? 0)) }));
    } catch {
      return labels.map((l) => ({ label: l, score: 0 }));
    }
  };
}

export interface LocalPipe {
  (text: string, labels: string[]): Promise<{ labels: string[]; scores: number[] }>;
}

/**
 * Wraps a transformers.js-style zero-shot pipeline. The stage owns the
 * pipeline; this module just adapts the call signature.
 */
export function localTransformerClassifier(pipe: LocalPipe): Classifier {
  return async (text, labels) => {
    const out = await pipe(text, [...labels]);
    const byLabel: Record<string, number> = {};
    for (let i = 0; i < out.labels.length; i++) byLabel[out.labels[i]] = out.scores[i] ?? 0;
    return labels.map((l) => ({ label: l, score: byLabel[l] ?? 0 }));
  };
}
