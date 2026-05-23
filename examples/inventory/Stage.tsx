/*
 * inventory/Stage.tsx — Pak the pack-rat shopkeeper.
 *
 * Mechanic: spot-based inventory. Pak's tiny secondhand stall has named
 * spots (counter, under-counter, hanging-hook, back-room); items have a
 * carry-class. When the player picks something up or the scene moves, the
 * carry-class decides what follows.
 *
 * Primitives: inventory, observation, chub-adapters, prose-register.
 * Philosophy: rule #2 (def/instance — items are ItemDefs, the stage holds
 * stacks), rule #4 (accessibility recomputed on read), rule #9 (the LLM
 * gets a JSON observation block; it writes the prose).
 */

import { ReactElement } from "react";
import { StageBase, StageResponse, InitialData, Message } from "@chub-ai/stages-ts";
import { LoadResponse } from "@chub-ai/stages-ts/dist/types/load";
import { Inventory, ItemDef, Stack, SpotMeta } from "../../src/lib/inventory";
import { ObservationSource, assembleObservations } from "../../src/lib/observation";
import { emitStageDirections } from "../../src/lib/chub-adapters";

interface MessageStateType {
  ticks: number;
  lastTakenDefId?: string;
  inv?: { defs: ItemDef[]; spots: Record<string, Stack[]>; meta: Record<string, SpotMeta> };
}
type ChatStateType = null;
type InitStateType = null;
type ConfigType = null;

interface PakState {
  inv: Inventory;
  now: number;
}

export class InventoryStage extends StageBase<InitStateType, ChatStateType, MessageStateType, ConfigType> {
  state: PakState;
  msg: MessageStateType = { ticks: 0 };
  habituation = new Map<string, number>();

  constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
    super(data);
    const inv = new Inventory();
    inv
      .register({ id: "brass-compass", carryClass: "explicit", portable: true, counted: false, defaultSpot: "counter", displayName: "brass compass", description: "tarnished, with a sticky lid" })
      .register({ id: "ration-bar", carryClass: "habitual", portable: true, counted: true, defaultSpot: "under-counter", displayName: "ration bar" })
      .register({ id: "lantern", carryClass: "explicit", portable: true, counted: false, defaultSpot: "hanging-hook", displayName: "oil lantern" })
      .register({ id: "ledger", carryClass: "habitual", portable: true, counted: false, defaultSpot: "counter", displayName: "Pak's ledger" })
      .register({ id: "stove", carryClass: "fixed", portable: false, counted: false, displayName: "pot-bellied stove" })
      .register({ id: "moth-jar", carryClass: "explicit", portable: true, counted: true, defaultSpot: "back-room", displayName: "jar of luminous moths" });

    inv.ensureSpot("counter", { disorder: 0.2 });
    inv.ensureSpot("under-counter", { disorder: 0.5 });
    inv.ensureSpot("hanging-hook");
    inv.ensureSpot("back-room", { disorder: 0.8 });
    inv.ensureSpot("pak-pocket");

    inv.add("counter", "brass-compass");
    inv.add("counter", "ledger");
    inv.add("under-counter", "ration-bar", 4);
    inv.add("hanging-hook", "lantern");
    inv.add("back-room", "moth-jar", 3);
    inv.add("back-room", "stove");
    inv.add("pak-pocket", "ration-bar", 1);

    this.state = { inv, now: 0 };
    if (data.messageState) this.msg = { ...this.msg, ...data.messageState };
  }

  async load(): Promise<Partial<LoadResponse<InitStateType, ChatStateType, MessageStateType>>> {
    return { success: true, error: null, initState: null, chatState: null };
  }

  async setState(state: MessageStateType): Promise<void> {
    if (!state) return;
    this.msg = { ...this.msg, ...state };
    // Restore inventory from serialized snapshot so swipes don't lose state.
    if (state.inv) this.state.inv = Inventory.fromJSON(state.inv);
    if (state.ticks !== undefined) this.state.now = state.ticks;
  }

  private sources(): ObservationSource<PakState>[] {
    return [
      {
        id: "stall-contents",
        channels: ["visual"],
        salience: () => 0.6,
        habituationTau: 4,
        properties: {
          visual: {
            spots: (s) => {
              const out: Record<string, { item: string; count: number; access: number }[]> = {};
              for (const spot of s.inv.spots()) {
                out[spot] = s.inv.contents(spot).map((st: Stack) => ({
                  item: s.inv.getDef(st.defId)?.displayName ?? st.defId,
                  count: st.count,
                  access: Number(s.inv.accessibility(st.defId, spot, s.now).toFixed(2)),
                }));
              }
              return out;
            },
          },
        },
      },
      {
        id: "stall-disorder",
        channels: ["interoceptive"],
        salience: (s) => {
          let max = 0;
          for (const spot of s.inv.spots()) max = Math.max(max, s.inv.meta(spot)?.disorder ?? 0);
          return max;
        },
        habituationTau: 10,
        properties: {
          interoceptive: {
            messiest: (s) => {
              let worst = "—"; let score = 0;
              for (const spot of s.inv.spots()) {
                const d = s.inv.meta(spot)?.disorder ?? 0;
                if (d > score) { score = d; worst = spot; }
              }
              return { spot: worst, disorder: Number(score.toFixed(2)) };
            },
          },
        },
      },
    ];
  }

  async beforePrompt(_userMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    this.state.now = ++this.msg.ticks;
    const observed = assembleObservations(this.sources(), this.state, {
      now: this.state.now,
      maxCount: 3,
      lastEmittedAt: this.habituation,
    });
    const stageDirections = emitStageDirections({
      observations: observed,
      architectures: ["accumulation", "body_then_world"],
      register: "close-2nd-present",
      prefix: "Pak is the POV-adjacent shopkeeper. The block below is ground truth; do not name spot ids verbatim — translate them into prose.",
    });
    this.msg.inv = this.state.inv.toJSON();
    return { stageDirections, messageState: this.msg, modifiedMessage: null, systemMessage: null, error: null, chatState: null };
  }

  async afterResponse(_botMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    return { messageState: this.msg, modifiedMessage: null, systemMessage: null, error: null, chatState: null, stageDirections: null };
  }

  render(): ReactElement {
    const rows: { spot: string; items: { name: string; count: number; access: number }[] }[] = [];
    for (const spot of this.state.inv.spots()) {
      rows.push({
        spot,
        items: this.state.inv.contents(spot).map((st) => ({
          name: this.state.inv.getDef(st.defId)?.displayName ?? st.defId,
          count: st.count,
          access: Number(this.state.inv.accessibility(st.defId, spot, this.state.now).toFixed(2)),
        })),
      });
    }
    return (
      <div style={{ padding: 12, fontFamily: "ui-monospace, monospace", color: "#ddd", background: "#111" }}>
        <h3 style={{ marginTop: 0 }}>Pak&apos;s stall — tick {this.state.now}</h3>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr><th align="left">spot</th><th align="left">contents</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.spot} style={{ borderTop: "1px solid #333" }}>
                <td style={{ padding: "4px 8px", verticalAlign: "top" }}>{r.spot} <span style={{ opacity: 0.5 }}>(d={(this.state.inv.meta(r.spot)?.disorder ?? 0).toFixed(2)})</span></td>
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
