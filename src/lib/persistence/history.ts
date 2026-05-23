/*
 * persistence/history.ts — tree-aware undo/branch history strategies.
 *
 * WHAT: A `History<M>` is a DAG-of-moments keyed by MomentId with one
 *       cursor moment marking "now". `commit(payload)` adds a child of
 *       the cursor; `navigate(id)` moves the cursor; `state()` reconstructs
 *       the current state. Strategies vary along two axes: storage
 *       (snapshot vs diff) and shape (tree vs linear).
 *
 * WHY: Chub's message tree is a tree by design — user swipes create
 *       sibling branches. A stateful primitive that wants per-branch state
 *       (un-use the potion if you re-swipe the same prompt) needs a tree
 *       history; a primitive that wants "canon" state regardless of branch
 *       (TF body doesn't un-transform via swipe) wraps a tree history in
 *       `forbidBranching` so commits collapse onto the trunk.
 *
 * SHAPE:
 *   type MomentId = string;
 *   interface Moment<M> { id; parentId?; payload: M | Diff<M> }
 *   interface History<M> {
 *     moments: Map<MomentId, Moment<M>>;
 *     cursor: MomentId;
 *     commit(payload): MomentId;
 *     navigate(id): void;
 *     state(): M;
 *     children(id?): MomentId[];
 *     parent(id?): MomentId | undefined;
 *     siblings(id?): MomentId[];
 *     root(): MomentId;
 *   }
 *   snapshotHistory<M>(): History<M>
 *   diffHistory<M>(base): History<M>
 *   forbidBranching(h): History<M>      — overwrites cursor instead of branching
 *   bounded(h, n): History<M>           — prunes path-length > n
 *   persisted(h, backend, key): History — autosaves payload on commit
 *   noHistory<M>(): History<M>          — single moment, no past
 */

import type { SaveBackend } from "./backend";

export type MomentId = string;

export interface Moment<M> {
  id: MomentId;
  parentId?: MomentId;
  payload: M;
}

export interface History<M> {
  /** All moments ever committed (modulo pruning). Direct access for
   *  inspection or serialization. Treat as read-only at call sites. */
  readonly moments: Map<MomentId, Moment<M>>;
  /** The "now" moment id — what `state()` reconstructs. */
  readonly cursor: MomentId;
  /** Add a new moment as child of cursor; move cursor to it. */
  commit(payload: M): MomentId;
  /** Move cursor to an existing moment. Throws if id unknown. */
  navigate(id: MomentId): void;
  /** Reconstruct the current state. For snapshotHistory this is O(1);
   *  for diffHistory it walks back to the nearest snapshot. */
  state(): M;
  children(id?: MomentId): MomentId[];
  parent(id?: MomentId): MomentId | undefined;
  siblings(id?: MomentId): MomentId[];
  root(): MomentId;
}

let _idCounter = 0;
function newId(): MomentId {
  _idCounter += 1;
  return `m-${Date.now().toString(36)}-${_idCounter.toString(36)}`;
}

function clone<M>(v: M): M {
  return v === undefined || v === null ? v : (JSON.parse(JSON.stringify(v)) as M);
}

/** Snapshot-per-moment tree history. Memory: O(moments * |state|). */
export function snapshotHistory<M>(): History<M> {
  const moments = new Map<MomentId, Moment<M>>();
  const rootId = newId();
  // Sentinel — the cursor starts "empty". First commit overwrites this.
  const rootMoment: Moment<M> = { id: rootId, payload: undefined as unknown as M };
  moments.set(rootId, rootMoment);

  const self: History<M> = {
    moments,
    cursor: rootId,
    commit(payload: M): MomentId {
      // First commit overwrites the empty root sentinel so the root carries
      // real state. Subsequent commits append children of cursor.
      const cur = self.moments.get(self.cursor);
      if (cur && cur.id === rootId && cur.payload === (undefined as unknown as M)) {
        cur.payload = clone(payload);
        return cur.id;
      }
      const id = newId();
      const m: Moment<M> = { id, parentId: self.cursor, payload: clone(payload) };
      self.moments.set(id, m);
      (self as { cursor: MomentId }).cursor = id;
      return id;
    },
    navigate(id: MomentId): void {
      if (!self.moments.has(id)) throw new Error(`unknown moment ${id}`);
      (self as { cursor: MomentId }).cursor = id;
    },
    state(): M {
      const m = self.moments.get(self.cursor);
      if (!m) throw new Error(`no moment at cursor ${self.cursor}`);
      return clone(m.payload);
    },
    children(id?: MomentId): MomentId[] {
      const target = id ?? self.cursor;
      const out: MomentId[] = [];
      for (const m of self.moments.values()) if (m.parentId === target) out.push(m.id);
      return out;
    },
    parent(id?: MomentId): MomentId | undefined {
      const m = self.moments.get(id ?? self.cursor);
      return m?.parentId;
    },
    siblings(id?: MomentId): MomentId[] {
      const target = id ?? self.cursor;
      const m = self.moments.get(target);
      if (!m || !m.parentId) return [];
      return self.children(m.parentId).filter((c) => c !== target);
    },
    root(): MomentId {
      return rootId;
    },
  };
  return self;
}

/** Diff history. The base is held as the root snapshot; each moment stores
 *  a shallow object diff against its parent. State reconstruction walks
 *  parents back to the root. Useful when state is large but per-moment
 *  changes are small (effects ticks, single inventory updates). */
export function diffHistory<M extends object>(base: M): History<M> {
  interface DiffMoment {
    id: MomentId;
    parentId?: MomentId;
    /** Root carries a full snapshot; non-root moments carry partial. */
    snapshot?: M;
    changes?: Partial<M>;
    /** Keys removed since parent (set to "deleted" sentinel on reconstruct). */
    removed?: string[];
  }
  const moments = new Map<MomentId, DiffMoment>();
  const rootId = newId();
  moments.set(rootId, { id: rootId, snapshot: clone(base) });
  let cursor = rootId;

  function reconstruct(id: MomentId): M {
    const chain: DiffMoment[] = [];
    let cur: DiffMoment | undefined = moments.get(id);
    while (cur) {
      chain.unshift(cur);
      cur = cur.parentId ? moments.get(cur.parentId) : undefined;
    }
    const out = clone(chain[0]!.snapshot!) as Record<string, unknown>;
    for (let i = 1; i < chain.length; i++) {
      const m = chain[i]!;
      if (m.changes) for (const k of Object.keys(m.changes)) out[k] = clone((m.changes as Record<string, unknown>)[k]);
      if (m.removed) for (const k of m.removed) delete out[k];
    }
    return out as M;
  }

  function diff(a: M, b: M): { changes: Partial<M>; removed: string[] } {
    const ar = a as unknown as Record<string, unknown>;
    const br = b as unknown as Record<string, unknown>;
    const changes: Record<string, unknown> = {};
    const removed: string[] = [];
    for (const k of Object.keys(br)) {
      if (JSON.stringify(ar[k]) !== JSON.stringify(br[k])) changes[k] = br[k];
    }
    for (const k of Object.keys(ar)) if (!(k in br)) removed.push(k);
    return { changes: changes as Partial<M>, removed };
  }

  // Public surface — match snapshotHistory's. We project DiffMoment to
  // the Moment<M> shape lazily for `moments` reads (so callers see a
  // uniform interface) by materializing each.
  const projected = new Map<MomentId, Moment<M>>();
  function refresh(): void {
    projected.clear();
    for (const id of moments.keys()) projected.set(id, { id, parentId: moments.get(id)!.parentId, payload: reconstruct(id) });
  }
  refresh();

  const self: History<M> = {
    get moments() {
      // Materialize lazily on each access so commits/navigates stay cheap.
      return projected;
    },
    get cursor() {
      return cursor;
    },
    commit(payload: M): MomentId {
      // First commit overwrites the sentinel root with the real snapshot.
      const root = moments.get(rootId)!;
      if (cursor === rootId && JSON.stringify(root.snapshot) === JSON.stringify(base)) {
        root.snapshot = clone(payload);
        refresh();
        return rootId;
      }
      const parent = moments.get(cursor)!;
      const parentState = reconstruct(parent.id);
      const { changes, removed } = diff(parentState, payload);
      const id = newId();
      moments.set(id, { id, parentId: cursor, changes, removed });
      cursor = id;
      refresh();
      return id;
    },
    navigate(id: MomentId): void {
      if (!moments.has(id)) throw new Error(`unknown moment ${id}`);
      cursor = id;
    },
    state(): M {
      return reconstruct(cursor);
    },
    children(id?: MomentId): MomentId[] {
      const target = id ?? cursor;
      const out: MomentId[] = [];
      for (const m of moments.values()) if (m.parentId === target) out.push(m.id);
      return out;
    },
    parent(id?: MomentId): MomentId | undefined {
      return moments.get(id ?? cursor)?.parentId;
    },
    siblings(id?: MomentId): MomentId[] {
      const target = id ?? cursor;
      const m = moments.get(target);
      if (!m || !m.parentId) return [];
      return self.children(m.parentId).filter((c) => c !== target);
    },
    root(): MomentId {
      return rootId;
    },
  };
  return self;
}

/** Wrap a history so commits always overwrite the cursor moment in place
 *  rather than creating a new child. Use for "canon" state that should
 *  not fork on swipes (TF body, persistent loadout). */
export function forbidBranching<M>(inner: History<M>): History<M> {
  // We piggyback on the inner moments map; we just collapse new commits
  // by navigating back to cursor's parent (or root) and overwriting.
  // Simplest correct impl: overwrite the cursor's payload in place via
  // the moments map, bypassing inner.commit entirely.
  return {
    get moments() {
      return inner.moments;
    },
    get cursor() {
      return inner.cursor;
    },
    commit(payload: M): MomentId {
      const m = inner.moments.get(inner.cursor);
      if (m) {
        // Mutate in place — preserves cursor id, preserves parent chain.
        (m as Moment<M>).payload = clone(payload);
        return m.id;
      }
      return inner.commit(payload);
    },
    navigate: (id) => inner.navigate(id),
    state: () => inner.state(),
    children: (id) => inner.children(id),
    parent: (id) => inner.parent(id),
    siblings: (id) => inner.siblings(id),
    root: () => inner.root(),
  };
}

/** Bound the size of the history tree to roughly `n` moments. On overflow,
 *  prunes the moment with no children that is farthest from the cursor
 *  (and not the root). Cheap-and-correct, not optimal. */
export function bounded<M>(inner: History<M>, n: number): History<M> {
  function prune(): void {
    while (inner.moments.size > n) {
      // Pick a leaf that isn't the cursor or the root, prefer farthest from cursor.
      const root = inner.root();
      const cursor = inner.cursor;
      let victim: MomentId | undefined;
      for (const m of inner.moments.values()) {
        if (m.id === cursor || m.id === root) continue;
        if (inner.children(m.id).length === 0) {
          victim = m.id;
          break;
        }
      }
      if (!victim) break;
      inner.moments.delete(victim);
    }
  }
  return {
    get moments() {
      return inner.moments;
    },
    get cursor() {
      return inner.cursor;
    },
    commit(payload: M): MomentId {
      const id = inner.commit(payload);
      prune();
      return id;
    },
    navigate: (id) => inner.navigate(id),
    state: () => inner.state(),
    children: (id) => inner.children(id),
    parent: (id) => inner.parent(id),
    siblings: (id) => inner.siblings(id),
    root: () => inner.root(),
  };
}

/** Tee history commits to a SaveBackend under `key`. The serialized form
 *  is the cursor's payload only — full tree persistence is left to the
 *  caller (chub bindings handle this for messageState). */
export function persisted<M>(inner: History<M>, backend: SaveBackend, key: string): History<M> {
  return {
    get moments() {
      return inner.moments;
    },
    get cursor() {
      return inner.cursor;
    },
    commit(payload: M): MomentId {
      const id = inner.commit(payload);
      void backend.save(key, JSON.stringify(payload));
      return id;
    },
    navigate(id: MomentId): void {
      inner.navigate(id);
      const s = inner.state();
      void backend.save(key, JSON.stringify(s));
    },
    state: () => inner.state(),
    children: (id) => inner.children(id),
    parent: (id) => inner.parent(id),
    siblings: (id) => inner.siblings(id),
    root: () => inner.root(),
  };
}

/** Single-moment history. Every commit overwrites that moment; navigation
 *  is a no-op. Use for shards that have no meaningful undo (initState RNG
 *  seed, deterministic config). */
export function noHistory<M>(): History<M> {
  const moments = new Map<MomentId, Moment<M>>();
  const rootId = newId();
  const m: Moment<M> = { id: rootId, payload: undefined as unknown as M };
  moments.set(rootId, m);
  return {
    moments,
    cursor: rootId,
    commit(payload: M): MomentId {
      m.payload = clone(payload);
      return rootId;
    },
    navigate(_id: MomentId): void {
      /* no-op */
    },
    state(): M {
      return clone(m.payload);
    },
    children(): MomentId[] {
      return [];
    },
    parent(): MomentId | undefined {
      return undefined;
    },
    siblings(): MomentId[] {
      return [];
    },
    root(): MomentId {
      return rootId;
    },
  };
}
