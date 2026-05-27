/*
 * hierarchical-summarization.ts — per-actor mini-reports then a single
 * aggregate summary. Avoids 50k-token prompts by bounding each LLM
 * call to one actor's slice of the timeline. The aggregate rolls up all
 * mini-reports into a final context contributor.
 *
 * Composes: ActorPool + Timeline (Timeline.summarize) + ContextContributor
 * (context).
 *
 * Source: AI Dungeon Memory System (Memories → Story Summary two-tier);
 * SillyTavern Summarize extension (SYNERGY.md §"hierarchical-
 * summarization").
 */

import type { GenerationService } from "@chub-ai/stages-ts";
import type { ContextContributor } from "../../context";
import { estimateTokens } from "../../context";
import type { Timeline } from "../../timeline";
import { summarize } from "../../timeline";
import type { ActorPool } from "../../actor";
import type { ComposedSubsystem } from "./types";

export interface HierarchicalSummarizationOptions<E> {
  generator: GenerationService;
  pool: ActorPool;
  timeline: Timeline<E>;
  /** Renders one timeline event to text for the per-actor pass. */
  renderEvent: (payload: E, at: number) => string;
  /** Filters timeline events for a specific actor id. */
  eventBelongsTo: (payload: E, actorId: string) => boolean;
  /** Max tokens per per-actor LLM call. Default 200. */
  perActorMaxTokens?: number;
  /** Max tokens for the aggregate summary LLM call. Default 400. */
  aggregateMaxTokens?: number;
  /** Priority of the summary contributor. Default 60. */
  priority?: number;
  id?: string;
}

export interface HierarchicalSummarizationState {
  miniReports: Record<string, string>;
  aggregateSummary: string;
}

export function hierarchicalSummarizationPattern<E>(
  opts: HierarchicalSummarizationOptions<E>,
): ComposedSubsystem<HierarchicalSummarizationState> & {
  runSummary(): Promise<string>;
} {
  const id = opts.id ?? "hierarchical-summary";
  const state: HierarchicalSummarizationState = {
    miniReports: {},
    aggregateSummary: "",
  };
  const perActorMaxTokens = opts.perActorMaxTokens ?? 200;
  const aggregateMaxTokens = opts.aggregateMaxTokens ?? 400;

  async function runSummary(): Promise<string> {
    const actors = opts.pool.all();
    const allEvents = opts.timeline.all();

    // Per-actor pass.
    const miniReports: Record<string, string> = {};
    await Promise.all(
      actors.map(async (actor) => {
        const actorEvents = allEvents.filter((e) =>
          opts.eventBelongsTo(e.payload, actor.id),
        );
        if (actorEvents.length === 0) return;
        const snippet = summarize(actorEvents, opts.renderEvent);
        const prompt = [
          `Summarize ${actor.name}'s recent activity in 1-2 sentences.`,
          "",
          snippet,
        ].join("\n");
        const resp = await opts.generator.textGen({
          prompt,
          max_tokens: perActorMaxTokens,
        });
        miniReports[actor.id] = (resp?.result ?? "").trim();
      }),
    );
    state.miniReports = miniReports;

    // Aggregate pass.
    const reportLines = actors
      .filter((a) => miniReports[a.id])
      .map((a) => `${a.name}: ${miniReports[a.id]}`);
    if (reportLines.length === 0) {
      state.aggregateSummary = "";
      return "";
    }
    const aggregatePrompt = [
      "Combine the following per-character summaries into one cohesive scene summary (2-4 sentences):",
      "",
      ...reportLines,
    ].join("\n");
    const aggResp = await opts.generator.textGen({
      prompt: aggregatePrompt,
      max_tokens: aggregateMaxTokens,
    });
    state.aggregateSummary = (aggResp?.result ?? "").trim();
    return state.aggregateSummary;
  }

  const contributor: ContextContributor = {
    id,
    priority: opts.priority ?? 60,
    contribute() {
      if (!state.aggregateSummary) return null;
      const content = `<summary>\n${state.aggregateSummary}\n</summary>`;
      return { id, content, tokens: estimateTokens(content), optional: true };
    },
  };

  return {
    state,
    contributors: [contributor],
    shards: [{ id, value: state }],
    hooks: { beforeAssemble: async () => { /* caller calls runSummary explicitly */ } },
    runSummary,
  };
}
