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
import { TransformationDef } from "../../src/lib/transformation";
import { EquipmentDef, Loadout, fromDict as eqFromDict } from "../../src/lib/equipment";
import { Registry } from "../../src/lib/registry";
import { parseTags } from "../../src/lib/tag-parser";
import { emitStageDirections } from "../../src/lib/chub-adapters";
import { assembleObservations } from "../../src/lib/observation";
import { cyberSlotsPattern } from "../../src/lib/patterns/character/cyber-slots";
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
  cyber = cyberSlotsPattern({
    slots: { head: ["flesh-only", "hair-short"], torso: ["flesh-only", "skin-soft"] },
    mods: MODS,
    tfs: TFS,
  });
  tick = { n: 0, lastAction: undefined as string | undefined };
  layers = createChubLayers();

  constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
    super(data);
    this.layers = createChubLayers({
      messageState: (data.messageState as Record<string, string | undefined> | null) ?? null,
      chatState: (data.chatState as Record<string, string | undefined> | null) ?? null,
    });
    this.initStore(() => new PersistenceStore({
      tick: shard("tick", this.tick,
        (i) => ({ n: i.n, lastAction: i.lastAction }),
        (d: { n: number; lastAction?: string }) => ({ n: d.n, lastAction: d.lastAction }),
        this.layers.messageStateBackend, chubTreeHistory()),
      body: shardOf("body", this.cyber.body, (d) => Body.fromJSON(d), this.layers.chatStateBackend, forbidBranching(snapshotHistory())),
      loadout: shard("loadout", this.cyber.loadout,
        (i) => i.toJSON(),
        (d: ReturnType<Loadout["toJSON"]>) => Loadout.fromJSON(d, this.cyber.body, MODS.toJSON()),
        this.layers.chatStateBackend, forbidBranching(snapshotHistory())),
    }));
  }

  async beforePrompt(msg: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    this.tick.n += 1;
    const now = this.tick.n;
    const observed = assembleObservations(this.cyber.observationSources(now), { now }, { now, maxCount: 4 });
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
      this.cyber.applyTf(r1.parsed.install as string, now);
      this.tick.lastAction = `installed:${r1.parsed.install}`;
    }
    if (typeof r2.parsed.equip === "string" && r2.parsed.equip) {
      const res = this.cyber.equip(r2.parsed.equip as string, now);
      this.tick.lastAction = res.ok ? `equipped:${r2.parsed.equip}` : `equip-failed:${(res as { reason: string }).reason}`;
    }
    if (typeof r3.parsed.unequip === "string" && r3.parsed.unequip) {
      this.cyber.unequip(r3.parsed.unequip as string);
      this.tick.lastAction = `unequipped:${r3.parsed.unequip}`;
    }
    const stripped = text !== botMessage.content ? text : null;
    return mergeResponses({ modifiedMessage: stripped }, await this.bound.afterResponse(botMessage));
  }

  render(): ReactElement {
    const now = this.tick.n;
    const violations = this.cyber.loadout.checkAllConstraints();
    const equipped = [...this.cyber.loadout.getAllEquipped()];

    // Human-readable constraint failure — no raw JSON.
    // "Daedalus deck-jack mk II on your head — conflicts with flesh-only; needs neural-port"
    const violationLines = violations.map((v) => {
      const mod = MODS.get(v.source);
      const modName = mod?.displayName ?? v.source;
      const slotName = mod?.slot ?? "unknown slot";
      const failed = v.failedTerms.map((t) =>
        t.startsWith("!") ? `conflicts with ${t.slice(1)}` : `needs ${t}`
      ).join("; ");
      return `${modName} on your ${slotName} — ${failed}`;
    });

    return (
      <div style={{ padding: 12, fontFamily: "system-ui, sans-serif", color: "#e8e8e8", background: "#111", maxWidth: 420 }}>
        <h3 style={{ marginTop: 0, fontSize: "1rem", color: "#9ad", letterSpacing: "0.05em" }}>
          Dr. Cull&apos;s Operating Table
        </h3>

        {/* Body mods */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: "0.75rem", color: "#666", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Body</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {this.cyber.body.getSlots().map((s) => {
              const tags = this.cyber.body.getEffectiveTags(s).toArray();
              const hasMod = !tags.includes("flesh-only") || tags.some((t) => t.includes("port") || t.includes("socket"));
              return (
                <div key={s} style={{ background: hasMod ? "#1a2a1a" : "#1a1a1a", border: `1px solid ${hasMod ? "#4a7" : "#333"}`, borderRadius: 4, padding: "4px 8px", fontSize: "0.8rem" }}>
                  <span style={{ color: "#9ad" }}>{s}</span>
                  {hasMod && <span style={{ marginLeft: 6, color: "#7c9", fontSize: "0.75rem" }}>
                    {tags.filter((t) => !["flesh-only"].includes(t) && !t.startsWith("hair") && !t.startsWith("skin")).join(" · ")}
                  </span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Cyberware loadout */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: "0.75rem", color: "#666", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Installed</div>
          {equipped.length === 0
            ? <div style={{ color: "#555", fontStyle: "italic", fontSize: "0.85rem" }}>Nothing bolted on yet</div>
            : equipped.map(([slot, inst]) => {
              const f = this.cyber.loadout.fit(slot, now)!;
              const ok = f.fit === "comfortable";
              return (
                <div key={slot} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: "1px solid #222" }}>
                  <span style={{ color: ok ? "#7c9" : "#e77", fontSize: "1.1rem" }}>{ok ? "◉" : "⚠"}</span>
                  <span style={{ flex: 1, fontSize: "0.85rem" }}>{inst.def.displayName ?? inst.def.id}</span>
                  <span style={{ color: "#555", fontSize: "0.75rem" }}>{slot}</span>
                </div>
              );
            })
          }
        </div>

        {/* Violations — player-facing prose, not JSON */}
        {violationLines.length > 0 && (
          <div style={{ background: "#2a1515", border: "1px solid #633", borderRadius: 4, padding: "8px 10px" }}>
            <div style={{ color: "#e77", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Compatibility Warning</div>
            {violationLines.map((line, i) => (
              <div key={i} style={{ fontSize: "0.85rem", color: "#e8c" }}>⚠ {line}</div>
            ))}
          </div>
        )}
      </div>
    );
  }
}
