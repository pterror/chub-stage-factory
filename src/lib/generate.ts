/*
 * generate.ts — LLM-call primitive with schema + retry + cache.
 *
 * WHAT: `generate(opts)` is the single surface for "ask the LLM for
 *       structured content." It wraps `GenerationService.textGen`,
 *       runs an optional schema-parsing function over the raw text,
 *       retries (with a self-correcting augmented prompt) on parse
 *       failure, and optionally caches the result by key in a
 *       caller-supplied `PlaceholderRegistry<T>`.
 *
 *       `generativeRegistry(opts)` is the cache-by-key + fallback-chain
 *       synergy pattern bundled into one helper: a Registry of `T`
 *       that auto-generates on miss via the supplied prompt builder
 *       and schema parser. This is the load-bearing piece for the
 *       "LLM generates content on demand, persisted thereafter" flow.
 *
 * WHY: Every stage that does LLM generation reimplements: prompt →
 *      textGen → parse → retry-on-bad-parse → store-result. Collapsing
 *      it makes the synthesis-primitive story (procgen + generate +
 *      persistence + PlaceholderRegistry) a single import for stage
 *      authors. The library does NOT own a global cache — the cache
 *      lives in a stage-supplied Registry, which the stage shards
 *      however it likes (chat-state, message-state, or none).
 *
 *      Why not extend classifier.ts: classifier is zero-shot scoring
 *      (text + labels → scored labels). generate is open-ended content
 *      production with a caller-supplied schema. Different shape,
 *      different file.
 *
 * SHAPE:
 *   type SchemaParser<T> = (response: string) => T | null
 *   interface GenerateOptions<T>
 *     { prompt; generator; schema?; retries?=3; cacheKey?; cache?: PlaceholderRegistry<T>;
 *       maxTokens?; onRetry?: (attempt, error) => void }
 *   generate<T>(opts): Promise<T>
 *
 *   interface GenerativeRegistryOptions<T>
 *     { base: PlaceholderRegistry<T>; generator; promptFor: (id) => string;
 *       schema: SchemaParser<T>; retries?; maxTokens?; placeholderFor?: (id) => T }
 *   interface GenerativeRegistry<T>
 *     getOrGenerate(id): Promise<T>
 *     base: PlaceholderRegistry<T>   // re-exposed; shard this for persistence
 */

import type { GenerationService } from "@chub-ai/stages-ts";
import { PlaceholderRegistry } from "./registry";

export type SchemaParser<T> = (response: string) => T | null;

export interface GenerateOptions<T> {
  prompt: string;
  generator: GenerationService;
  /** Parse response text into T, or null when invalid. If omitted the raw
   *  response string is returned (T must be string). */
  schema?: SchemaParser<T>;
  /** Max attempts at parsing before throwing. Default 3. */
  retries?: number;
  /** Optional cache key — when set together with `cache`, lookup happens
   *  first and a successful generation is stored back. */
  cacheKey?: string;
  /** Caller-supplied registry used as cache. PlaceholderRegistry so the
   *  cache composes with the standard async-swap flow. */
  cache?: PlaceholderRegistry<T>;
  /** textGen max_tokens. Default 500. */
  maxTokens?: number;
  /** Hook called before each retry with the validation error message. */
  onRetry?: (attempt: number, error: string) => void;
}

const DEFAULT_RETRIES = 3;
const DEFAULT_MAX_TOKENS = 500;

/**
 * Single LLM call with optional schema validation, retry, and cache.
 * Retries on schema-validation failure with an augmented prompt that
 * tells the model what went wrong. Throws after `retries` exhausted.
 */
export async function generate<T>(opts: GenerateOptions<T>): Promise<T> {
  const {
    prompt,
    generator,
    schema,
    retries = DEFAULT_RETRIES,
    cacheKey,
    cache,
    maxTokens = DEFAULT_MAX_TOKENS,
    onRetry,
  } = opts;

  if (cacheKey && cache) {
    if (cache.has(cacheKey) && !cache.isPlaceholder(cacheKey)) {
      return cache.require(cacheKey);
    }
  }

  let lastError = "";
  let currentPrompt = prompt;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const resp = await generator.textGen({
      prompt: currentPrompt,
      max_tokens: maxTokens,
    });
    const body = resp?.result ?? "";

    if (!schema) {
      const value = body as unknown as T;
      if (cacheKey && cache) cache.replace(cacheKey, value);
      return value;
    }

    const parsed = schema(body);
    if (parsed !== null) {
      if (cacheKey && cache) cache.replace(cacheKey, parsed);
      return parsed;
    }

    lastError = `response did not match expected schema (attempt ${attempt})`;
    onRetry?.(attempt, lastError);
    if (attempt < retries) {
      currentPrompt = [
        prompt,
        "",
        "Your previous response could not be parsed.",
        `Reason: ${lastError}.`,
        "Please try again, following the requested format exactly.",
      ].join("\n");
    }
  }

  throw new Error(`generate: schema validation failed after ${retries} attempts (${lastError})`);
}

// ─── generativeRegistry ──────────────────────────────────────────────

export interface GenerativeRegistryOptions<T> {
  base: PlaceholderRegistry<T>;
  generator: GenerationService;
  promptFor: (id: string) => string;
  schema: SchemaParser<T>;
  retries?: number;
  maxTokens?: number;
  /** Optional placeholder factory; when present, a placeholder is
   *  registered before generation begins so concurrent `waitFor` callers
   *  see "still generating" rather than "missing." */
  placeholderFor?: (id: string) => T;
}

export interface GenerativeRegistry<T> {
  base: PlaceholderRegistry<T>;
  getOrGenerate(id: string): Promise<T>;
}

/**
 * Wrap a PlaceholderRegistry with auto-generation on miss. Concurrent
 * calls for the same id coalesce: the first call drives generation; the
 * rest `waitFor` the same id and receive the result.
 */
export function generativeRegistry<T>(opts: GenerativeRegistryOptions<T>): GenerativeRegistry<T> {
  const inflight = new Map<string, Promise<T>>();

  async function getOrGenerate(id: string): Promise<T> {
    if (opts.base.has(id) && !opts.base.isPlaceholder(id)) {
      return opts.base.require(id);
    }
    const pending = inflight.get(id);
    if (pending) return pending;

    if (opts.placeholderFor && !opts.base.has(id)) {
      opts.base.registerPlaceholder(id, opts.placeholderFor(id));
    }

    const run = (async () => {
      try {
        const value = await generate<T>({
          prompt: opts.promptFor(id),
          generator: opts.generator,
          schema: opts.schema,
          retries: opts.retries,
          maxTokens: opts.maxTokens,
          cacheKey: id,
          cache: opts.base,
        });
        return value;
      } finally {
        inflight.delete(id);
      }
    })();

    inflight.set(id, run);
    return run;
  }

  return { base: opts.base, getOrGenerate };
}
