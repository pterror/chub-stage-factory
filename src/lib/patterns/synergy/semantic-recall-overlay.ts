/*
 * semantic-recall-overlay.ts — SillyTavern Vector Storage / Data Bank
 * RAG composer. Maintains an in-memory vector index over Timeline
 * events; each turn it embeds the current scan text, runs top-K
 * cosine, and emits the recalled events as a context section.
 *
 * Composes: Timeline + Embeddings (top-K cosine over event
 * embeddings) + ContextContributor.
 *
 * Source: SillyTavern Vector Storage / Data Bank RAG.
 */

import type { ContextContributor } from "../../context";
import { estimateTokens } from "../../context";
import type { EmbeddingService } from "../../embeddings";
import type { Timeline } from "../../timeline";
import type { ComposedSubsystem } from "./types";

export interface VectorIndex<E> {
  /** Aligned with `entries`. Indexed by insertion order. */
  vectors: number[][];
  entries: { at: number; payload: E; rendered: string }[];
}

export interface SemanticRecallOverlayOptions<E> {
  source: Timeline<E>;
  embed: EmbeddingService;
  /** Renders a Timeline event into the string fed to embedding +
   *  emitted in the recall section. */
  render?: (event: E, at: number) => string;
  topK?: number;
  scanTextOf?: (state: unknown) => string;
  id?: string;
  priority?: number;
}

export interface SemanticRecallState<E> {
  index: VectorIndex<E>;
}

export function semanticRecallOverlayPattern<E>(
  opts: SemanticRecallOverlayOptions<E>,
): ComposedSubsystem<SemanticRecallState<E>> & { reindex: () => Promise<void> } {
  const topK = opts.topK ?? 5;
  const render = opts.render ?? ((e: E, at: number) => `${at}: ${JSON.stringify(e)}`);
  const scanTextOf =
    opts.scanTextOf ??
    ((s) => (s && typeof (s as { scanText?: string }).scanText === "string"
      ? (s as { scanText: string }).scanText
      : ""));
  const state: SemanticRecallState<E> = { index: { vectors: [], entries: [] } };

  async function reindex(): Promise<void> {
    const events = opts.source.all();
    const rendered = events.map((e) => render(e.payload, e.at));
    const vectors = await opts.embed.embedBatch(rendered);
    state.index.vectors = vectors;
    state.index.entries = events.map((e, i) => ({
      at: e.at,
      payload: e.payload,
      rendered: rendered[i],
    }));
  }

  // Synchronous contributor: emits whatever's currently in the index.
  // The caller arranges `reindex` on a schedule (per N turns / on push).
  let lastQueryVec: number[] | null = null;
  const contributor: ContextContributor = {
    id: opts.id ?? "semantic-recall",
    priority: opts.priority ?? 45,
    contribute(ctx) {
      if (state.index.entries.length === 0) return null;
      const scan = scanTextOf(ctx.stage);
      if (!scan || !lastQueryVec) {
        // No query vector yet — fall back to the most recent K events.
        const recent = state.index.entries.slice(-topK);
        const content = `<recall>\n${recent.map((r) => r.rendered).join("\n")}\n</recall>`;
        return {
          id: opts.id ?? "semantic-recall",
          content,
          tokens: estimateTokens(content),
          optional: true,
        };
      }
      const scored: { i: number; s: number }[] = [];
      for (let i = 0; i < state.index.vectors.length; i++) {
        scored.push({ i, s: opts.embed.similarity(lastQueryVec, state.index.vectors[i]) });
      }
      scored.sort((a, b) => b.s - a.s);
      const top = scored.slice(0, topK).map((x) => state.index.entries[x.i].rendered);
      const content = `<recall>\n${top.join("\n")}\n</recall>`;
      return {
        id: opts.id ?? "semantic-recall",
        content,
        tokens: estimateTokens(content),
        optional: true,
      };
    },
  };

  async function updateQuery(text: string): Promise<void> {
    if (!text) {
      lastQueryVec = null;
      return;
    }
    lastQueryVec = await opts.embed.embed(text);
  }

  return {
    state,
    contributors: [contributor],
    hooks: { reindex, updateQuery } as unknown as ComposedSubsystem<SemanticRecallState<E>>["hooks"],
    reindex,
    shards: [{ id: opts.id ?? "semantic-recall", value: state }],
  };
}
