/*
 * inventory/Stage.tsx — Pak the pack-rat shopkeeper.
 *
 * Mechanic: spot-based inventory. Pak's tiny secondhand stall has named
 * spots (counter, under-counter, hanging-hook, back-room); items have a
 * carry-class. When the player picks something up or the scene moves, the
 * carry-class decides what follows.
 *
 * Primitives: inventoryPattern (composer).
 * Philosophy: rule #2 (def/instance — items are ItemDefs, the stage holds
 * stacks), rule #4 (accessibility recomputed on read), rule #9 (the LLM
 * gets a JSON observation block; it writes the prose).
 *
 * Persistence: inv shard on messageState + chubTreeHistory — swiping the
 * same prompt should let the user explore alternate item movements.
 */

import { ReactElement } from "react";
import { StageResponse, InitialData, Message } from "@chub-ai/stages-ts";
import { Stack } from "../../src/lib/inventory";
import { mergeResponses, withPersistence } from "../../src/lib/persistence";
import { inventoryPattern, type InventoryBundle } from "../../src/lib/patterns/character/inventory";

interface MessageStateType { ticks: number; [k: string]: unknown }
type ChatStateType = null;
type InitStateType = null;
type ConfigType = null;

const STAGE_DIRECTIONS = {
  architectures: ["accumulation", "body_then_world"] as const,
  register: { pov: "close-second", tense: "present", distance: "close" } as const,
  prefix: "Pak is the POV-adjacent shopkeeper. The block below is ground truth; do not name spot ids verbatim — translate them into prose.",
};

export class InventoryStage extends withPersistence<ChatStateType, InitStateType, MessageStateType, ConfigType>() {
  p!: InventoryBundle;

  constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
    super(data);
    const ms = (data.messageState as Record<string, string | undefined> | null) ?? null;
    this.p = inventoryPattern({ messageState: ms, stageDirections: STAGE_DIRECTIONS });

    this.p.inv
      .register({ id: "brass-compass", carryClass: "explicit", portable: true, counted: false, defaultSpot: "counter", displayName: "brass compass", description: "tarnished, with a sticky lid" })
      .register({ id: "ration-bar", carryClass: "habitual", portable: true, counted: true, defaultSpot: "under-counter", displayName: "ration bar" })
      .register({ id: "lantern", carryClass: "explicit", portable: true, counted: false, defaultSpot: "hanging-hook", displayName: "oil lantern" })
      .register({ id: "ledger", carryClass: "habitual", portable: true, counted: false, defaultSpot: "counter", displayName: "Pak's ledger" })
      .register({ id: "stove", carryClass: "fixed", portable: false, counted: false, displayName: "pot-bellied stove" })
      .register({ id: "moth-jar", carryClass: "explicit", portable: true, counted: true, defaultSpot: "back-room", displayName: "jar of luminous moths" });

    this.p.inv.ensureSpot("counter", { disorder: 0.2 });
    this.p.inv.ensureSpot("under-counter", { disorder: 0.5 });
    this.p.inv.ensureSpot("hanging-hook");
    this.p.inv.ensureSpot("back-room", { disorder: 0.8 });
    this.p.inv.ensureSpot("pak-pocket");

    this.p.inv.add("counter", "brass-compass");
    this.p.inv.add("counter", "ledger");
    this.p.inv.add("under-counter", "ration-bar", 4);
    this.p.inv.add("hanging-hook", "lantern");
    this.p.inv.add("back-room", "moth-jar", 3);
    this.p.inv.add("back-room", "stove");
    this.p.inv.add("pak-pocket", "ration-bar", 1);

    this.layers = this.p.layers;
    this.initStore(() => this.p.store);
  }

  async beforePrompt(msg: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    return this.p.buildBeforePrompt(msg, this.bound) as Promise<Partial<StageResponse<ChatStateType, MessageStateType>>>;
  }

  async afterResponse(msg: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    return mergeResponses({}, await this.bound.afterResponse(msg));
  }

  render(): ReactElement {
    const { inv, tick } = this.p;

    // Map spot ids to player-readable location labels.
    const SPOT_LABELS: Record<string, string> = {
      counter: "Counter",
      "under-counter": "Under the counter",
      "hanging-hook": "Hanging hook",
      "back-room": "Back room",
      "pak-pocket": "Pak's pocket",
    };

    // Map accessibility score (0–1) to a brief availability hint.
    function reachHint(a: number): string {
      if (a >= 0.8) return "within reach";
      if (a >= 0.5) return "buried a little";
      if (a >= 0.2) return "hard to find";
      return "buried deep";
    }

    const rows: { spot: string; label: string; items: { name: string; count: number; hint: string }[] }[] = [];
    for (const spot of inv.spots()) {
      rows.push({
        spot,
        label: SPOT_LABELS[spot] ?? spot,
        items: inv.contents(spot).map((st: Stack) => ({
          name: inv.getDef(st.defId)?.displayName ?? st.defId,
          count: st.count,
          hint: reachHint(inv.accessibility(st.defId, spot, tick.n)),
        })),
      });
    }

    return (
      <div style={{ padding: 12, fontFamily: "sans-serif", color: "#ddd", background: "#1a1a1a", maxWidth: 480 }}>
        <h3 style={{ marginTop: 0, fontSize: "1rem", color: "#e8c97a" }}>Pak&apos;s Stall</h3>
        {rows.map((r) => {
          const visibleItems = r.items.filter((it) => it.name !== "Pak's ledger" || r.spot !== "pak-pocket");
          return (
            <div key={r.spot} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>{r.label}</div>
              {visibleItems.length === 0
                ? <div style={{ color: "#555", fontStyle: "italic", fontSize: "0.9rem" }}>Nothing here.</div>
                : <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {visibleItems.map((it) => (
                      <li key={it.name} style={{ fontSize: "0.9rem", marginBottom: 2 }}>
                        {it.name}{it.count > 1 ? ` ×${it.count}` : ""}
                        <span style={{ color: "#777", fontSize: "0.8rem", marginLeft: 6 }}>({it.hint})</span>
                      </li>
                    ))}
                  </ul>
              }
            </div>
          );
        })}
      </div>
    );
  }
}
