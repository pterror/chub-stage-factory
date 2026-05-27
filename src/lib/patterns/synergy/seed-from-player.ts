/*
 * seed-from-player.ts — LLM extracts a structured seed/spec from
 * free-form player input; procgen elaborates the seed into a full
 * artifact. Useful for character creation, world generation prompts,
 * and any "describe what you want" flow.
 *
 * Composes: generate (LLM seed extraction with schema) + procgen
 * elaboration callback.
 *
 * Source: Persona / character creation flows — implicit everywhere;
 * not foregrounded as a named pattern in prior art (SYNERGY.md §"seed-
 * from-player").
 */

import type { GenerationService } from "@chub-ai/stages-ts";
import { generate, type SchemaParser } from "../../generate";
import type { ComposedSubsystem } from "./types";

export interface SeedFromPlayerOptions<Seed, Artifact> {
  generator: GenerationService;
  /** Builds the extraction prompt from the player's raw text. Should
   *  ask the LLM to return JSON matching the Seed schema. */
  buildPrompt: (playerInput: string) => string;
  /** Parses the LLM response into a Seed (or null on failure). */
  seedSchema: SchemaParser<Seed>;
  /** Pure procgen elaboration: Seed → Artifact. Runs synchronously. */
  elaborate: (seed: Seed) => Artifact;
  maxTokens?: number;
  retries?: number;
}

export interface SeedFromPlayerState<Seed, Artifact> {
  lastSeed: Seed | null;
  lastArtifact: Artifact | null;
}

export function seedFromPlayerPattern<Seed, Artifact>(
  opts: SeedFromPlayerOptions<Seed, Artifact>,
): ComposedSubsystem<SeedFromPlayerState<Seed, Artifact>> & {
  process(playerInput: string): Promise<Artifact>;
} {
  const state: SeedFromPlayerState<Seed, Artifact> = {
    lastSeed: null,
    lastArtifact: null,
  };

  async function process(playerInput: string): Promise<Artifact> {
    const seed = await generate<Seed>({
      prompt: opts.buildPrompt(playerInput),
      generator: opts.generator,
      schema: opts.seedSchema,
      maxTokens: opts.maxTokens,
      retries: opts.retries,
    });
    const artifact = opts.elaborate(seed);
    state.lastSeed = seed;
    state.lastArtifact = artifact;
    return artifact;
  }

  return {
    state,
    shards: [{ id: "seed-from-player", value: state }],
    process,
  };
}
