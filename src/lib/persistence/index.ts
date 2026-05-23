/*
 * persistence/index.ts — public surface of the persistence layer.
 *
 * Compose: pick a backend (which Chub layer), pick a history (branch
 * paradigm), bundle as a Shard, hand the Shard set to PersistenceStore.
 * See persistence/README.md for the recipe table.
 */

export type {
  SaveBackend,
  LayerGet,
  LayerSet,
} from "./backend";
export {
  initStateBackend,
  chatStateBackend,
  messageStateBackend,
  tee,
  debounced,
  rolling,
} from "./backend";

export type { Moment, MomentId, History } from "./history";
export {
  snapshotHistory,
  diffHistory,
  forbidBranching,
  bounded,
  persisted,
  noHistory,
} from "./history";

export type { SaveableState, Shard } from "./store";
export { asSaveable, asSaveableClass, PersistenceStore } from "./store";

export type { BindStoreOptions, BoundStore } from "./chub";
export {
  chubTreeHistory,
  createChubLayers,
  bindStore,
  mergeResponses,
  shard,
  shardOf,
  counterShard,
} from "./chub";
