/*
 * fallback-chain.ts — deterministic grammar first; LLM fallback on
 * miss; LLM with broader context on second miss. This is the explicit
 * design of `intent.ts`'s two-engine surface: `parseIntentSync` runs
 * the grammar, `parseIntent` routes to `LlmFallback.quietCall` on
 * grammar miss. This pattern wraps both layers and adds a second LLM
 * tier with an enriched context prompt.
 *
 * Composes: intent (parseIntent two-engine surface) + generate (second
 * LLM tier) + context (broader scope text).
 *
 * Source: SillyTavern WI vectorized entries falling back to keyword on
 * embedding miss; AID budget-based fallback.
 */

import type { GenerationService } from "@chub-ai/stages-ts";
import type { Intent, LlmFallback, ParseIntentOptions, SynonymTable } from "../../intent";
import { parseIntent, parseIntentSync } from "../../intent";
import type { ComposedSubsystem } from "./types";

export interface FallbackChainOptions {
  generator: GenerationService;
  scope: ReadonlySet<string>;
  synonyms?: SynonymTable;
  /** Enriched context injected into the second-tier prompt (e.g. scene
   *  description, visible objects). */
  broadContext?: string;
  maxTokens?: number;
}

export interface FallbackChainState {
  lastTierUsed: "grammar" | "llm-narrow" | "llm-broad" | null;
}

function buildBroadPrompt(input: string, scope: ReadonlySet<string>, broadContext: string): string {
  const scopeList = [...scope].join(", ") || "(none)";
  return [
    broadContext,
    "",
    `Available objects/exits: ${scopeList}`,
    `The player typed: "${input}"`,
    "",
    "Parse the player's intent into JSON: {\"verb\":\"…\",\"target\":\"…\",\"instrument\":\"…\",\"modifier\":\"…\"}",
    "Use null for absent fields. Reply with ONLY the JSON object or null.",
  ].join("\n");
}

function parseIntentFromJson(text: string): Intent | null {
  const m = /(\{[\s\S]*\}|null)/.exec(text.trim());
  if (!m) return null;
  if (m[1] === "null") return null;
  try {
    const o = JSON.parse(m[1]) as Record<string, unknown>;
    if (!o || typeof o.verb !== "string") return null;
    return {
      verb: o.verb,
      target: typeof o.target === "string" && o.target ? o.target : undefined,
      instrument: typeof o.instrument === "string" && o.instrument ? o.instrument : undefined,
      modifier: typeof o.modifier === "string" && o.modifier ? o.modifier : undefined,
    };
  } catch {
    return null;
  }
}

export function fallbackChainPattern(
  opts: FallbackChainOptions,
): ComposedSubsystem<FallbackChainState> & {
  parse(input: string): Promise<Intent | null>;
} {
  const state: FallbackChainState = { lastTierUsed: null };
  const maxTokens = opts.maxTokens ?? 120;

  // Tier 1: grammar (synchronous, free).
  // Tier 2: LLM narrow (scope list only).
  // Tier 3: LLM broad (full broadContext).
  const narrowFallback: LlmFallback = {
    async quietCall(prompt: string): Promise<string> {
      const resp = await opts.generator.textGen({ prompt, max_tokens: maxTokens });
      return resp?.result ?? "";
    },
  };

  const parseOpts: ParseIntentOptions = {
    synonyms: opts.synonyms,
    fallback: narrowFallback,
  };

  async function parse(input: string): Promise<Intent | null> {
    // Tier 1.
    const grammarResult = parseIntentSync(input, opts.scope, opts.synonyms);
    if (grammarResult !== null) {
      state.lastTierUsed = "grammar";
      return grammarResult;
    }

    // Tier 2: narrow LLM.
    const narrowResult = await parseIntent(input, opts.scope, parseOpts);
    if (narrowResult !== null) {
      state.lastTierUsed = "llm-narrow";
      return narrowResult;
    }

    // Tier 3: broad LLM with enriched context.
    if (!opts.broadContext) {
      state.lastTierUsed = null;
      return null;
    }
    const broadPrompt = buildBroadPrompt(input, opts.scope, opts.broadContext);
    try {
      const resp = await opts.generator.textGen({ prompt: broadPrompt, max_tokens: maxTokens });
      const broadResult = parseIntentFromJson(resp?.result ?? "");
      state.lastTierUsed = broadResult !== null ? "llm-broad" : null;
      return broadResult;
    } catch {
      state.lastTierUsed = null;
      return null;
    }
  }

  return {
    state,
    shards: [{ id: "fallback-chain", value: state }],
    parse,
  };
}
