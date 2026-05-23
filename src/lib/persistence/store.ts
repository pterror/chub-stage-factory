/*
 * persistence/store.ts — Shard + PersistenceStore orchestrator.
 *
 * WHAT: A `Shard` bundles one stateful instance (wrapped via
 *       `asSaveable`) with its backend (which Chub layer) and history
 *       (snapshot/diff/forbidBranching/noHistory). A `PersistenceStore`
 *       holds many shards keyed by name and orchestrates `load`/`commit`/
 *       `saveSlot`/`loadSlot`/`navigateAll` against them as a unit.
 *
 * WHY: Different mechanics belong on different Chub layers with different
 *       branch semantics — and a single stage typically holds several
 *       primitives, each with its own answer. PersistenceStore turns the
 *       "wire each one separately in setState + beforePrompt + afterResponse"
 *       boilerplate into one `await store.commit()` and one `await store.load(s)`.
 *
 * SHAPE:
 *   interface SaveableState<M> { serialize(): M; deserialize(data: M): void; }
 *   asSaveable<T, M>(instance, toJSON, fromJSON): SaveableState<M>
 *   interface Shard<M> { name; state; backend; history; }
 *   class PersistenceStore {
 *     constructor(shards)
 *     load(): Promise<void>
 *     commit(): Promise<void>
 *     saveSlot(name): Promise<void>
 *     loadSlot(name): Promise<void>
 *     listSlots(): Promise<string[]>
 *     navigateAll(idMap): void
 *   }
 */

import type { SaveBackend } from "./backend";
import type { History, MomentId } from "./history";

export interface SaveableState<M> {
  serialize(): M;
  deserialize(data: M): void;
}

/** Bridge an instance with static `toJSON` / `fromJSON` to SaveableState.
 *  `fromJSON` returns a new instance; we copy its fields back into the
 *  original via Object.assign so external references stay valid. This
 *  is a deliberate API contract: primitives are plain classes with
 *  enumerable own fields. */
export function asSaveable<T extends object, M>(
  instance: T,
  toJSON: (i: T) => M,
  fromJSON: (data: M) => T,
): SaveableState<M> {
  return {
    serialize: () => toJSON(instance),
    deserialize: (data: M) => {
      const fresh = fromJSON(data);
      // Wipe own enumerable keys that aren't on the fresh instance.
      for (const k of Object.keys(instance)) {
        if (!Object.prototype.hasOwnProperty.call(fresh, k)) delete (instance as Record<string, unknown>)[k];
      }
      Object.assign(instance as Record<string, unknown>, fresh as Record<string, unknown>);
    },
  };
}

export interface Shard<M> {
  name: string;
  state: SaveableState<M>;
  backend: SaveBackend;
  history: History<M>;
}

const SLOT_PREFIX = "__slot__";

export class PersistenceStore {
  readonly shards: Record<string, Shard<unknown>>;

  constructor(shards: Record<string, Shard<unknown>>) {
    this.shards = shards;
  }

  /** Hydrate every shard from its backend. Call once in load() and again
   *  in setState() so swipes pull the per-message blob back into the live
   *  instance. Silently skips shards whose backend has no entry yet. */
  async load(): Promise<void> {
    for (const [name, shard] of Object.entries(this.shards)) {
      const raw = await shard.backend.load(name);
      if (raw === null || raw === undefined) continue;
      try {
        const parsed = JSON.parse(raw);
        shard.state.deserialize(parsed);
        // Seed history with the loaded state so it becomes the cursor's payload.
        shard.history.commit(parsed);
      } catch {
        // Corrupt entry — skip rather than crash the stage.
      }
    }
  }

  /** Serialize every shard, commit to its history, and write to its
   *  backend. Call in beforePrompt and afterResponse. */
  async commit(): Promise<void> {
    for (const [name, shard] of Object.entries(this.shards)) {
      const payload = shard.state.serialize();
      shard.history.commit(payload);
      await shard.backend.save(name, JSON.stringify(payload));
    }
  }

  /** Save the current state of every shard under a named slot. The slot
   *  blob is stored in each shard's own backend, prefixed. */
  async saveSlot(name: string): Promise<void> {
    const key = SLOT_PREFIX + name;
    for (const [shardName, shard] of Object.entries(this.shards)) {
      const payload = shard.state.serialize();
      await shard.backend.save(`${key}__${shardName}`, JSON.stringify(payload));
    }
    // Track slot names in a meta entry on the first shard's backend.
    const firstBackend = Object.values(this.shards)[0]?.backend;
    if (firstBackend) {
      const idx = await this.listSlots();
      if (!idx.includes(name)) {
        idx.push(name);
        await firstBackend.save("__slot_index__", JSON.stringify(idx));
      }
    }
  }

  /** Restore every shard from a named slot. Missing slot data for a shard
   *  leaves that shard untouched. */
  async loadSlot(name: string): Promise<void> {
    const key = SLOT_PREFIX + name;
    for (const [shardName, shard] of Object.entries(this.shards)) {
      const raw = await shard.backend.load(`${key}__${shardName}`);
      if (raw === null || raw === undefined) continue;
      try {
        const parsed = JSON.parse(raw);
        shard.state.deserialize(parsed);
        shard.history.commit(parsed);
      } catch {
        /* skip corrupt */
      }
    }
  }

  async listSlots(): Promise<string[]> {
    const firstBackend = Object.values(this.shards)[0]?.backend;
    if (!firstBackend) return [];
    const raw = await firstBackend.load("__slot_index__");
    if (!raw) return [];
    try {
      return JSON.parse(raw) as string[];
    } catch {
      return [];
    }
  }

  /** Navigate every shard's history to the given moment id and pull the
   *  reconstructed payload back into the live instance. Use when handling
   *  user-driven branch jumps that supply per-shard ids. */
  navigateAll(idMap: Record<string, MomentId>): void {
    for (const [name, id] of Object.entries(idMap)) {
      const shard = this.shards[name];
      if (!shard) continue;
      shard.history.navigate(id);
      const s = shard.history.state();
      if (s !== undefined) shard.state.deserialize(s as never);
    }
  }
}
