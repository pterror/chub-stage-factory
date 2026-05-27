/*
 * persistence/with-persistence.ts — HOC that eliminates the load/setState
 *                                    boilerplate shared by all examples.
 *
 * WHAT: `withPersistence()` returns a class that extends StageBase and wires
 *       the standard three methods:
 *         - load()      → store.load() → bound.initial()
 *                         → { success, initState, chatState, messageState }
 *                         (all three layer values read from this.layers.mirror
 *                          after hydration, so initState and chatState are
 *                          populated for every persistence shape)
 *         - setState()  → bound.setState(state)
 *         - (beforePrompt / afterResponse are inherited helpers via `bound`)
 *
 *       The subclass uses `this.store` and `this.bound` directly and only
 *       needs to implement beforePrompt, afterResponse, and render.
 *
 * WHY: The five-line load()/setState() block is copy-pasted in every
 *      example that uses the persistence pattern.  The original HOC hardcoded
 *      `initState: null` and read `chatState` only from `bound.initial()`,
 *      which broke examples that seed an initState shard (physics,
 *      realtime-combat, composite-showcase) or carry a non-null chatState
 *      (composite-showcase). The fix: read all three mirrors after store.load()
 *      + bound.initial() — the mirrors are populated at that point regardless
 *      of which backends each example uses.
 *
 * SHAPE:
 *   withPersistence<C, I, M, Ch>(): abstract class that extends
 *     StageBase<I, C, M, Ch> and implements load + setState.
 *
 *   The returned class exposes:
 *     this.store: PersistenceStore
 *     this.bound: BoundStore<C, M>  (from bindStore)
 *
 * WHEN NOT TO USE:
 *   - If load() must do extra work BEFORE store.load() (custom hydration order).
 *   Use the manual pattern in that case only.
 */

import { StageBase, StageResponse, Message } from "@chub-ai/stages-ts";
import { LoadResponse } from "@chub-ai/stages-ts/dist/types/load";
import { PersistenceStore } from "./store";
import { bindStore, createChubLayers, type BoundStore } from "./chub";
import { mergeResponses } from "./chub";

export type { BoundStore };
export { mergeResponses };

type ChubLayers = ReturnType<typeof createChubLayers>;

/**
 * Returns a StageBase subclass with `load` and `setState` pre-wired for any
 * standard persistence shape (messageState-only, initState+messageState, or
 * all three layers):
 *
 *   load()     → store.load() → bound.initial()
 *                → { success: true, error: null,
 *                    initState: mirror.initState,   ← populated if initState shards present
 *                    chatState: mirror.chatState,   ← populated if chatState shards present
 *                    messageState: mirror.messageState }
 *   setState() → bound.setState(state)
 *
 * Subclass must still implement `beforePrompt`, `afterResponse`, and `render`.
 * Access `this.store` and `this.bound` in those methods.
 *
 * @example
 * ```ts
 * export class MyStage extends withPersistence<ChatStateType, InitStateType, MessageStateType, ConfigType>(
 *   (self) => new PersistenceStore({ tick: counterShard(...), inv: shardOf(...) }),
 *   (self) => self.layers,
 * ) {
 *   inv = new Inventory();
 *   layers = createChubLayers();
 *   constructor(data: InitialData<...>) {
 *     super(data);
 *     this.layers = createChubLayers({ messageState: ... });
 *     this.initStore((self) => new PersistenceStore({ ... }));
 *   }
 *   ...
 * }
 * ```
 *
 * Because TypeScript class factories have limited type inference for `this`,
 * the recommended pattern is: call `createChubLayers` in the constructor
 * directly on the subclass, then call `this.initStore(storeFactory)` at
 * the end of the constructor to wire everything up.
 */
export function withPersistence<C, I, M, Ch>() {
  abstract class WithPersistenceBase extends StageBase<I, C, M, Ch> {
    store!: PersistenceStore;
    bound!: BoundStore<C, M>;
    layers!: ChubLayers;

    /**
     * Call at the end of the subclass constructor, after `this.layers` has
     * been assigned. Constructs the store and binds it.
     */
    protected initStore(storeFactory: (self: this) => PersistenceStore): void {
      this.store = storeFactory(this);
      this.bound = bindStore<C, M>(this.store, { layers: this.layers });
    }

    async load(): Promise<Partial<LoadResponse<I, C, M>>> {
      await this.store.load();
      await this.bound.initial();
      // Read all three mirrors after hydration. store.load() + bound.initial()
      // populate the mirrors from every shard's backend (initState, chatState,
      // messageState). Reading the mirror here covers:
      //   - simple messageState-only examples (initState/chatState stay null)
      //   - examples with an initState shard (physics, realtime-combat)
      //   - examples with a chatState shard (composite-showcase)
      return {
        success: true,
        error: null,
        initState: (this.layers.mirror.initState as I | null) ?? null,
        chatState: (this.layers.mirror.chatState as C | null) ?? null,
        messageState: (this.layers.mirror.messageState as M | null) ?? null,
      };
    }

    async setState(state: M): Promise<void> {
      await this.bound.setState(state);
    }

    abstract beforePrompt(msg: Message): Promise<Partial<StageResponse<C, M>>>;
    abstract afterResponse(msg: Message): Promise<Partial<StageResponse<C, M>>>;
  }

  return WithPersistenceBase;
}
