/*
 * patterns/inventory.ts — inventory + observation + chub-adapters + prose-register composer.
 *
 * WHAT: `inventoryPattern(init)` wires an `Inventory` with `PersistenceStore`
 *       shards (tick counter + inventory state), builds `ObservationSource`
 *       entries for stall-contents and disorder, and returns a bundle with a
 *       ready-to-call `beforePrompt` helper that emits stage directions.
 *
 *       The composer is a recipe, not a primitive. It owns no state of its
 *       own; the returned bundle exposes the underlying `Inventory` and `tick`
 *       objects directly for stage-author access.
 *
 * WHY: Every inventory stage re-derives the same tick-increment → observation
 *      → emitStageDirections pipeline. The composer collapses that wiring
 *      into a single declaration, leaving only item registration and spot
 *      setup in the stage.
 *
 *      No new mechanics. No private state. See `INVENTORY.md` for Purpose /
 *      API / Gotchas.
 *
 * SHAPE:
 *   interface InventoryBundleInit
 *     { messageState; observations?; stageDirections }
 *   interface InventoryBundle
 *     { inv; tick; habituation; layers; store;
 *       buildBeforePrompt(msg): Promise<StageResponse fragment> }
 *   function inventoryPattern(init): InventoryBundle
 */

import type { Message, StageResponse } from "@chub-ai/stages-ts";
import { Inventory } from "../../inventory";
import { type ObservationSource, assembleObservations } from "../../observation";
import { emitStageDirections } from "../../chub-adapters";
import type { ArchitectureName } from "../../prose-register";
import type { RegisterSpec } from "../../prose-register";
import {
  PersistenceStore,
  createChubLayers,
  chubTreeHistory,
  mergeResponses,
  counterShard,
  shardOf,
} from "../../persistence";

export interface InventoryBundleInit {
  /** Raw messageState from `InitialData`. */
  messageState: Record<string, string | undefined> | null;
  /**
   * Extra `ObservationSource` entries appended after the built-in
   * stall-contents and disorder sources. Optional.
   */
  extraSources?: ObservationSource<{ now: number }>[];
  /** Stage-directions options forwarded to `emitStageDirections`. */
  stageDirections: {
    architectures?: readonly ArchitectureName[];
    register?: RegisterSpec;
    prefix?: string;
  };
}

export interface InventoryBundle {
  inv: Inventory;
  tick: { n: number };
  habituation: Map<string, number>;
  layers: ReturnType<typeof createChubLayers>;
  store: PersistenceStore;
  /**
   * Runs `tick++`, assembles observations, calls `emitStageDirections`, and
   * merges with the bound persistence response. Call inside `beforePrompt`.
   */
  buildBeforePrompt(
    msg: Message,
    bound: { beforePrompt(msg: Message): Promise<Partial<StageResponse<unknown, unknown>>> },
  ): Promise<Partial<StageResponse<unknown, unknown>>>;
}

export function inventoryPattern(init: InventoryBundleInit): InventoryBundle {
  const inv = new Inventory();
  const tick = { n: 0 };
  const habituation = new Map<string, number>();
  const layers = createChubLayers({ messageState: init.messageState ?? null });

  const builtInSources = (): ObservationSource<{ now: number }>[] => [
    {
      id: "stall-contents", channels: ["visual"], salience: () => 0.6, habituationTau: 4,
      properties: {
        visual: {
          spots: () => {
            const out: Record<string, { item: string; count: number; access: number }[]> = {};
            for (const spot of inv.spots()) {
              out[spot] = inv.contents(spot).map((st) => ({
                item: inv.getDef(st.defId)?.displayName ?? st.defId,
                count: st.count,
                access: Number(inv.accessibility(st.defId, spot, tick.n).toFixed(2)),
              }));
            }
            return out;
          },
        },
      },
    },
    {
      id: "stall-disorder", channels: ["interoceptive"],
      salience: () => { let m = 0; for (const s of inv.spots()) m = Math.max(m, inv.meta(s)?.disorder ?? 0); return m; },
      habituationTau: 10,
      properties: {
        interoceptive: {
          messiest: () => {
            let worst = "—"; let score = 0;
            for (const spot of inv.spots()) {
              const d = inv.meta(spot)?.disorder ?? 0;
              if (d > score) { score = d; worst = spot; }
            }
            return { spot: worst, disorder: Number(score.toFixed(2)) };
          },
        },
      },
    },
  ];

  const store = new PersistenceStore({
    tick: counterShard("tick", tick, layers.messageStateBackend, chubTreeHistory()),
    inv: shardOf("inv", inv, (d) => Inventory.fromJSON(d), layers.messageStateBackend, chubTreeHistory()),
  });

  const buildBeforePrompt = async (
    msg: Message,
    bound: { beforePrompt(msg: Message): Promise<Partial<StageResponse<unknown, unknown>>> },
  ): Promise<Partial<StageResponse<unknown, unknown>>> => {
    tick.n += 1;
    const sources = [...builtInSources(), ...(init.extraSources ?? [])];
    const observed = assembleObservations(sources, { now: tick.n }, {
      now: tick.n, maxCount: 3, lastEmittedAt: habituation,
    });
    const stageDirections = emitStageDirections({ ...init.stageDirections, observations: observed });
    return mergeResponses({ stageDirections }, await bound.beforePrompt(msg));
  };

  return { inv, tick, habituation, layers, store, buildBeforePrompt };
}
