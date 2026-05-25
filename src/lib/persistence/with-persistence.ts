/*
 * persistence/with-persistence.ts — HOC that eliminates the load/setState
 *                                    boilerplate shared by most examples.
 *
 * WHAT: `withPersistence(store, layers)` returns a class that extends
 *       StageBase and wires the standard three methods:
 *         - load()      → store.load() → bound.initial() → { success, chatState, messageState }
 *         - setState()  → bound.setState(state)
 *         - (beforePrompt / afterResponse are inherited helpers via `bound`)
 *
 *       The subclass uses `this.store` and `this.bound` directly and only
 *       needs to implement beforePrompt, afterResponse, and render.
 *
 * WHY: The five-line load()/setState() block is copy-pasted in every
 *      example that uses the simple messageState-only persistence shape.
 *      `withPersistence` removes ~15 lines per example with no behaviour
 *      change.
 *
 * SHAPE:
 *   withPersistence<C, I, M, Ch>(store, layers): abstract class that extends
 *     StageBase<I, C, M, Ch> and implements load + setState.
 *
 *   The returned class exposes:
 *     this.store: PersistenceStore
 *     this.bound: BoundStore<C, M>  (from bindStore)
 *
 * WHEN NOT TO USE:
 *   - If load() also reads this.layers.mirror directly to build initState
 *     or a non-null chatState (physics, realtime-combat, composite-showcase).
 *   - If load() does extra work before store.load() (custom hydration order).
 *   Use the manual pattern in those cases.
 */

import { StageBase, StageResponse, InitialData, Message } from "@chub-ai/stages-ts";
import { LoadResponse } from "@chub-ai/stages-ts/dist/types/load";
import { PersistenceStore } from "./store";
import { bindStore, createChubLayers, type BoundStore } from "./chub";
import { mergeResponses } from "./chub";

export type { BoundStore };
export { mergeResponses };

type ChubLayers = ReturnType<typeof createChubLayers>;

/**
 * Returns a StageBase subclass with `load` and `setState` pre-wired for the
 * standard messageState-only persistence shape:
 *
 *   load()     → store.load() → bound.initial() → { success: true, error: null, initState: null, chatState, messageState }
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
      const { chatState, messageState } = await this.bound.initial();
      return { success: true, error: null, initState: null as unknown as I, chatState, messageState };
    }

    async setState(state: M): Promise<void> {
      await this.bound.setState(state);
    }

    abstract beforePrompt(msg: Message): Promise<Partial<StageResponse<C, M>>>;
    abstract afterResponse(msg: Message): Promise<Partial<StageResponse<C, M>>>;
  }

  return WithPersistenceBase;
}
