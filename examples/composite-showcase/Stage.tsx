/*
 * composite-showcase/Stage.tsx — Maven's clinic.
 *
 * Setting: a cyberpunk ripperdoc-and-fence storefront with three concerns
 * the player can drive through prose + tags:
 *   1. body/TF: install ports, fleshweave back to baseline.
 *   2. equipment: bolt cyberware onto the body subject to tag constraints.
 *   3. inventory: spot-based gear in the clinic (counter, locker, person).
 *   4. turn-combat: a duel against a rogue scav with the player's loadout
 *      affecting their stats; effects from cyberware (fast-twitch -> +dodge).
 *
 * One stage, one prompt block, one observation payload, every primitive
 * speaking through tags. ~330 LOC; if it were really hard, the primitives
 * would have failed the dogfood test.
 *
 * Primitives: body, transformation, equipment, inventory, combat-turn,
 * effects, observation, prose-register, tag-parser, chub-adapters, rng.
 * Philosophy: every rule in lib/README.md is exercised somewhere here —
 * the LLM controls action selection through tags, the stage maintains the
 * world model, and prose emerges from the LLM's reading of the
 * observation block.
 */

import { ReactElement } from "react";
import { StageBase, StageResponse, InitialData, Message } from "@chub-ai/stages-ts";
import { LoadResponse } from "@chub-ai/stages-ts/dist/types/load";
import { Body } from "../../src/lib/body";
import { TransformationDef, apply as applyTf } from "../../src/lib/transformation";
import { EquipmentDef, Loadout, fromDict as eqFromDict } from "../../src/lib/equipment";
import { Inventory } from "../../src/lib/inventory";
import { ActionDef } from "../../src/lib/action";
import { Combatant, World, runRound, AttackProfile, CombatEvent } from "../../src/lib/combat-turn";
import { EffectStore, EffectDef } from "../../src/lib/effects";
import { Rng } from "../../src/lib/rng";
import { parseTags } from "../../src/lib/tag-parser";
import { emitStageDirections } from "../../src/lib/chub-adapters";
import { assembleObservations, ObservationSource } from "../../src/lib/observation";

interface MessageStateType {
  ticks: number; mode: "shop" | "combat" | "ended";
  ended?: "pc-down" | "enemy-down"; lastAction?: string;
}
type ChatStateType = null; type InitStateType = null; type ConfigType = null;

const TFS: Record<string, TransformationDef> = {
  install_neural_port: { id: "install_neural_port", slot: "head", addTags: ["neural-port"], removeTags: ["flesh-only"], baseDuration: null, conflicts: {}, displayName: "neural port install" },
  install_spinal_port: { id: "install_spinal_port", slot: "torso", addTags: ["spinal-port"], removeTags: ["flesh-only"], baseDuration: null, conflicts: {}, displayName: "spinal port install" },
  fleshweave: { id: "fleshweave", slot: "head", addTags: ["flesh-only"], removeTags: ["neural-port"], baseDuration: null, conflicts: {}, displayName: "fleshweave" },
};

const MODS: Record<string, EquipmentDef> = {
  deckjack: eqFromDict({ id: "deckjack", slot: "head", constraints: ["neural-port", "!flesh-only"], onConflict: "unequip", grantsTags: ["jacked-in-capable"], displayName: "deck-jack" }),
  reflex_booster: eqFromDict({ id: "reflex_booster", slot: "torso", constraints: ["spinal-port"], onConflict: "unequip", grantsTags: ["fast-twitch"], displayName: "reflex booster" }),
};

// Cyberware grants come back as an effect when equipped, so combat sees them.
const REFLEX_EFFECT: EffectDef = {
  id: "fast-twitch", stacking: "replace", duration: null,
  targets: { stats: ["dodge"], tags: ["fast-twitch"] },
  baseMagnitudes: { stats: { dodge: 0.2 }, tagsAdd: ["fast-twitch"] },
};

const SWING: ActionDef<Combatant, Combatant, World> = { id: "swing", costs: { ap: 1 }, range: 1, effects: [], targetFilter: (a, t) => t.hp > 0 && t.id !== a.id };
const HACK: ActionDef<Combatant, Combatant, World> = {
  id: "hack", costs: { ap: 2 }, range: 99, effects: [{
    id: "hacked", stacking: "replace", duration: 2,
    targets: { stats: ["dodge"] }, baseMagnitudes: { stats: { dodge: -0.2 } },
  }],
  targetFilter: (a, t) => t.hp > 0 && t.id !== a.id && (a.tags?.includes("jacked-in-capable") ?? false),
};

const ATTACK: AttackProfile = { damage: 6, type: "slash", crit: 0.1, accuracy: 0.85 };

export class CompositeShowcaseStage extends StageBase<InitStateType, ChatStateType, MessageStateType, ConfigType> {
  body: Body;
  loadout: Loadout;
  inv: Inventory;
  rng = Rng.fromSeed("mavens-clinic");
  combatants: Combatant[] = [];
  events: CombatEvent[] = [];
  msg: MessageStateType = { ticks: 0, mode: "shop" };
  pcChoice: "swing" | "hack" = "swing";

  constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
    super(data);
    this.body = new Body({
      head: ["flesh-only", "hair-short"],
      torso: ["flesh-only"],
      arms: ["human", "hands"],
      legs: ["human", "feet"],
    });
    this.loadout = new Loadout(this.body);
    this.inv = new Inventory();
    this.inv
      .register({ id: "deckjack", carryClass: "explicit", portable: true, counted: false, defaultSpot: "counter", displayName: "deck-jack" })
      .register({ id: "reflex_booster", carryClass: "explicit", portable: true, counted: false, defaultSpot: "counter", displayName: "reflex booster" })
      .register({ id: "stim", carryClass: "habitual", portable: true, counted: true, defaultSpot: "locker", displayName: "combat stim" })
      .register({ id: "credchip", carryClass: "habitual", portable: true, counted: false, defaultSpot: "pocket", displayName: "credchip" });
    this.inv.ensureSpot("counter").ensureSpot("locker", { disorder: 0.4 }).ensureSpot("pocket");
    this.inv.add("counter", "deckjack");
    this.inv.add("counter", "reflex_booster");
    this.inv.add("locker", "stim", 3);
    this.inv.add("pocket", "credchip");
    if (data.messageState) this.msg = { ...this.msg, ...data.messageState };
  }

  async load(): Promise<Partial<LoadResponse<InitStateType, ChatStateType, MessageStateType>>> {
    return { success: true, error: null, initState: null, chatState: null };
  }
  async setState(state: MessageStateType): Promise<void> { if (state) this.msg = { ...this.msg, ...state }; }

  private grantsForEquipped(): { tags: string[]; effects: EffectDef[] } {
    const tags: string[] = []; const effects: EffectDef[] = [];
    for (const [, inst] of this.loadout.getAllEquipped()) {
      for (const t of inst.def.grantsTags ?? []) tags.push(t);
      if (inst.def.id === "reflex_booster") effects.push(REFLEX_EFFECT);
    }
    return { tags, effects };
  }

  private buildCombat() {
    const { tags, effects } = this.grantsForEquipped();
    const pcStore = new EffectStore();
    for (const eff of effects) pcStore.apply(eff, this.msg.ticks);
    const pc: Combatant = {
      id: "pc", initiative: 12, hp: 28, resources: { ap: 3 },
      position: { x: 0, y: 0 }, stats: { dodge: 0.1, armor: 1 }, tags, effects: pcStore,
    };
    const scav: Combatant = {
      id: "scav", initiative: 9, hp: 22, resources: { ap: 2 },
      position: { x: 1, y: 0 }, stats: { dodge: 0.05, armor: 2 }, effects: new EffectStore(),
    };
    this.combatants = [pc, scav];
  }

  private chooseFor = (actor: Combatant, world: World) => {
    if (actor.id === "pc") {
      const target = world.combatants.find((c) => c.id === "scav")!;
      if (this.pcChoice === "hack" && actor.tags?.includes("jacked-in-capable")) return { action: HACK, target };
      return { action: SWING, target, profile: ATTACK };
    }
    const target = world.combatants.find((c) => c.id === "pc")!;
    return { action: SWING, target, profile: ATTACK };
  };

  private observationSources(now: number): ObservationSource<{ now: number }>[] {
    const baseSources: ObservationSource<{ now: number }>[] = [
      {
        id: "body", channels: ["interoceptive"], salience: () => 0.4, habituationTau: 6,
        properties: {
          interoceptive: {
            slots: () => {
              const out: Record<string, string[]> = {};
              for (const [s, t] of this.body.getAllEffectiveTags()) out[s] = t.toArray();
              return out;
            },
          },
        },
      },
      {
        id: "loadout", channels: ["visual"], salience: () => 0.4, habituationTau: 6,
        properties: {
          visual: {
            equipped: () => [...this.loadout.getAllEquipped()].map(([slot, inst]) => ({
              slot, id: inst.def.id, fit: this.loadout.fit(slot, now)?.fit,
            })),
            grants: () => this.grantsForEquipped().tags,
            violations: () => this.loadout.checkAllConstraints(),
          },
        },
      },
    ];
    if (this.msg.mode === "shop") {
      baseSources.push({
        id: "shop", channels: ["visual"], salience: () => 0.5, habituationTau: 4,
        properties: {
          visual: {
            inventory: () => {
              const out: Record<string, { item: string; count: number }[]> = {};
              for (const spot of this.inv.spots()) {
                out[spot] = this.inv.contents(spot).map((s) => ({
                  item: this.inv.getDef(s.defId)?.displayName ?? s.defId, count: s.count,
                }));
              }
              return out;
            },
            available_tfs: () => Object.keys(TFS),
            available_equip: () => Object.entries(MODS).map(([id, m]) => ({ id, slot: m.slot, requires: m.constraints })),
          },
        },
      });
    } else {
      baseSources.push({
        id: "combat", channels: ["visual"], salience: () => 1, habituationTau: 0,
        properties: {
          visual: {
            combatants: () => this.combatants.map((c) => ({
              id: c.id, hp: c.hp, ap: c.resources?.ap ?? 0,
              dodge: (c.stats?.dodge ?? 0) + (c.effects?.totalMagnitudes(now).stats?.dodge ?? 0),
              tags: c.tags ?? [],
              effects: c.effects?.active().map((i) => i.id) ?? [],
            })),
            last_events: () => this.events.slice(-12),
          },
        },
      });
    }
    return baseSources;
  }

  async beforePrompt(_userMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    const now = ++this.msg.ticks;
    const observed = assembleObservations(this.observationSources(now), { now }, { now, maxCount: 5 });
    const prefix = this.msg.mode === "shop"
      ? "Maven runs the clinic. Tags she understands from you (the LLM): " +
        "`<install>install_neural_port|install_spinal_port|fleshweave</install>`, " +
        "`<equip>deckjack|reflex_booster</equip>`, `<unequip>head|torso</unequip>`, " +
        "`<take>deckjack|reflex_booster|stim</take>` (from counter or locker to pocket), " +
        "`<start_combat>true</start_combat>` to draw on the scav waiting at the door. " +
        "If equipment violations exist, surface them in prose before any action."
      : "Combat with the scav. To pick the player's action emit `<action>swing|hack</action>` " +
        "(hack requires jacked-in-capable tag). Last-events lists what just happened — " +
        "render it; do not invent hits.";
    const stageDirections = emitStageDirections({
      observations: observed,
      architectures: this.msg.mode === "shop" ? ["body_then_world", "appositive_fold"] : ["fragment_cascade", "terminal_sense_shift"],
      register: "close-2nd-present",
      prefix,
    });
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
    const r4 = parseTags<Record<string, unknown>>(text, { take: { kind: "string" } });
    text = r4.stripped;
    const r5 = parseTags<Record<string, unknown>>(text, { start_combat: { kind: "bool" } });
    text = r5.stripped;
    const r6 = parseTags<Record<string, unknown>>(text, { action: { kind: "string", enum: ["swing", "hack"] } });
    text = r6.stripped;

    if (this.msg.mode === "shop") {
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
      if (typeof r4.parsed.take === "string" && r4.parsed.take) {
        const found = this.inv.find(r4.parsed.take as string);
        if (found.length) {
          this.inv.move(found[0].spot, "pocket", r4.parsed.take as string, 1);
          this.msg.lastAction = `took:${r4.parsed.take}`;
        }
      }
      if (r5.parsed.start_combat === true) {
        this.msg.mode = "combat";
        this.buildCombat();
        this.events = [];
        this.msg.lastAction = "combat-started";
      }
    } else if (this.msg.mode === "combat") {
      if (typeof r6.parsed.action === "string" && r6.parsed.action) {
        this.pcChoice = r6.parsed.action as "swing" | "hack";
      }
      for (const c of this.combatants) c.resources!.ap = c.id === "pc" ? 3 : 2;
      for (const c of this.combatants) c.effects?.tick(now);
      this.events = runRound(this.combatants, this.chooseFor, { combatants: this.combatants }, now, this.rng.mechanical);
      const pc = this.combatants.find((c) => c.id === "pc")!;
      const scav = this.combatants.find((c) => c.id === "scav")!;
      if (pc.hp <= 0) { this.msg.ended = "pc-down"; this.msg.mode = "ended"; }
      else if (scav.hp <= 0) { this.msg.ended = "enemy-down"; this.msg.mode = "ended"; }
    }
    return {
      messageState: this.msg,
      modifiedMessage: text !== botMessage.content ? text : null,
      systemMessage: this.msg.ended ? `[combat ends: ${this.msg.ended}]` : null,
    };
  }

  render(): ReactElement {
    return (
      <div style={{ padding: 12, fontFamily: "ui-monospace, monospace", color: "#ddd", background: "#111" }}>
        <h3 style={{ marginTop: 0 }}>Maven&apos;s clinic — {this.msg.mode} — tick {this.msg.ticks}</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <h4>Body</h4>
            <table><tbody>
              {this.body.getSlots().map((s) => (
                <tr key={s}><td style={{ color: "#9ad", padding: "2px 8px" }}>{s}</td><td>{this.body.getEffectiveTags(s).toArray().join(", ") || "—"}</td></tr>
              ))}
            </tbody></table>
            <h4>Equipped</h4>
            <ul>{[...this.loadout.getAllEquipped()].map(([slot, inst]) => (
              <li key={slot}>{inst.def.id} on {slot} — {this.loadout.fit(slot, this.msg.ticks)?.fit}</li>
            ))}</ul>
            <div style={{ fontSize: "0.85rem", opacity: 0.7 }}>last: {this.msg.lastAction ?? "—"}</div>
          </div>
          <div>
            {this.msg.mode === "shop" ? (
              <>
                <h4>Inventory</h4>
                {this.inv.spots().map((s) => (
                  <div key={s}><b>{s}:</b> {this.inv.contents(s).map((st) => `${this.inv.getDef(st.defId)?.displayName ?? st.defId}×${st.count}`).join(", ") || "—"}</div>
                ))}
              </>
            ) : (
              <>
                <h4>Combat</h4>
                <table><tbody>
                  {this.combatants.map((c) => (
                    <tr key={c.id}><td style={{ color: "#9ad" }}>{c.id}</td><td>HP {c.hp}</td><td>AP {c.resources?.ap}</td><td>{c.effects?.active().map((i) => i.id).join(",") || "—"}</td></tr>
                  ))}
                </tbody></table>
                <pre style={{ background: "#000", padding: 6, maxHeight: 160, overflow: "auto" }}>{this.events.map((e) => JSON.stringify(e)).join("\n") || "—"}</pre>
                {this.msg.ended && <h4 style={{ color: "#e88" }}>End: {this.msg.ended}</h4>}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
}
