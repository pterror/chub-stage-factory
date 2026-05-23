/*
 * registry.ts — id->value catalog with optional placeholder/swap surface.
 *
 * WHAT: `Registry<T>` is a Map-backed catalog keyed by string ids: register,
 *       get, require, has, keys/values/entries/filter. `with(id, value)`
 *       returns a new Registry (immutable variant). `toJSON`/`fromJSON`
 *       round-trip the contents so the registry plugs into a Shard like
 *       every other stateful primitive.
 *
 *       `PlaceholderRegistry<T>` extends Registry with an async-swap
 *       surface: `registerPlaceholder(id, placeholder)` parks a stand-in
 *       value under the id; `replace(id, real)` resolves it. `waitFor(id)`
 *       returns a Promise that resolves with the real value, supporting
 *       the "LLM is currently inventing this thing" flow without forcing
 *       the stage to manage a parallel pending-map.
 *
 * WHY: Stages persistently grow `Record<Id, T>` literals — TFS, MODS,
 *      EFFECT_DEFS, ITEM_DEFS, ACTION_DEFS. Each one re-implements lookup,
 *      iteration, optional indexing-by-tag, and (in dynamic catalog
 *      cases) ad-hoc waiting on async generation. Registry collapses that.
 *      Static usage is zero-behavioral-change over `Record`; dynamic usage
 *      is the case PlaceholderRegistry was added for.
 *
 *      Rule #2 (definition vs instance): a Registry holds Defs. Rule #4
 *      (pure calculator + mutable holder): Registry is the holder; reads
 *      are by-id lookups, not derived state.
 *
 * SHAPE:
 *   class Registry<T>
 *     constructor(initial?: Iterable<[string, T]> | Record<string, T>)
 *     register(id, value): this
 *     get(id): T | undefined
 *     require(id): T               // throws on miss
 *     has(id): boolean
 *     size(): number
 *     delete(id): boolean
 *     keys(): string[]
 *     values(): T[]
 *     entries(): [string, T][]
 *     filter(pred): T[]
 *     map<U>(fn): U[]
 *     with(id, value): Registry<T> // immutable add/overwrite -> new instance
 *     toJSON(): Record<string, T>
 *     static fromJSON<T>(data): Registry<T>
 *
 *   class PlaceholderRegistry<T> extends Registry<T>
 *     registerPlaceholder(id, placeholder): this
 *     replace(id, real): void      // resolves any pending waitFor
 *     isPlaceholder(id): boolean
 *     waitFor(id, timeoutMs?): Promise<T>
 *     toJSON(): Record<string, T>      // placeholder-ness is runtime-only
 *     static fromJSON<T>(data): PlaceholderRegistry<T>
 */

export class Registry<T> {
  protected readonly store: Map<string, T>;

  constructor(initial?: Iterable<[string, T]> | Record<string, T>) {
    if (!initial) {
      this.store = new Map();
    } else if (Symbol.iterator in (initial as object)) {
      this.store = new Map(initial as Iterable<[string, T]>);
    } else {
      this.store = new Map(Object.entries(initial as Record<string, T>));
    }
  }

  register(id: string, value: T): this {
    this.store.set(id, value);
    return this;
  }

  get(id: string): T | undefined {
    return this.store.get(id);
  }

  require(id: string): T {
    const v = this.store.get(id);
    if (v === undefined) throw new Error(`Registry: no entry for id "${id}"`);
    return v;
  }

  has(id: string): boolean {
    return this.store.has(id);
  }

  size(): number {
    return this.store.size;
  }

  delete(id: string): boolean {
    return this.store.delete(id);
  }

  keys(): string[] {
    return Array.from(this.store.keys());
  }

  values(): T[] {
    return Array.from(this.store.values());
  }

  entries(): [string, T][] {
    return Array.from(this.store.entries());
  }

  filter(pred: (value: T, id: string) => boolean): T[] {
    const out: T[] = [];
    for (const [id, v] of this.store) if (pred(v, id)) out.push(v);
    return out;
  }

  map<U>(fn: (value: T, id: string) => U): U[] {
    const out: U[] = [];
    for (const [id, v] of this.store) out.push(fn(v, id));
    return out;
  }

  /** Immutable add/overwrite. Returns a new Registry; original is untouched. */
  with(id: string, value: T): Registry<T> {
    const next = new Registry<T>(this.store);
    next.store.set(id, value);
    return next;
  }

  toJSON(): Record<string, T> {
    const out: Record<string, T> = {};
    for (const [id, v] of this.store) out[id] = v;
    return out;
  }

  static fromJSON<T>(data: Record<string, T>): Registry<T> {
    return new Registry<T>(data);
  }
}

interface Pending<T> {
  resolve: (value: T) => void;
  reject: (err: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class PlaceholderRegistry<T> extends Registry<T> {
  private readonly placeholders = new Set<string>();
  private readonly pending = new Map<string, Pending<T>[]>();

  /** Register a placeholder value under `id`. The id is flagged so callers
   *  can distinguish real entries via `isPlaceholder`. Existing real entries
   *  for the id are overwritten; existing placeholder flags persist. */
  registerPlaceholder(id: string, placeholder: T): this {
    this.store.set(id, placeholder);
    this.placeholders.add(id);
    return this;
  }

  /** Replace a placeholder (or a missing entry) with the real value. Resolves
   *  every pending `waitFor` for the id. No-op resolution if the id was
   *  already real and no waiters are pending. */
  replace(id: string, real: T): void {
    this.store.set(id, real);
    this.placeholders.delete(id);
    const waiters = this.pending.get(id);
    if (waiters) {
      this.pending.delete(id);
      for (const w of waiters) {
        if (w.timer) clearTimeout(w.timer);
        w.resolve(real);
      }
    }
  }

  isPlaceholder(id: string): boolean {
    return this.placeholders.has(id);
  }

  /** Promise of the real value. Resolves immediately if the id is already
   *  real; otherwise resolves on the next `replace(id, ...)` or rejects on
   *  timeout. A 0 / undefined timeout waits indefinitely. */
  waitFor(id: string, timeoutMs?: number): Promise<T> {
    if (this.store.has(id) && !this.placeholders.has(id)) {
      return Promise.resolve(this.store.get(id)!);
    }
    return new Promise<T>((resolve, reject) => {
      const entry: Pending<T> = { resolve, reject };
      if (timeoutMs && timeoutMs > 0) {
        entry.timer = setTimeout(() => {
          const list = this.pending.get(id);
          if (list) {
            const i = list.indexOf(entry);
            if (i >= 0) list.splice(i, 1);
            if (list.length === 0) this.pending.delete(id);
          }
          reject(new Error(`PlaceholderRegistry: waitFor("${id}") timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }
      const list = this.pending.get(id) ?? [];
      list.push(entry);
      this.pending.set(id, list);
    });
  }

  override toJSON(): Record<string, T> {
    // Serialize as a flat record like Registry; placeholder-ness is a runtime
    // flag, not durable state. After load, callers re-register placeholders
    // for any ids the stage knows are still under construction.
    return super.toJSON();
  }

  static override fromJSON<T>(data: Record<string, T>): PlaceholderRegistry<T> {
    return new PlaceholderRegistry<T>(data);
  }
}
