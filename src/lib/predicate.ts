/*
 * predicate.ts — queryable, serializable predicate DSL.
 *
 * WHAT: A tagged-union `Predicate<S>` that describes "is this true right now"
 *       in pure data. Branches cover the conditions every game shape repeats:
 *       a tag on an actor, a stat compared to a value (or its tier),
 *       inventory possession, location, pairwise actor relations,
 *       time-since an event, a world-flag, and boolean composition. A
 *       `custom` escape hatch lets a stage author drop in arbitrary logic
 *       at the cost of JSON round-tripping (a `customs` registry restores it
 *       on load if the stage re-supplies the function under the same id).
 *
 *       Targets resolve via a `Refs` dict at evaluation time. Predicates
 *       declare role-name references (`"self"`, `"partner"`, `"player"`, or
 *       `{ id }`); the evaluator looks the role up and passes the entity to
 *       a small set of resolver hooks (`getTag`, `getStat`, `hasItem`, etc.)
 *       that the caller supplies. The predicate stays generic over what an
 *       "actor" is — Actor instances, plain records, or stage-specific
 *       bundles all work.
 *
 * WHY: Surfaced from the breeding-sim discussion: every "X% chance under Y
 *      conditions" mechanic across the 20-shape catalog wants the same
 *      shape. A flat `mutationRate` parameter is the lazy framing; the real
 *      primitive is conditional probabilistic triggers, and triggers need
 *      a serializable predicate DSL underneath them.
 *
 *      Pure-data branches serialize cleanly (Shard-able like everything
 *      else); the `custom` branch is the documented escape hatch with a
 *      serialization warning. State-dependent `(state) => boolean` would
 *      have been simpler but would also have collapsed the queryable /
 *      introspectable / shardable surface that makes the DSL worth shipping.
 *
 * SHAPE:
 *   type ActorRef = "self" | "partner" | "player" | { id: string }
 *   interface Refs<A>
 *     { self?: A; partner?: A; player?: A; byId?: (id) => A | undefined }
 *   interface Resolvers<S, A>
 *     { getTag?(actor, tag, state); getStat?(actor, name, state): number;
 *       getStatTier?(actor, name, state): string;
 *       hasItem?(actor, item, state): number;
 *       getLocation?(actor, state): string | undefined;
 *       getRelation?(subject, object, relation, state): number;
 *       sinceEvent?(event, state): number;       // ms since
 *       getFlag?(flag, state): unknown;
 *       customs?: Record<id, (state, refs) => boolean> }
 *   type Predicate<S>
 *     | { kind: "tag-on"; target; tag }
 *     | { kind: "stat"; target; stat; op; value }
 *     | { kind: "stat-tier"; target; stat; tier }
 *     | { kind: "has-item"; target; item; count? }
 *     | { kind: "located-at"; target; location }
 *     | { kind: "actor-relation"; subject; object; relation; op?; value? }
 *     | { kind: "since"; event; op; duration }
 *     | { kind: "world-flag"; flag; value? }
 *     | { kind: "and"; clauses }
 *     | { kind: "or"; clauses }
 *     | { kind: "not"; inner }
 *     | { kind: "custom"; id }
 *   evaluate<S, A>(p, state, refs, resolvers): boolean
 *   evaluateAll<S, A>(ps, state, refs, resolvers): boolean
 */

export type ActorRef =
  | "self"
  | "partner"
  | "player"
  | { id: string };

export type CompareOp = ">" | "<" | "==" | "!=" | ">=" | "<=";

export type Predicate<S = unknown> =
  | { kind: "tag-on"; target: ActorRef; tag: string }
  | { kind: "stat"; target: ActorRef; stat: string; op: CompareOp; value: number }
  | { kind: "stat-tier"; target: ActorRef; stat: string; tier: string }
  | { kind: "has-item"; target: ActorRef; item: string; count?: number }
  | { kind: "located-at"; target: ActorRef; location: string }
  | {
      kind: "actor-relation";
      subject: ActorRef;
      object: ActorRef;
      relation: string;
      op?: CompareOp;
      value?: number;
    }
  | { kind: "since"; event: string; op: "<" | ">"; duration: number }
  | { kind: "world-flag"; flag: string; value?: unknown }
  | { kind: "and"; clauses: Predicate<S>[] }
  | { kind: "or"; clauses: Predicate<S>[] }
  | { kind: "not"; inner: Predicate<S> }
  | { kind: "custom"; id: string };

export interface Refs<A = unknown> {
  self?: A;
  partner?: A;
  player?: A;
  byId?: (id: string) => A | undefined;
}

export interface Resolvers<S = unknown, A = unknown> {
  getTag?: (actor: A, tag: string, state: S) => boolean;
  getStat?: (actor: A, stat: string, state: S) => number | undefined;
  getStatTier?: (actor: A, stat: string, state: S) => string | undefined;
  hasItem?: (actor: A, item: string, state: S) => number;
  getLocation?: (actor: A, state: S) => string | undefined;
  getRelation?: (subject: A, object: A, relation: string, state: S) => number | undefined;
  sinceEvent?: (event: string, state: S) => number | undefined;
  getFlag?: (flag: string, state: S) => unknown;
  /** Function bodies for `{ kind: "custom"; id }`. Caller re-supplies these
   *  on load (predicates serialize id-only). */
  customs?: Record<string, (state: S, refs: Refs<A>) => boolean>;
}

function resolveRef<A>(ref: ActorRef, refs: Refs<A>): A | undefined {
  if (typeof ref === "string") return refs[ref];
  return refs.byId?.(ref.id);
}

function compare(a: number, op: CompareOp, b: number): boolean {
  switch (op) {
    case ">": return a > b;
    case "<": return a < b;
    case "==": return a === b;
    case "!=": return a !== b;
    case ">=": return a >= b;
    case "<=": return a <= b;
  }
}

export function evaluate<S = unknown, A = unknown>(
  p: Predicate<S>,
  state: S,
  refs: Refs<A>,
  resolvers: Resolvers<S, A> = {},
): boolean {
  switch (p.kind) {
    case "and":
      return p.clauses.every((c) => evaluate(c, state, refs, resolvers));
    case "or":
      return p.clauses.some((c) => evaluate(c, state, refs, resolvers));
    case "not":
      return !evaluate(p.inner, state, refs, resolvers);
    case "tag-on": {
      const a = resolveRef(p.target, refs);
      if (a === undefined || !resolvers.getTag) return false;
      return resolvers.getTag(a, p.tag, state);
    }
    case "stat": {
      const a = resolveRef(p.target, refs);
      if (a === undefined || !resolvers.getStat) return false;
      const v = resolvers.getStat(a, p.stat, state);
      if (v === undefined) return false;
      return compare(v, p.op, p.value);
    }
    case "stat-tier": {
      const a = resolveRef(p.target, refs);
      if (a === undefined || !resolvers.getStatTier) return false;
      return resolvers.getStatTier(a, p.stat, state) === p.tier;
    }
    case "has-item": {
      const a = resolveRef(p.target, refs);
      if (a === undefined || !resolvers.hasItem) return false;
      const n = resolvers.hasItem(a, p.item, state);
      return n >= (p.count ?? 1);
    }
    case "located-at": {
      const a = resolveRef(p.target, refs);
      if (a === undefined || !resolvers.getLocation) return false;
      return resolvers.getLocation(a, state) === p.location;
    }
    case "actor-relation": {
      const s = resolveRef(p.subject, refs);
      const o = resolveRef(p.object, refs);
      if (s === undefined || o === undefined || !resolvers.getRelation) return false;
      const v = resolvers.getRelation(s, o, p.relation, state);
      if (v === undefined) return false;
      if (p.op === undefined || p.value === undefined) return true; // relation exists
      return compare(v, p.op, p.value);
    }
    case "since": {
      if (!resolvers.sinceEvent) return false;
      const dt = resolvers.sinceEvent(p.event, state);
      if (dt === undefined) return false;
      return compare(dt, p.op, p.duration);
    }
    case "world-flag": {
      if (!resolvers.getFlag) return false;
      const v = resolvers.getFlag(p.flag, state);
      return p.value === undefined ? Boolean(v) : v === p.value;
    }
    case "custom": {
      const fn = resolvers.customs?.[p.id];
      if (!fn) return false;
      return fn(state, refs);
    }
  }
}

/** AND-of-predicates convenience. Empty list is vacuously true. */
export function evaluateAll<S = unknown, A = unknown>(
  ps: readonly Predicate<S>[],
  state: S,
  refs: Refs<A>,
  resolvers: Resolvers<S, A> = {},
): boolean {
  return ps.every((p) => evaluate(p, state, refs, resolvers));
}

/** Compact builders for the common shapes. Optional sugar; the raw object
 *  form is the canonical surface. */
export const P = {
  tagOn: (target: ActorRef, tag: string): Predicate => ({ kind: "tag-on", target, tag }),
  stat: (target: ActorRef, stat: string, op: CompareOp, value: number): Predicate => ({
    kind: "stat", target, stat, op, value,
  }),
  statTier: (target: ActorRef, stat: string, tier: string): Predicate => ({
    kind: "stat-tier", target, stat, tier,
  }),
  hasItem: (target: ActorRef, item: string, count?: number): Predicate => ({
    kind: "has-item", target, item, count,
  }),
  locatedAt: (target: ActorRef, location: string): Predicate => ({
    kind: "located-at", target, location,
  }),
  relation: (
    subject: ActorRef, object: ActorRef, relation: string, op?: CompareOp, value?: number,
  ): Predicate => ({ kind: "actor-relation", subject, object, relation, op, value }),
  since: (event: string, op: "<" | ">", duration: number): Predicate => ({
    kind: "since", event, op, duration,
  }),
  flag: (flag: string, value?: unknown): Predicate => ({ kind: "world-flag", flag, value }),
  and: (...clauses: Predicate[]): Predicate => ({ kind: "and", clauses }),
  or: (...clauses: Predicate[]): Predicate => ({ kind: "or", clauses }),
  not: (inner: Predicate): Predicate => ({ kind: "not", inner }),
  custom: (id: string): Predicate => ({ kind: "custom", id }),
};
