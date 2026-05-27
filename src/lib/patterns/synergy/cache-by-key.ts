/*
 * cache-by-key.ts — LLM output cached by structural id; once generated
 * the value is served from the registry on subsequent lookups, making
 * repeated references to the same entity free. Thin composition of
 * `generativeRegistry` (which already implements the pattern) exposed
 * as a named synergy pattern with the `ComposedSubsystem` return shape.
 *
 * Composes: generate + PlaceholderRegistry.
 *
 * Source: SillyTavern WI "Selective" entries, NovelAI Lorebook keys,
 * AID Story Cards — universal key → cached LLM payload.
 */

import type { GenerationService } from "@chub-ai/stages-ts";
import { generativeRegistry, type SchemaParser } from "../../generate";
import { PlaceholderRegistry } from "../../registry";
import type { ComposedSubsystem } from "./types";

export interface CacheByKeyOptions<T> {
  generator: GenerationService;
  /** Builds the prompt that generates the value for a given id. */
  promptFor: (id: string) => string;
  /** Parses LLM output into T. */
  schema: SchemaParser<T>;
  /** Optional initial contents — pre-seed with known values. */
  initial?: Iterable<[string, T]> | Record<string, T>;
  maxTokens?: number;
  retries?: number;
  /** Stand-in value shown before generation completes. */
  placeholderFor?: (id: string) => T;
}

export interface CacheByKeyState<T> {
  registry: PlaceholderRegistry<T>;
}

export function cacheByKeyPattern<T>(
  opts: CacheByKeyOptions<T>,
): ComposedSubsystem<CacheByKeyState<T>> & {
  getOrGenerate(id: string): Promise<T>;
} {
  const base = new PlaceholderRegistry<T>(opts.initial);
  const gRegistry = generativeRegistry<T>({
    base,
    generator: opts.generator,
    promptFor: opts.promptFor,
    schema: opts.schema,
    retries: opts.retries,
    maxTokens: opts.maxTokens,
    placeholderFor: opts.placeholderFor,
  });

  const state: CacheByKeyState<T> = { registry: base };

  return {
    state,
    shards: [{ id: "cache-by-key", value: state }],
    getOrGenerate: gRegistry.getOrGenerate.bind(gRegistry),
  };
}
