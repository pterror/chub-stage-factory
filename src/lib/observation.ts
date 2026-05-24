/*
 * observation.ts — the stage→LLM bridge.
 *
 * WHAT: The stage owns a list of ObservationSources. Each source declares the
 *       sensory channels it speaks on (e.g. "visual", "tactile", "interoceptive"),
 *       a `salience(state)` score, an `available(state)` predicate, and a map
 *       of channel -> { propertyKey -> evaluator(state) }. At assembly time
 *       `assembleObservations(sources, state, opts)` picks, scores with
 *       habituation, sorts by salience, and renders a single structured
 *       payload the stage hands to the LLM via `stageDirections`.
 *
 *       The payload is plain JSON, not prose. It is what the model should
 *       know, not what the model should say. `prose-register.ts` handles the
 *       "how to write it" half.
 *
 * WHY: Rule #9 (the stage emits structured observations; the LLM does prose).
 *       Habituation per source-id (`lastEmittedAt` map + tau) means an
 *       always-on source like "your shoes are tight" doesn't dominate every
 *       turn — its salience decays exponentially after each emission and
 *       recovers when not emitted.
 *
 * SHAPE:
 *   type Channel = string
 *   type Key = string
 *   type Evaluator<S, V = unknown> = (state: S) => V
 *   interface ObservationSource<S> {
 *     id; channels: Channel[];
 *     available?: (state) => boolean;
 *     salience: (state) => number;             // 0..1, before habituation
 *     properties: Record<Channel, Record<Key, Evaluator<S>>>;
 *     habituationTau?: number;                 // half-life in time units
 *   }
 *   interface AssembledObservation { id; channels; salience; values: Record<Channel, Record<Key, V>> }
 *   interface AssembleOptions { now, maxCount?, lastEmittedAt?: Map<id, number> }
 *   assembleObservations(sources, state, opts): AssembledObservation[]
 *   formatObservations(observed): string          // JSON-blocked, LLM-readable
 */

import type { ContextContributor, ObservationContributorOptions } from "./context";
import { observationContributor } from "./context";

export type Channel = string;
export type Key = string;
export type Evaluator<S, V = unknown> = (state: S) => V;

export interface ObservationSource<S> {
  id: string;
  channels: Channel[];
  available?: (state: S) => boolean;
  salience: (state: S) => number;
  properties: Record<Channel, Record<Key, Evaluator<S>>>;
  habituationTau?: number;
}

export interface AssembledObservation {
  id: string;
  channels: Channel[];
  salience: number;
  values: Record<Channel, Record<Key, unknown>>;
}

export interface AssembleOptions {
  now: number;
  maxCount?: number;
  /** Mutable: this function reads previous timestamps and writes new ones. */
  lastEmittedAt?: Map<string, number>;
}

function habituationFactor(now: number, last: number | undefined, tau: number): number {
  if (last === undefined) return 1;
  const dt = Math.max(0, now - last);
  if (tau <= 0) return 1;
  // exponential recovery: 0 right after emission, -> 1 over time
  return 1 - Math.exp(-dt / tau);
}

export function assembleObservations<S>(
  sources: readonly ObservationSource<S>[],
  state: S,
  opts: AssembleOptions,
): AssembledObservation[] {
  const eligible: AssembledObservation[] = [];
  for (const src of sources) {
    if (src.available && !src.available(state)) continue;
    const raw = Math.max(0, Math.min(1, src.salience(state)));
    if (raw === 0) continue;
    const tau = src.habituationTau ?? 0;
    const factor = tau > 0 ? habituationFactor(opts.now, opts.lastEmittedAt?.get(src.id), tau) : 1;
    const salience = raw * factor;
    if (salience === 0) continue;
    const values: Record<Channel, Record<Key, unknown>> = {};
    for (const ch of src.channels) {
      const props = src.properties[ch];
      if (!props) continue;
      values[ch] = {};
      for (const [k, fn] of Object.entries(props)) values[ch][k] = fn(state);
    }
    eligible.push({ id: src.id, channels: [...src.channels], salience, values });
  }
  eligible.sort((a, b) => b.salience - a.salience);
  const out = opts.maxCount ? eligible.slice(0, opts.maxCount) : eligible;
  if (opts.lastEmittedAt) for (const o of out) opts.lastEmittedAt.set(o.id, opts.now);
  return out;
}

/**
 * Render a payload the LLM can read. Single fenced JSON block under a header.
 * The stage typically prepends a short instruction (from prose-register) and
 * appends this to its stageDirections return value.
 */
/** Wrap one or more `ObservationSource`s as a single `ContextContributor`.
 *  Convenience alias for `observationContributor` from `context.ts`,
 *  colocated with the source-side type so stages can import contributor
 *  and sources from one place. Accepts a single source or an array. */
export function asContributor<S = unknown>(
  sources: ObservationSource<S> | readonly ObservationSource<S>[],
  options?: ObservationContributorOptions<S>,
): ContextContributor {
  const list: readonly ObservationSource<S>[] = Array.isArray(sources)
    ? sources
    : [sources as ObservationSource<S>];
  return observationContributor(list, options);
}

export function formatObservations(observed: readonly AssembledObservation[]): string {
  const compact = observed.map((o) => ({
    id: o.id,
    salience: Math.round(o.salience * 100) / 100,
    ...o.values,
  }));
  return `<observations>\n${JSON.stringify(compact, null, 2)}\n</observations>`;
}
