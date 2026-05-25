// @experimental — used by 0-1 callers; API may change.
/*
 * trigger.ts — conditional probabilistic triggers + TriggerSet.
 *
 * WHAT: A `ConditionalTrigger<S, E>` couples a `Predicate<S>` gate, a fire
 *       probability (constant, modifier-list, or escape-hatch function), an
 *       opaque `effect: E` payload, optional cooldown (ms), and optional
 *       one-shot flag. `TriggerSet` owns a list of triggers and per-id
 *       cooldown / fired-flag state. `evaluate(state, refs, resolvers, rng)`
 *       walks the list, checks the predicate, rolls against the probability,
 *       records cooldown / oneShot, and returns the effects that fired.
 *       The caller applies the effects — the primitive doesn't legislate
 *       what an effect does.
 *
 *       Probability is either:
 *         - `number`                                            (serializable)
 *         - `{ base: number; modifiers: ProbabilityModifier[] }` (serializable)
 *         - `(state: S) => number`                              (escape hatch,
 *                                                                does not
 *                                                                serialize)
 *       Modifiers are predicate-gated multiplicative adjustments; they
 *       round-trip through JSON, the function form does not.
 *
 *       `toJSON` persists only the cooldown / fired-flag state. Triggers
 *       themselves are stage-author authored data; `fromJSON(triggers, state)`
 *       reattaches the triggers to the persisted firing-state.
 *
 * WHY: Every game shape in the 20-shape catalog has a "this happens when X
 *      under Y conditions with Z chance" mechanic — faction encounters,
 *      grue attacks, slave escape attempts, morning sickness events, fire
 *      spread per tick. The TriggerSet primitive collapses all of them into
 *      "declare an array of triggers, call `evaluate` per tick, dispatch the
 *      returned effects." Composes natively with Timeline (push fired
 *      effects), Scheduler (drive evaluate on tick), and Predicate (the gate).
 *
 * SHAPE:
 *   interface ProbabilityModifier { when; mult }
 *   type Probability<S> = number | { base; modifiers } | ((state) => number)
 *   interface ConditionalTrigger<S, E>
 *     { id; when: Predicate<S>; probability: Probability<S>; effect: E;
 *       cooldown?; oneShot? }
 *   interface TriggerSetState
 *     { lastFiredAt: Record<id, number>; fired: Record<id, true> }
 *   class TriggerSet<S, E, A>
 *     constructor(triggers, resolvers?)
 *     triggers; resolvers
 *     evaluate(state, refs, rng, now?): E[]
 *     reset(id?): void
 *     toJSON(): TriggerSetState
 *     static fromJSON(triggers, data, resolvers?): TriggerSet
 */

import { type Predicate, type Refs, type Resolvers, evaluate as evalPredicate } from "./predicate";
import type { RngStream } from "./rng";

export interface ProbabilityModifier<S = unknown> {
  /** Predicate that must hold for `mult` to apply. */
  when: Predicate<S>;
  /** Multiplied into the base probability. */
  mult: number;
}

export type Probability<S = unknown> =
  | number
  | { base: number; modifiers: ProbabilityModifier<S>[] }
  | ((state: S) => number);

export interface ConditionalTrigger<S = unknown, E = unknown> {
  id: string;
  when: Predicate<S>;
  probability: Probability<S>;
  effect: E;
  /** Milliseconds. After firing at time T, won't fire again until T+cooldown. */
  cooldown?: number;
  /** Fires at most once across the lifetime of the TriggerSet. */
  oneShot?: boolean;
}

export interface TriggerSetState {
  lastFiredAt: Record<string, number>;
  fired: Record<string, true>;
}

function computeProbability<S, A>(
  prob: Probability<S>,
  state: S,
  refs: Refs<A>,
  resolvers: Resolvers<S, A>,
): number {
  if (typeof prob === "number") return prob;
  if (typeof prob === "function") return prob(state);
  let p = prob.base;
  for (const m of prob.modifiers) {
    if (evalPredicate(m.when, state, refs, resolvers)) p *= m.mult;
  }
  return p;
}

export class TriggerSet<S = unknown, E = unknown, A = unknown> {
  triggers: ConditionalTrigger<S, E>[];
  resolvers: Resolvers<S, A>;
  private lastFiredAt: Map<string, number> = new Map();
  private fired: Set<string> = new Set();

  constructor(triggers: ConditionalTrigger<S, E>[] = [], resolvers: Resolvers<S, A> = {}) {
    this.triggers = triggers;
    this.resolvers = resolvers;
  }

  /** Evaluate every trigger; return the effects that fired this call. */
  evaluate(state: S, refs: Refs<A>, rng: RngStream, now: number = Date.now()): E[] {
    const out: E[] = [];
    for (const t of this.triggers) {
      if (t.oneShot && this.fired.has(t.id)) continue;
      if (t.cooldown !== undefined) {
        const last = this.lastFiredAt.get(t.id);
        if (last !== undefined && now - last < t.cooldown) continue;
      }
      if (!evalPredicate(t.when, state, refs, this.resolvers)) continue;
      const p = computeProbability(t.probability, state, refs, this.resolvers);
      if (p <= 0) continue;
      if (p < 1 && rng.float() >= p) continue;
      out.push(t.effect);
      this.lastFiredAt.set(t.id, now);
      if (t.oneShot) this.fired.add(t.id);
    }
    return out;
  }

  /** Clear cooldown + fired state for one id, or all if no arg. */
  reset(id?: string): void {
    if (id === undefined) {
      this.lastFiredAt.clear();
      this.fired.clear();
      return;
    }
    this.lastFiredAt.delete(id);
    this.fired.delete(id);
  }

  toJSON(): TriggerSetState {
    const lastFiredAt: Record<string, number> = {};
    for (const [k, v] of this.lastFiredAt) lastFiredAt[k] = v;
    const fired: Record<string, true> = {};
    for (const id of this.fired) fired[id] = true;
    return { lastFiredAt, fired };
  }

  static fromJSON<S, E, A>(
    triggers: ConditionalTrigger<S, E>[],
    data: TriggerSetState,
    resolvers: Resolvers<S, A> = {},
  ): TriggerSet<S, E, A> {
    const ts = new TriggerSet<S, E, A>(triggers, resolvers);
    for (const [k, v] of Object.entries(data.lastFiredAt ?? {})) ts.lastFiredAt.set(k, v);
    for (const id of Object.keys(data.fired ?? {})) ts.fired.add(id);
    return ts;
  }
}
