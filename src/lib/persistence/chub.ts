/*
 * persistence/chub.ts — Chub-specific glue: tree history seeded by host swipes,
 *                       and bindStore() which turns a PersistenceStore into a
 *                       trio of setState/beforePrompt/afterResponse handlers.
 *
 * WHAT: `chubTreeHistory<M>()` is the default branch-aware History for
 *       messageState shards. It defers to the host: when Chub calls
 *       `setState(messageState)` on a swipe, the store deserializes the
 *       shard payload from messageState — committing it as a new moment.
 *       Today this is equivalent to a fresh snapshotHistory; the value is
 *       in giving stages a single named history to import.
 *
 *       `bindStore(store)` returns adapters the stage assigns to its
 *       lifecycle methods (or composes into them). Each handler accepts
 *       the lifecycle argument (Message or messageState) and returns a
 *       partial StageResponse with the freshly-serialized shard blobs
 *       merged into chatState + messageState, so Chub persists them.
 *
 * WHY: Once a stage owns a PersistenceStore, every lifecycle method
 *       collapses to three calls (load mutates state on setState, commit
 *       gathers state into the response). bindStore packages that.
 *
 * SHAPE:
 *   chubTreeHistory<M>(): History<M>
 *   bindStore(store): { setState; beforePrompt; afterResponse }
 *
 *   The returned helpers are designed to be COMPOSED with the stage's
 *   own beforePrompt/afterResponse output via mergeResponses() rather
 *   than fully replacing them — the stage typically still wants to add
 *   stageDirections, modifiedMessage, etc.
 */

import type { Message, StageResponse } from "@chub-ai/stages-ts";
import {
  chatStateBackend,
  initStateBackend,
  messageStateBackend,
  type LayerGet,
  type LayerSet,
  type SaveBackend,
} from "./backend";
import { snapshotHistory, noHistory, type History } from "./history";
import { asSaveable, type PersistenceStore, type SaveableState, type Shard } from "./store";

/** Default History strategy for messageState shards under Chub. Today this
 *  is a snapshot tree. The branch-aware behavior relies on Chub calling
 *  setState(messageState) after a swipe / tree jump — see the SDK
 *  declaration in stage.d.ts ("typically called after a jump to a
 *  different place in the chat tree or a swipe"). The local TestRunner
 *  does not exercise this; see /TODO.md "Persistence — open verification
 *  gap" for the fallback we'd wire in if that assumption fails on the
 *  real host. */
export function chubTreeHistory<M>(): History<M> {
  return snapshotHistory<M>();
}

/** Mutable layer mirrors the stage updates on every lifecycle call.
 *  Chub's host gives us snapshots in setState/load and accepts whole
 *  layer objects back in StageResponse, so we accumulate into these
 *  mirrors and surface them. */
interface LayerMirror {
  initState: Record<string, string | undefined> | null;
  chatState: Record<string, string | undefined> | null;
  messageState: Record<string, string | undefined> | null;
}

/** Create the three layer backends + a mutable mirror the stage uses to
 *  build StageResponse. Each shard's backend is one of these. Call once
 *  in the stage constructor (or load()); pass the same instances to the
 *  shards you construct. */
export function createChubLayers(seed?: Partial<LayerMirror>): {
  mirror: LayerMirror;
  initStateBackend: SaveBackend;
  chatStateBackend: SaveBackend;
  messageStateBackend: SaveBackend;
  reset: (next: Partial<LayerMirror>) => void;
} {
  const mirror: LayerMirror = {
    initState: seed?.initState ?? null,
    chatState: seed?.chatState ?? null,
    messageState: seed?.messageState ?? null,
  };
  const mk = (layer: keyof LayerMirror, make: (g: LayerGet, s: LayerSet) => SaveBackend) =>
    make(
      () => mirror[layer] as Record<string, string | undefined> | null,
      (next) => {
        mirror[layer] = next;
      },
    );
  return {
    mirror,
    initStateBackend: mk("initState", initStateBackend),
    chatStateBackend: mk("chatState", chatStateBackend),
    messageStateBackend: mk("messageState", messageStateBackend),
    reset(next) {
      if (next.initState !== undefined) mirror.initState = next.initState;
      if (next.chatState !== undefined) mirror.chatState = next.chatState;
      if (next.messageState !== undefined) mirror.messageState = next.messageState;
    },
  };
}

export interface BindStoreOptions {
  layers: {
    mirror: LayerMirror;
    reset: (next: Partial<LayerMirror>) => void;
  };
}

export interface BoundStore<C, M> {
  /** Call from the stage's setState(state). Resets the messageState
   *  mirror so backend reads see the host's new snapshot, then loads
   *  every shard from its backend. */
  setState: (state: M | null | undefined) => Promise<void>;
  /** Returns the {chatState, messageState} partial to merge into the
   *  beforePrompt response. */
  beforePrompt: (msg: Message) => Promise<Partial<StageResponse<C, M>>>;
  /** Same for afterResponse. */
  afterResponse: (msg: Message) => Promise<Partial<StageResponse<C, M>>>;
  /** Convenience for initial hydration in load() — returns what the stage
   *  should spread into its LoadResponse. */
  initial: () => Promise<{ chatState: C | null; messageState: M | null }>;
}

/** Build the lifecycle handlers for a PersistenceStore. The store's
 *  shards must have been constructed with backends from a `createChubLayers`
 *  instance; `bindStore` takes that same `layers` object to know how to
 *  reset the mirrors on host updates. */
export function bindStore<C, M>(
  store: PersistenceStore,
  opts: BindStoreOptions,
): BoundStore<C, M> {
  const { layers } = opts;

  async function harvest(): Promise<Partial<StageResponse<C, M>>> {
    await store.commit();
    return {
      chatState: (layers.mirror.chatState as C | null) ?? null,
      messageState: (layers.mirror.messageState as M | null) ?? null,
    };
  }

  return {
    async setState(state: M | null | undefined): Promise<void> {
      // Host hands us a fresh messageState snapshot (e.g. on swipe).
      layers.reset({
        messageState: (state ?? null) as Record<string, string | undefined> | null,
      });
      await store.load();
    },
    async beforePrompt(_msg: Message): Promise<Partial<StageResponse<C, M>>> {
      return harvest();
    },
    async afterResponse(_msg: Message): Promise<Partial<StageResponse<C, M>>> {
      return harvest();
    },
    async initial(): Promise<{ chatState: C | null; messageState: M | null }> {
      await store.commit();
      return {
        chatState: (layers.mirror.chatState as C | null) ?? null,
        messageState: (layers.mirror.messageState as M | null) ?? null,
      };
    },
  };
}

/** Convenience: shallow-merge two partial StageResponses. Stages compose
 *  the bound store's output with their own (stageDirections, modifiedMessage,
 *  etc.) using this. */
export function mergeResponses<C, M>(
  a: Partial<StageResponse<C, M>>,
  b: Partial<StageResponse<C, M>>,
): Partial<StageResponse<C, M>> {
  const out: Partial<StageResponse<C, M>> = { ...a, ...b };
  if (a.stageDirections && b.stageDirections)
    out.stageDirections = `${a.stageDirections}\n${b.stageDirections}`;
  if (a.systemMessage && b.systemMessage)
    out.systemMessage = `${a.systemMessage}\n${b.systemMessage}`;
  if (a.error && b.error) out.error = `${a.error}; ${b.error}`;
  if (a.messageState && b.messageState && typeof a.messageState === "object" && typeof b.messageState === "object") {
    out.messageState = { ...(a.messageState as object), ...(b.messageState as object) } as M;
  }
  if (a.chatState && b.chatState && typeof a.chatState === "object" && typeof b.chatState === "object") {
    out.chatState = { ...(a.chatState as object), ...(b.chatState as object) } as C;
  }
  return out;
}

/** Helper for the common stage shape: one Shard constructor entry. */
export function shard<T extends object, M>(
  name: string,
  instance: T,
  toJSON: (i: T) => M,
  fromJSON: (data: M) => T,
  backend: SaveBackend,
  history: History<M>,
): Shard<M> {
  return {
    name,
    state: asSaveable(instance, toJSON, fromJSON),
    backend,
    history,
  };
}

/** Shard a simple `{ n: number }` tick counter with the standard
 *  messageState+chubTreeHistory wiring. Use when the shard contains
 *  ONLY a counter — if it carries extra fields (mode, lastAction, etc.)
 *  use `shard` directly. */
export function counterShard(
  name: string,
  box: { n: number },
  backend: SaveBackend,
  history: History<number>,
): Shard<number> {
  return shard(name, box, (b) => b.n, (n: number) => ({ n }), backend, history);
}

/** Convenience wrapper around `shard` for classes with `toJSON()`.
 *  Calls `instance.toJSON()` automatically; M is inferred from its
 *  return type. Eliminates the `ReturnType<T["toJSON"]>` annotation. */
export function shardOf<T extends { toJSON(): any }>(
  name: string,
  instance: T,
  fromJSON: (data: ReturnType<T["toJSON"]>) => T,
  backend: SaveBackend,
  history: History<ReturnType<T["toJSON"]>>,
): Shard<ReturnType<T["toJSON"]>> {
  return shard(name, instance, (i) => i.toJSON() as ReturnType<T["toJSON"]>, fromJSON, backend, history);
}

/** Group multiple shards that share the same backend and history strategy.
 *  Pass `history` as a FACTORY function (e.g. `chubTreeHistory`, not
 *  `chubTreeHistory()`) — it is called once per entry so each shard gets
 *  its own independent history instance. Omit `history` to get `noHistory`
 *  for all entries. Spread the result into the PersistenceStore constructor.
 *
 * ```ts
 * new PersistenceStore({
 *   ...layerShards(
 *     { backend: this.layers.messageStateBackend, history: chubTreeHistory },
 *     { inv: asSaveableClass(this.inv, (d) => Inventory.fromJSON(d)), tick: tickState },
 *   ),
 *   rng: shardOf("rng", this.rng, (d) => Rng.fromJSON(d), this.layers.initStateBackend, noHistory()),
 * });
 * ```
 */
export function layerShards<K extends string>(
  layer: { backend: SaveBackend; history?: () => History<any> },
  entries: Record<K, SaveableState<any>>,
): Record<K, Shard<any>> {
  const out: Record<string, Shard<any>> = {};
  for (const [name, state] of Object.entries(entries) as [K, SaveableState<any>][]) {
    out[name] = {
      name,
      state,
      backend: layer.backend,
      history: layer.history ? layer.history() : noHistory<any>(),
    };
  }
  return out as Record<K, Shard<any>>;
}
