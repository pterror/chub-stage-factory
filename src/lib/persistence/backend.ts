/*
 * persistence/backend.ts — SaveBackend interface + pure combinator wrappers.
 *
 * WHAT: A `SaveBackend` is a key/value store with `load`, `save`, `remove`.
 *       Chub gives us three layers (initState, chatState, messageState); each
 *       can be addressed as a SaveBackend by closing over a getter and a
 *       setter the stage provides on each lifecycle call. Combinators
 *       (`tee`, `debounced`, `rolling`) compose backends without owning state.
 *
 * WHY: A primitive's persistence regime should be selectable by composition,
 *       not by hard-coding which Chub layer it lives in. By making each
 *       layer a SaveBackend, the rest of the persistence stack (Shard,
 *       PersistenceStore) is layer-agnostic and works for any future host
 *       backend (e.g. localStorage during dev, an IndexedDB cache, etc.).
 *
 * SHAPE:
 *   interface SaveBackend {
 *     load(key): Promise<string | null>;
 *     save(key, data): Promise<void>;
 *     remove(key): Promise<void>;
 *   }
 *   initStateBackend(get, set): SaveBackend
 *   chatStateBackend(get, set): SaveBackend
 *   messageStateBackend(get, set): SaveBackend
 *   tee(...backends): SaveBackend
 *   debounced(inner, ms): SaveBackend
 *   rolling(inner, n, prefix): SaveBackend
 */

export interface SaveBackend {
  load(key: string): Promise<string | null>;
  save(key: string, data: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Adapter type the stage gives us on each lifecycle call — a getter and
 *  setter for one of the Chub state layers. The backend stores shard
 *  blobs as keyed entries within that layer's object. */
export type LayerGet = () => Record<string, string | undefined> | null | undefined;
export type LayerSet = (next: Record<string, string | undefined>) => void;

function layerBackend(get: LayerGet, set: LayerSet): SaveBackend {
  return {
    async load(key) {
      const obj = get();
      if (!obj) return null;
      const v = obj[key];
      return v === undefined ? null : v;
    },
    async save(key, data) {
      const obj = (get() ?? {}) as Record<string, string | undefined>;
      const next = { ...obj, [key]: data };
      set(next);
    },
    async remove(key) {
      const obj = (get() ?? {}) as Record<string, string | undefined>;
      if (!(key in obj)) return;
      const next = { ...obj };
      delete next[key];
      set(next);
    },
  };
}

/** Backend backed by Chub's `initState`. initState is set once in load();
 *  writes after that are no-ops at the host level but still update the
 *  local mirror so reads stay consistent within a session. */
export function initStateBackend(get: LayerGet, set: LayerSet): SaveBackend {
  return layerBackend(get, set);
}

/** Backend backed by Chub's `chatState` — persists across the whole chat,
 *  one truth ignoring the message tree. Returned from
 *  beforePrompt/afterResponse via `chatState`. */
export function chatStateBackend(get: LayerGet, set: LayerSet): SaveBackend {
  return layerBackend(get, set);
}

/** Backend backed by Chub's `messageState` — per-message; the host may or
 *  may not fold this along branches when the user swipes. */
export function messageStateBackend(get: LayerGet, set: LayerSet): SaveBackend {
  return layerBackend(get, set);
}

/** Fan out writes to multiple backends. Reads come from the first. */
export function tee(...backends: SaveBackend[]): SaveBackend {
  return {
    async load(key) {
      return backends[0]?.load(key) ?? null;
    },
    async save(key, data) {
      await Promise.all(backends.map((b) => b.save(key, data)));
    },
    async remove(key) {
      await Promise.all(backends.map((b) => b.remove(key)));
    },
  };
}

/** Coalesce writes to the same key within `ms` ms. Reads pass through. */
export function debounced(inner: SaveBackend, ms: number): SaveBackend {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, string>();
  return {
    async load(key) {
      // Honor any pending in-flight write so reads see the latest value.
      if (pending.has(key)) return pending.get(key) ?? null;
      return inner.load(key);
    },
    async save(key, data) {
      pending.set(key, data);
      const existing = timers.get(key);
      if (existing !== undefined) clearTimeout(existing);
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          const v = pending.get(key);
          pending.delete(key);
          if (v !== undefined) void inner.save(key, v);
        }, ms),
      );
    },
    async remove(key) {
      const existing = timers.get(key);
      if (existing !== undefined) {
        clearTimeout(existing);
        timers.delete(key);
      }
      pending.delete(key);
      await inner.remove(key);
    },
  };
}

/** Keep only the most recent `n` keys with the given prefix, pruning oldest
 *  on every save. Useful for rolling autosaves. */
export function rolling(inner: SaveBackend, n: number, prefix: string): SaveBackend {
  const indexKey = `${prefix}__rolling_index`;
  async function getIndex(): Promise<string[]> {
    const raw = await inner.load(indexKey);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as string[];
    } catch {
      return [];
    }
  }
  async function setIndex(keys: string[]): Promise<void> {
    await inner.save(indexKey, JSON.stringify(keys));
  }
  return {
    async load(key) {
      return inner.load(key);
    },
    async save(key, data) {
      await inner.save(key, data);
      const idx = await getIndex();
      const pos = idx.indexOf(key);
      if (pos !== -1) idx.splice(pos, 1);
      idx.push(key);
      while (idx.length > n) {
        const old = idx.shift();
        if (old !== undefined) await inner.remove(old);
      }
      await setIndex(idx);
    },
    async remove(key) {
      await inner.remove(key);
      const idx = await getIndex();
      const pos = idx.indexOf(key);
      if (pos !== -1) {
        idx.splice(pos, 1);
        await setIndex(idx);
      }
    },
  };
}
