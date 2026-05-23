/*
 * cyber-slots/Stage.tsx — Dr. Cull the ripperdoc.
 *
 * Mechanic: cyberware mods are EquipmentDefs constrained on body tags
 * (e.g. deckjack requires `neural-port`, monocular requires `socket-right`).
 * A TF that adds `neural-port` makes the deckjack equippable; a TF that
 * adds `flesh-only` makes it violate; the stage detects violations and
 * surfaces them to the LLM without auto-resolving.
 *
 * Primitives: equipment, body, transformation, constraints, tags, observation.
 * Philosophy: rule #3 (detect vs resolve — `resolveViolations` returns
 * categories; the stage decides whether to prompt or auto-unequip).
 */

import { ReactElement } from "react";
import { StageBase, StageResponse, InitialData, Message } from "@chub-ai/stages-ts";
import { LoadResponse } from "@chub-ai/stages-ts/dist/types/load";
import { Body, TransformationInstance } from "../../src/lib/body";
import { TransformationDef, apply as applyTf } from "../../src/lib/transformation";
import { EquipmentDef, Loadout, fromDict as eqFromDict } from "../../src/lib/equipment";
import { parseTags } from "../../src/lib/tag-parser";
import { emitStageDirections } from "../../src/lib/chub-adapters";
import { assembleObservations, ObservationSource } from "../../src/lib/observation";

interface MessageStateType {
  ticks: number; lastAction?: string;
  body?: { baseSlots: Record<string, string[]>; transformations: TransformationInstance[] };
  loadout?: { equipped: Record<string, { defId: string; equippedAt: number; snapshotTags: string[] }> };
}
type ChatStateType = null; type InitStateType = null; type ConfigType = null;

const MODS: Record<string, EquipmentDef> = {
  deckjack: eqFromDict({
    id: "deckjack", slot: "head",
    constraints: ["neural-port", "!flesh-only"],
    onConflict: "degrade",
    degradePenalties: { hackSpeed: 0.4 },
    grantsTags: ["jacked-in-capable"],
    displayName: "Daedalus deck-jack mk II",
  }),
  monocular: eqFromDict({
    id: "monocular", slot: "head",
    constraints: ["socket-right"],
    onConflict: "unequip",
    adaptAlternatives: [["socket-left"]],
    grantsTags: ["zoom-optic"],
    displayName: "Hartman monocular",
  }),
  reflex_booster: eqFromDict({
    id: "reflex_booster", slot: "torso",
    constraints: ["spinal-port"],
    onConflict: "unequip",
    grantsTags: ["fast-twitch"],
    displayName: "Sandevistan-class reflex booster",
  }),
};

const TFS: Record<string, TransformationDef> = {
  install_neural_port: {
    id: "install_neural_port", slot: "head",
    addTags: ["neural-port"], removeTags: ["flesh-only"],
    baseDuration: null,
    conflicts: {},
    displayName: "install neural port",
  },
  install_socket_right: {
    id: "install_socket_right", slot: "head",
    addTags: ["socket-right"], removeTags: [],
    baseDuration: null, conflicts: {},
    displayName: "install right eye socket",
  },
  install_spinal_port: {
    id: "install_spinal_port", slot: "torso",
    addTags: ["spinal-port"], removeTags: [],
    baseDuration: null, conflicts: {},
    displayName: "install spinal port",
  },
  fleshweave: {
    id: "fleshweave", slot: "head",
    addTags: ["flesh-only"], removeTags: ["neural-port"],
    baseDuration: null, conflicts: {},
    displayName: "fleshweave reversal",
  },
};

export class CyberSlotsStage extends StageBase<InitStateType, ChatStateType, MessageStateType, ConfigType> {
  body: Body;
  loadout: Loadout;
  msg: MessageStateType = { ticks: 0 };

  constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
    super(data);
    this.body = new Body({
      head: ["flesh-only", "hair-short"],
      torso: ["flesh-only", "skin-soft"],
    });
    this.loadout = new Loadout(this.body);
    if (data.messageState) this.msg = { ...this.msg, ...data.messageState };
  }

  async load(): Promise<Partial<LoadResponse<InitStateType, ChatStateType, MessageStateType>>> {
    return { success: true, error: null, initState: null, chatState: null };
  }
  async setState(state: MessageStateType): Promise<void> {
    if (!state) return;
    this.msg = { ...this.msg, ...state };
    // Restore body + loadout from serialized state for swipe-safety.
    if (state.body) {
      this.body = Body.fromJSON(state.body);
      this.loadout = new Loadout(this.body);
      if (state.loadout) this.loadout = Loadout.fromJSON(state.loadout, this.body, MODS);
    }
  }

  private observationSources(now: number): ObservationSource<{ now: number }>[] {
    return [
      {
        id: "body-tags",
        channels: ["visual"],
        salience: () => 0.5,
        habituationTau: 4,
        properties: {
          visual: {
            slots: () => {
              const out: Record<string, string[]> = {};
              for (const [s, t] of this.body.getAllEffectiveTags()) out[s] = t.toArray();
              return out;
            },
          },
        },
      },
      {
        id: "equipped",
        channels: ["visual"],
        salience: () => Math.min(1, this.loadout.getAllEquipped().size / 2),
        habituationTau: 6,
        properties: {
          visual: {
            mods: () => {
              const out: Record<string, { id: string; fit: string; failed: string[] }> = {};
              for (const [slot, inst] of this.loadout.getAllEquipped()) {
                const f = this.loadout.fit(slot, now)!;
                out[slot] = { id: inst.def.id, fit: f.fit, failed: f.failedTerms };
              }
              return out;
            },
            available: () => Object.entries(MODS).map(([id, def]) => ({
              id, slot: def.slot, constraints: def.constraints,
            })),
          },
        },
      },
      {
        id: "violations",
        channels: ["interoceptive"],
        salience: () => (this.loadout.checkAllConstraints().length > 0 ? 1 : 0),
        habituationTau: 0,
        properties: {
          interoceptive: {
            current: () => this.loadout.checkAllConstraints(),
          },
        },
      },
    ];
  }

  async beforePrompt(_userMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    const now = ++this.msg.ticks;
    const observed = assembleObservations(this.observationSources(now), { now }, { now, maxCount: 4 });
    const stageDirections = emitStageDirections({
      observations: observed,
      architectures: ["body_then_world", "conditional_inversion"],
      register: { pov: "close-second", tense: "present", distance: "close" },
      prefix:
        "Dr. Cull is the ripperdoc; the player is the patient. To install a body mod TF, " +
        "emit `<install>install_neural_port|install_socket_right|install_spinal_port|fleshweave</install>`. " +
        "To bolt on cyberware, emit `<equip>deckjack|monocular|reflex_booster</equip>`. To remove " +
        "from a slot, emit `<unequip>head|torso</unequip>`. If the violations list is non-empty " +
        "you MUST surface it to the patient before performing any new action.",
    });
    this.msg.body = this.body.toJSON();
    this.msg.loadout = this.loadout.toJSON();
    return { stageDirections, messageState: this.msg };
  }

  async afterResponse(botMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    const now = this.msg.ticks;
    let text = botMessage.content;
    const r1 = parseTags<Record<string, unknown>>(text, { install: { kind: "string", enum: Object.keys(TFS) } });
    text = r1.stripped;
    const r2 = parseTags<Record<string, unknown>>(text, { equip: { kind: "string", enum: Object.keys(MODS) } });
    text = r2.stripped;
    const r3 = parseTags<Record<string, unknown>>(text, { unequip: { kind: "string", enum: ["head", "torso"] } });
    text = r3.stripped;
    if (typeof r1.parsed.install === "string" && r1.parsed.install) {
      applyTf(TFS[r1.parsed.install as string], this.body, now);
      this.msg.lastAction = `installed:${r1.parsed.install}`;
    }
    if (typeof r2.parsed.equip === "string" && r2.parsed.equip) {
      const res = this.loadout.equip(MODS[r2.parsed.equip as string], now);
      this.msg.lastAction = res.ok ? `equipped:${r2.parsed.equip}` : `equip-failed:${(res as { reason: string }).reason}`;
    }
    if (typeof r3.parsed.unequip === "string" && r3.parsed.unequip) {
      this.loadout.unequip(r3.parsed.unequip as string);
      this.msg.lastAction = `unequipped:${r3.parsed.unequip}`;
    }
    return { messageState: this.msg, modifiedMessage: text !== botMessage.content ? text : null };
  }

  render(): ReactElement {
    const now = this.msg.ticks;
    return (
      <div style={{ padding: 12, fontFamily: "ui-monospace, monospace", color: "#ddd", background: "#111" }}>
        <h3 style={{ marginTop: 0 }}>Cull&apos;s table — tick {now}</h3>
        <h4>Body</h4>
        <table><tbody>
          {this.body.getSlots().map((s) => (
            <tr key={s}><td style={{ color: "#9ad", padding: "2px 8px" }}>{s}</td><td>{this.body.getEffectiveTags(s).toArray().join(", ")}</td></tr>
          ))}
        </tbody></table>
        <h4>Equipped</h4>
        {this.loadout.getAllEquipped().size === 0 ? <em style={{ opacity: 0.5 }}>nothing</em> : (
          <ul>{[...this.loadout.getAllEquipped()].map(([slot, inst]) => {
            const f = this.loadout.fit(slot, now)!;
            return <li key={slot}><b>{inst.def.id}</b> on {slot} — fit: <span style={{ color: f.fit === "comfortable" ? "#9c9" : f.fit === "broken" ? "#e77" : "#dd8" }}>{f.fit}</span> {f.failedTerms.length ? `(failed: ${f.failedTerms.join(", ")})` : ""}</li>;
          })}</ul>
        )}
        <h4>Violations</h4>
        <pre style={{ background: "#000", padding: 8 }}>{JSON.stringify(this.loadout.checkAllConstraints(), null, 2)}</pre>
        <div style={{ opacity: 0.7, fontSize: "0.85rem" }}>last: {this.msg.lastAction ?? "—"}</div>
      </div>
    );
  }
}
