# Classifier — pluggable zero-shot text classification

`classifier.ts` defines a flat `Classifier` type and two reference
adapters. Classification is the second-most-common LLM-bridge primitive
after observation; the flat interface makes swapping local/remote one line.

## API

- `interface Score { label: string; score: number }` (`src/lib/classifier.ts:28-31`)
- `type Classifier = (text, labels) => Promise<Score[]>` (`src/lib/classifier.ts:33`)
- `interface LlmClassifierOpts { temperature?, hypothesis? }` (`src/lib/classifier.ts:35-39`)
- `llmClassifier(generator, opts?): Classifier` — calls `generator.textGen`; parses a `<scores>{…}</scores>` JSON block; returns `score: 0` for all labels on parse failure (`src/lib/classifier.ts:46-78`)
- `interface LocalPipe` — `(text, labels) => Promise<{ labels, scores }>` (`src/lib/classifier.ts:80-82`)
- `localTransformerClassifier(pipe): Classifier` — adapts a transformers.js-style pipeline; stage owns the pipeline lifecycle (`src/lib/classifier.ts:88-95`)

## Gotchas

- `llmClassifier` passes `opts.temperature` through to `textGen`; Chub's
  `TextGenRequest` does not currently expose temperature, so the field is
  a no-op forward-compat placeholder.
- Keep `labels.length` ≤ 10 for the LLM adapter. Larger taxonomies should
  use `localTransformerClassifier` with a local zero-shot model.
- Scores from `llmClassifier` are clamped to `[0, 1]` but not normalized
  to sum to 1. If you need a probability distribution, normalize after
  the call.
