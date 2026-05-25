/*
 * cyber-slots/Stage.tsx — Dr. Cull the ripperdoc.
 *
 * Mechanic: cyberware mods are EquipmentDefs constrained on body tags
 * (e.g. deckjack requires `neural-port`, monocular requires `socket-right`).
 * A TF that adds `neural-port` makes the deckjack equippable; a TF that
 * adds `flesh-only` makes it violate; the stage detects violations and
 * surfaces them to the LLM without auto-resolving.
 *
 * Primitives: equipment, body, transformation, constraints, persistence.
 * Philosophy: rule #3 (detect vs resolve — `resolveViolations` returns
 * categories; the stage decides whether to prompt or auto-unequip).
 *
 * Persistence: body + loadout on chatState + forbidBranching. The patient
 * leaves the clinic with what's installed; swiping doesn't un-do surgery.
 */

import { ReactElement } from "react";
import { StageResponse, InitialData, Message } from "@chub-ai/stages-ts";
import { Body } from "../../src/lib/body";
import { TransformationDef, apply as applyTf } from "../../src/lib/transformation";
import { EquipmentDef, Loadout, fromDict as eqFromDict } from "../../src/lib/equipment";
import { Registry } from "../../src/lib/registry";
import { parseTags } from "../../src/lib/tag-parser";
import { emitStageDirections } from "../../src/lib/chub-adapters";
import { assembleObservations, ObservationSource } from "../../src/lib/observation";
import {
  PersistenceStore, createChubLayers, chubTreeHistory, snapshotHistory, forbidBranching,
  mergeResponses, shard, shardOf, withPersistence,
} from "../../src/lib/persistence";

interface MessageStateType { ticks: number; lastAction?: string; [k: string]: unknown }
interface ChatStateType { [k: string]: unknown }
type InitStateType = null;
type ConfigType = null;

const MODS = new Registry<EquipmentDef>({
  deckjack: eqFromDict({
    id: "deckjack", slot: "head", constraints: ["neural-port", "!flesh-only"],
    onConflict: "degrade", degradePenalties: { hackSpeed: 0.4 },
    grantsTags: ["jacked-in-capable"], displayName: "Daedalus deck-jack mk II",
  }),
  monocular: eqFromDict({
    id: "monocular", slot: "head", constraints: ["socket-right"],
    onConflict: "unequip", adaptAlternatives: [["socket-left"]],
    grantsTags: ["zoom-optic"], displayName: "Hartman monocular",
  }),
  reflex_booster: eqFromDict({
    id: "reflex_booster", slot: "torso", constraints: ["spinal-port"],
    onConflict: "unequip", grantsTags: ["fast-twitch"], displayName: "Sandevistan-class reflex booster",
  }),
});

const TFS = new Registry<TransformationDef>({
  install_neural_port: { id: "install_neural_port", slot: "head", addTags: ["neural-port"], removeTags: ["flesh-only"], baseDuration: null, conflicts: {}, displayName: "install neural port" },
  install_socket_right: { id: "install_socket_right", slot: "head", addTags: ["socket-right"], removeTags: [], baseDuration: null, conflicts: {}, displayName: "install right eye socket" },
  install_spinal_port: { id: "install_spinal_port", slot: "torso", addTags: ["spinal-port"], removeTags: [], baseDuration: null, conflicts: {}, displayName: "install spinal port" },
  fleshweave: { id: "fleshweave", slot: "head", addTags: ["flesh-only"], removeTags: ["neural-port"], baseDuration: null, conflicts: {}, displayName: "fleshweave reversal" },
});

export class CyberSlotsStage extends withPersistence<ChatStateType, InitStateType, MessageStateType, ConfigType>() {
  body: Body;
  loadout: Loadout;
  tick = { n: 0, lastAction: undefined as string | undefined };
  layers = createChubLayers();

  constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
    super(data);
    this.body = new Body({
      head: ["flesh-only", "hair-short"],
      torso: ["flesh-only", "skin-soft"],
    });
    this.loadout = new Loadout(this.body);

    this.layers = createChubLayers({
      messageState: (data.messageState as Record<string, string | undefined> | null) ?? null,
      chatState: (data.chatState as Record<string, string | undefined> | null) ?? null,
    });
    this.initStore(() => new PersistenceStore({
      tick: shard("tick", this.tick,
        (i) => ({ n: i.n, lastAction: i.lastAction }),
        (d: { n: number; lastAction?: string }) => ({ n: d.n, lastAction: d.lastAction }),
        this.layers.messageStateBackend, chubTreeHistory()),
      body: shardOf("body", this.body, (d) => Body.fromJSON(d), this.layers.chatStateBackend, forbidBranching(snapshotHistory())),
      loadout: shard("loadout", this.loadout,
        (i) => i.toJSON(),
        (d: ReturnType<Loadout["toJSON"]>) => Loadout.fromJSON(d, this.body, MODS.toJSON()),
        this.layers.chatStateBackend, forbidBranching(snapshotHistory())),
    }));
  }

  private observationSources(now: number): ObservationSource<{ now: number }>[] {
    return [
      {
        id: "body-tags", channels: ["visual"], salience: () => 0.5, habituationTau: 4,
        properties: { visual: { slots: () => {
          const out: Record<string, string[]> = {};
          for (const [s, t] of this.body.getAllEffectiveTags()) out[s] = t.toArray();
          return out;
        } } },
      },
      {
        id: "equipped", channels: ["visual"],
        salience: () => Math.min(1, this.loadout.getAllEquipped().size / 2), habituationTau: 6,
        properties: { visual: {
          mods: () => {
            const out: Record<string, { id: string; fit: string; failed: string[] }> = {};
            for (const [slot, inst] of this.loadout.getAllEquipped()) {
              const f = this.loadout.fit(slot, now)!;
              out[slot] = { id: inst.def.id, fit: f.fit, failed: f.failedTerms };
            }
            return out;
          },
          available: () => MODS.entries().map(([id, def]) => ({ id, slot: def.slot, constraints: def.constraints })),
        } },
      },
      {
        id: "violations", channels: ["interoceptive"],
        salience: () => (this.loadout.checkAllConstraints().length > 0 ? 1 : 0), habituationTau: 0,
        properties: { interoceptive: { current: () => this.loadout.checkAllConstraints() } },
      },
    ];
  }

  async beforePrompt(msg: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    this.tick.n += 1;
    const now = this.tick.n;
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
    return mergeResponses({ stageDirections }, await this.bound.beforePrompt(msg));
  }

  async afterResponse(botMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    const now = this.tick.n;
    let text = botMessage.content;
    const r1 = parseTags<Record<string, unknown>>(text, { install: { kind: "string", enum: TFS.keys() } });
    text = r1.stripped;
    const r2 = parseTags<Record<string, unknown>>(text, { equip: { kind: "string", enum: MODS.keys() } });
    text = r2.stripped;
    const r3 = parseTags<Record<string, unknown>>(text, { unequip: { kind: "string", enum: ["head", "torso"] } });
    text = r3.stripped;
    if (typeof r1.parsed.install === "string" && r1.parsed.install) {
      applyTf(TFS.require(r1.parsed.install as string), this.body, now);
      this.tick.lastAction = `installed:${r1.parsed.install}`;
    }
    if (typeof r2.parsed.equip === "string" && r2.parsed.equip) {
      const res = this.loadout.equip(MODS.require(r2.parsed.equip as string), now);
      this.tick.lastAction = res.ok ? `equipped:${r2.parsed.equip}` : `equip-failed:${(res as { reason: string }).reason}`;
    }
    if (typeof r3.parsed.unequip === "string" && r3.parsed.unequip) {
      this.loadout.unequip(r3.parsed.unequip as string);
      this.tick.lastAction = `unequipped:${r3.parsed.unequip}`;
    }
    const stripped = text !== botMessage.content ? text : null;
    return mergeResponses({ modifiedMessage: stripped }, await this.bound.afterResponse(botMessage));
  }

  render(): ReactElement {
    const now = this.tick.n;
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
        <div style={{ opacity: 0.7, fontSize: "0.85rem" }}>last: {this.tick.lastAction ?? "—"}</div>
      </div>
    );
  }
}
