/*
 * inventory/Stage.tsx — Pak the pack-rat shopkeeper.
 *
 * Mechanic: spot-based inventory. Pak's tiny secondhand stall has named
 * spots (counter, under-counter, hanging-hook, back-room); items have a
 * carry-class. When the player picks something up or the scene moves, the
 * carry-class decides what follows.
 *
 * Primitives: inventory, observation, chub-adapters, prose-register, persistence.
 * Philosophy: rule #2 (def/instance — items are ItemDefs, the stage holds
 * stacks), rule #4 (accessibility recomputed on read), rule #9 (the LLM
 * gets a JSON observation block; it writes the prose).
 *
 * Persistence: inv shard on messageState + chubTreeHistory — swiping the
 * same prompt should let the user explore alternate item movements.
 */

import { ReactElement } from "react";
import { StageBase, StageResponse, InitialData, Message } from "@chub-ai/stages-ts";
import { LoadResponse } from "@chub-ai/stages-ts/dist/types/load";
import { Inventory, Stack } from "../../src/lib/inventory";
import { ObservationSource, assembleObservations } from "../../src/lib/observation";
import { emitStageDirections } from "../../src/lib/chub-adapters";
import {
  PersistenceStore, createChubLayers, chubTreeHistory, bindStore, mergeResponses, shardOf, counterShard,
} from "../../src/lib/persistence";

interface MessageStateType { ticks: number; [k: string]: unknown }
type ChatStateType = null;
type InitStateType = null;
type ConfigType = null;

export class InventoryStage extends StageBase<InitStateType, ChatStateType, MessageStateType, ConfigType> {
  inv = new Inventory();
  tick = { n: 0 };
  habituation = new Map<string, number>();
  layers = createChubLayers();
  store!: PersistenceStore;
  bound!: ReturnType<typeof bindStore<ChatStateType, MessageStateType>>;

  constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
    super(data);
    this.inv
      .register({ id: "brass-compass", carryClass: "explicit", portable: true, counted: false, defaultSpot: "counter", displayName: "brass compass", description: "tarnished, with a sticky lid" })
      .register({ id: "ration-bar", carryClass: "habitual", portable: true, counted: true, defaultSpot: "under-counter", displayName: "ration bar" })
      .register({ id: "lantern", carryClass: "explicit", portable: true, counted: false, defaultSpot: "hanging-hook", displayName: "oil lantern" })
      .register({ id: "ledger", carryClass: "habitual", portable: true, counted: false, defaultSpot: "counter", displayName: "Pak's ledger" })
      .register({ id: "stove", carryClass: "fixed", portable: false, counted: false, displayName: "pot-bellied stove" })
      .register({ id: "moth-jar", carryClass: "explicit", portable: true, counted: true, defaultSpot: "back-room", displayName: "jar of luminous moths" });

    this.inv.ensureSpot("counter", { disorder: 0.2 });
    this.inv.ensureSpot("under-counter", { disorder: 0.5 });
    this.inv.ensureSpot("hanging-hook");
    this.inv.ensureSpot("back-room", { disorder: 0.8 });
    this.inv.ensureSpot("pak-pocket");

    this.inv.add("counter", "brass-compass");
    this.inv.add("counter", "ledger");
    this.inv.add("under-counter", "ration-bar", 4);
    this.inv.add("hanging-hook", "lantern");
    this.inv.add("back-room", "moth-jar", 3);
    this.inv.add("back-room", "stove");
    this.inv.add("pak-pocket", "ration-bar", 1);

    this.layers = createChubLayers({
      messageState: (data.messageState as Record<string, string | undefined> | null) ?? null,
    });
    this.store = new PersistenceStore({
      tick: counterShard("tick", this.tick, this.layers.messageStateBackend, chubTreeHistory()),
      inv: shardOf("inv", this.inv, (d) => Inventory.fromJSON(d), this.layers.messageStateBackend, chubTreeHistory()),
    });
    this.bound = bindStore<ChatStateType, MessageStateType>(this.store, { layers: this.layers });
  }

  async load(): Promise<Partial<LoadResponse<InitStateType, ChatStateType, MessageStateType>>> {
    await this.store.load();
    const { chatState, messageState } = await this.bound.initial();
    return { success: true, error: null, initState: null, chatState, messageState };
  }

  async setState(state: MessageStateType): Promise<void> {
    await this.bound.setState(state);
  }

  private sources(): ObservationSource<{ now: number }>[] {
    const inv = this.inv;
    const now = () => this.tick.n;
    return [
      {
        id: "stall-contents", channels: ["visual"], salience: () => 0.6, habituationTau: 4,
        properties: { visual: { spots: () => {
          const out: Record<string, { item: string; count: number; access: number }[]> = {};
          for (const spot of inv.spots()) {
            out[spot] = inv.contents(spot).map((st: Stack) => ({
              item: inv.getDef(st.defId)?.displayName ?? st.defId,
              count: st.count,
              access: Number(inv.accessibility(st.defId, spot, now()).toFixed(2)),
            }));
          }
          return out;
        } } },
      },
      {
        id: "stall-disorder", channels: ["interoceptive"],
        salience: () => { let m = 0; for (const s of inv.spots()) m = Math.max(m, inv.meta(s)?.disorder ?? 0); return m; },
        habituationTau: 10,
        properties: { interoceptive: { messiest: () => {
          let worst = "—"; let score = 0;
          for (const spot of inv.spots()) {
            const d = inv.meta(spot)?.disorder ?? 0;
            if (d > score) { score = d; worst = spot; }
          }
          return { spot: worst, disorder: Number(score.toFixed(2)) };
        } } },
      },
    ];
  }

  async beforePrompt(msg: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    this.tick.n += 1;
    const observed = assembleObservations(this.sources(), { now: this.tick.n }, {
      now: this.tick.n, maxCount: 3, lastEmittedAt: this.habituation,
    });
    const stageDirections = emitStageDirections({
      observations: observed,
      architectures: ["accumulation", "body_then_world"],
      register: { pov: "close-second", tense: "present", distance: "close" },
      prefix: "Pak is the POV-adjacent shopkeeper. The block below is ground truth; do not name spot ids verbatim — translate them into prose.",
    });
    return mergeResponses({ stageDirections }, await this.bound.beforePrompt(msg));
  }

  async afterResponse(msg: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    return mergeResponses({}, await this.bound.afterResponse(msg));
  }

  render(): ReactElement {
    const rows: { spot: string; items: { name: string; count: number; access: number }[] }[] = [];
    for (const spot of this.inv.spots()) {
      rows.push({
        spot,
        items: this.inv.contents(spot).map((st) => ({
          name: this.inv.getDef(st.defId)?.displayName ?? st.defId,
          count: st.count,
          access: Number(this.inv.accessibility(st.defId, spot, this.tick.n).toFixed(2)),
        })),
      });
    }
    return (
      <div style={{ padding: 12, fontFamily: "ui-monospace, monospace", color: "#ddd", background: "#111" }}>
        <h3 style={{ marginTop: 0 }}>Pak&apos;s stall — tick {this.tick.n}</h3>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr><th align="left">spot</th><th align="left">contents</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.spot} style={{ borderTop: "1px solid #333" }}>
                <td style={{ padding: "4px 8px", verticalAlign: "top" }}>{r.spot} <span style={{ opacity: 0.5 }}>(d={(this.inv.meta(r.spot)?.disorder ?? 0).toFixed(2)})</span></td>
                <td style={{ padding: "4px 8px" }}>
                  {r.items.length === 0 ? <em style={{ opacity: 0.5 }}>empty</em> :
                    r.items.map((it) => (
                      <span key={it.name} style={{ marginRight: 12 }}>
                        {it.name}{it.count > 1 ? `×${it.count}` : ""} <span style={{ opacity: 0.5 }}>[a={it.access}]</span>
                      </span>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
}
