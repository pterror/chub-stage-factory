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
 * speaking through tags. If it were really hard, the primitives would
 * have failed the dogfood test.
 *
 * PlaceholderRegistry demo: the MODS catalog is a PlaceholderRegistry.
 * The player can emit `<invent>head|torso</invent>` to commission Maven
 * to fabricate a new cyberware mod. The stage registers a placeholder
 * under a fresh id (so available_equip surfaces it with pending=true
 * next turn), kicks off generator.textGen, parses the response into an
 * EquipmentDef, and calls MODS.replace(id, real). Inventory of available
 * mods grows mid-chat without a parallel pending-map and without the
 * stage owning generation orchestration outside the registry primitive.
 *
 * Primitives: body, transformation, equipment, inventory, combat-turn,
 * effects, observation, prose-register, tag-parser, chub-adapters, rng,
 * persistence.
 *
 * Persistence — the showcase: every regime side-by-side.
 *   - body, loadout on chatState + forbidBranching (canon, surgery sticks)
 *   - inv on messageState + chubTreeHistory (swipe can un-take an item)
 *   - mode/tick on messageState + chubTreeHistory (per-branch turn)
 *   - rng on initState + noHistory
 *   - combatants on chatState + forbidBranching (the scav, like the
 *     duellist, is a person — combat damage carries across swipes)
 *   - "Save Slot" button calls store.saveSlot("manual") writing to every
 *     shard's backend prefixed; "Load Slot" restores them in lockstep.
 */

import { ReactElement } from "react";
import { StageResponse, InitialData, Message } from "@chub-ai/stages-ts";
import { Body } from "../../src/lib/body";
import { TransformationDef, apply as applyTf } from "../../src/lib/transformation";
import { EquipmentDef, Loadout, fromDict as eqFromDict } from "../../src/lib/equipment";
import { Inventory } from "../../src/lib/inventory";
import { ActionDef } from "../../src/lib/action";
import { Combatant, World, runRound, AttackProfile, CombatEvent } from "../../src/lib/combat-turn";
import { EffectStore, EffectDef } from "../../src/lib/effects";
import { Registry, PlaceholderRegistry } from "../../src/lib/registry";
import { Timeline, summarize } from "../../src/lib/timeline";
import { Rng } from "../../src/lib/rng";
import { parseTagsBatch } from "../../src/lib/tag-parser";
import { emitStageDirections } from "../../src/lib/chub-adapters";
import { assembleObservations, ObservationSource } from "../../src/lib/observation";
import {
  PersistenceStore, createChubLayers, chubTreeHistory, snapshotHistory, forbidBranching, noHistory,
  mergeResponses, shard, shardOf, withPersistence,
} from "../../src/lib/persistence";

interface MessageStateType { ticks: number; mode: "shop" | "combat" | "ended"; lastAction?: string; [k: string]: unknown }
interface ChatStateType { [k: string]: unknown }
type InitStateType = { [k: string]: unknown };
type ConfigType = null;

const TFS = new Registry<TransformationDef>({
  install_neural_port: { id: "install_neural_port", slot: "head", addTags: ["neural-port"], removeTags: ["flesh-only"], baseDuration: null, conflicts: {}, displayName: "neural port install" },
  install_spinal_port: { id: "install_spinal_port", slot: "torso", addTags: ["spinal-port"], removeTags: ["flesh-only"], baseDuration: null, conflicts: {}, displayName: "spinal port install" },
  fleshweave: { id: "fleshweave", slot: "head", addTags: ["flesh-only"], removeTags: ["neural-port"], baseDuration: null, conflicts: {}, displayName: "fleshweave" },
});

// MODS is a PlaceholderRegistry so the "invent cyberware" demo (see
// inventCyberware / <invent> tag) can register a placeholder under a
// fresh id, kick off generation, and replace it with the real def
// when the LLM returns — without a parallel pending-map. Static mods
// are seeded at construction; invented ones land alongside them.
const MODS = new PlaceholderRegistry<EquipmentDef>({
  deckjack: eqFromDict({ id: "deckjack", slot: "head", constraints: ["neural-port", "!flesh-only"], onConflict: "unequip", grantsTags: ["jacked-in-capable"], displayName: "deck-jack" }),
  reflex_booster: eqFromDict({ id: "reflex_booster", slot: "torso", constraints: ["spinal-port"], onConflict: "unequip", grantsTags: ["fast-twitch"], displayName: "reflex booster" }),
});

const REFLEX_EFFECT: EffectDef = {
  id: "fast-twitch", stacking: "replace", duration: null,
  targets: { stats: ["dodge"], tags: ["fast-twitch"] },
  baseMagnitudes: { stats: { dodge: 0.2 }, tagsAdd: ["fast-twitch"] },
};
const HACK_EFFECT: EffectDef = {
  id: "hacked", stacking: "replace", duration: 2,
  targets: { stats: ["dodge"] }, baseMagnitudes: { stats: { dodge: -0.2 } },
};
const EFFECT_DEFS = new Registry<EffectDef>()
  .register(REFLEX_EFFECT.id, REFLEX_EFFECT)
  .register(HACK_EFFECT.id, HACK_EFFECT);

const SWING: ActionDef<Combatant, Combatant, World> = { id: "swing", costs: { ap: 1 }, range: 1, effects: [], targetFilter: (a, t) => t.hp > 0 && t.id !== a.id };
const HACK: ActionDef<Combatant, Combatant, World> = {
  id: "hack", costs: { ap: 2 }, range: 99, effects: [HACK_EFFECT],
  targetFilter: (a, t) => t.hp > 0 && t.id !== a.id && (a.tags?.includes("jacked-in-capable") ?? false),
};
const ATTACK: AttackProfile = { damage: 6, type: "slash", crit: 0.1, accuracy: 0.85 };

interface CombatantSnap { id: string; hp: number; ap: number; tags: string[]; effects: ReturnType<EffectStore["toJSON"]> }
interface CombatantsSnap { items: CombatantSnap[]; ended?: "pc-down" | "enemy-down" }

function buildCombatants(grantTags: string[], grantEffects: EffectDef[], now: number): Combatant[] {
  const pcStore = new EffectStore();
  for (const e of grantEffects) pcStore.apply(e, now);
  return [
    { id: "pc", initiative: 12, hp: 28, resources: { ap: 3 },
      position: { x: 0, y: 0 }, stats: { dodge: 0.1, armor: 1 }, tags: grantTags, effects: pcStore },
    { id: "scav", initiative: 9, hp: 22, resources: { ap: 2 },
      position: { x: 1, y: 0 }, stats: { dodge: 0.05, armor: 2 }, effects: new EffectStore() },
  ];
}

function snapCombatants(holder: { cs: Combatant[]; ended?: "pc-down" | "enemy-down" }): CombatantsSnap {
  return {
    items: holder.cs.map((c) => ({
      id: c.id, hp: c.hp, ap: c.resources?.ap ?? 0,
      tags: c.tags ?? [],
      effects: c.effects?.toJSON() ?? { instances: [] },
    })),
    ended: holder.ended,
  };
}
function restoreCombatants(holder: { cs: Combatant[]; ended?: "pc-down" | "enemy-down" }, data: CombatantsSnap): void {
  if (holder.cs.length === 0) {
    // Pre-build skeletons if we deserialize before buildCombat runs.
    holder.cs = buildCombatants([], [], 0);
  }
  for (const snap of data.items) {
    let c = holder.cs.find((x) => x.id === snap.id);
    if (!c) {
      c = { id: snap.id, initiative: 10, hp: snap.hp, resources: { ap: snap.ap },
        position: { x: 0, y: 0 }, stats: {}, effects: new EffectStore(), tags: snap.tags };
      holder.cs.push(c);
    }
    c.hp = snap.hp;
    if (c.resources) c.resources.ap = snap.ap;
    c.tags = snap.tags;
    c.effects = EffectStore.fromJSON(snap.effects, EFFECT_DEFS.toJSON());
  }
  holder.ended = data.ended;
}

export class CompositeShowcaseStage extends withPersistence<ChatStateType, InitStateType, MessageStateType, ConfigType>() {
  body: Body;
  loadout: Loadout;
  inv: Inventory;
  rng = Rng.fromSeed("mavens-clinic");
  combatantsHolder: { cs: Combatant[]; ended?: "pc-down" | "enemy-down" } = { cs: [] };
  events = new Timeline<CombatEvent>({ id: "combat-events", channels: ["auditory"], key: "last_events", windowSize: 12, habituationTau: 0 });
  tick = { n: 0, mode: "shop" as "shop" | "combat" | "ended", lastAction: undefined as string | undefined };
  pcChoice: "swing" | "hack" = "swing";
  layers = createChubLayers();
  slotMsg: string | null = null;

  constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
    super(data);
    this.body = new Body({
      head: ["flesh-only", "hair-short"], torso: ["flesh-only"],
      arms: ["human", "hands"], legs: ["human", "feet"],
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

    this.layers = createChubLayers({
      messageState: (data.messageState as Record<string, string | undefined> | null) ?? null,
      chatState: (data.chatState as Record<string, string | undefined> | null) ?? null,
      initState: (data.initState as Record<string, string | undefined> | null) ?? null,
    });
    this.initStore(() => new PersistenceStore({
      rng: shardOf("rng", this.rng, (d) => Rng.fromJSON(d), this.layers.initStateBackend, noHistory()),
      tick: shard("tick", this.tick,
        (i) => ({ n: i.n, mode: i.mode, lastAction: i.lastAction }),
        (d: { n: number; mode: "shop" | "combat" | "ended"; lastAction?: string }) => ({ n: d.n, mode: d.mode, lastAction: d.lastAction }),
        this.layers.messageStateBackend, chubTreeHistory()),
      inv: shardOf("inv", this.inv, (d) => Inventory.fromJSON(d), this.layers.messageStateBackend, chubTreeHistory()),
      body: shardOf("body", this.body, (d) => Body.fromJSON(d), this.layers.chatStateBackend, forbidBranching(snapshotHistory())),
      loadout: shard("loadout", this.loadout, (i) => i.toJSON(), (d: ReturnType<Loadout["toJSON"]>) => Loadout.fromJSON(d, this.body, MODS.toJSON()), this.layers.chatStateBackend, forbidBranching(snapshotHistory())),
      combatants: shard("combatants", this.combatantsHolder,
        (h) => snapCombatants(h),
        (d: CombatantsSnap) => {
          restoreCombatants(this.combatantsHolder, d);
          return this.combatantsHolder;
        },
        this.layers.chatStateBackend, forbidBranching(snapshotHistory())),
    }));
  }

  private grantsForEquipped(): { tags: string[]; effects: EffectDef[] } {
    const tags: string[] = []; const effects: EffectDef[] = [];
    for (const [, inst] of this.loadout.getAllEquipped()) {
      for (const t of inst.def.grantsTags ?? []) tags.push(t);
      if (inst.def.id === "reflex_booster") effects.push(REFLEX_EFFECT);
    }
    return { tags, effects };
  }

  /**
   * PlaceholderRegistry demo. Player triggers <invent>slot</invent>; we
   * register a placeholder MOD immediately (so available_equip surfaces
   * it as pending=true to the LLM next turn), fire off a textGen, parse
   * the response into an EquipmentDef, and call MODS.replace(id, def).
   * Any callsite that already `await`ed `MODS.waitFor(id)` resolves with
   * the real def — no parallel pending-map needed.
   *
   * Live-LLM verification limited by the dev TestStageRunner harness; the
   * static-typecheck and build-all-examples passes confirm the wiring is
   * sound. The integration runs end-to-end inside Chub at deploy time.
   */
  private inventCyberware(slot: string, now: number): string {
    const id = `cw_${now}_${this.rng.cosmetic.next()}`;
    MODS.registerPlaceholder(id, eqFromDict({
      id, slot, constraints: [],
      onConflict: "unequip", grantsTags: [],
      displayName: `(Maven fabricating ${slot} mod...)`,
    }));
    // Fire and forget; the replace call resolves any prior waitFor.
    void this.generateCyberware(id, slot);
    return id;
  }

  private async generateCyberware(id: string, slot: string): Promise<void> {
    const prompt = [
      "You are inventing a single piece of cyberpunk cyberware for slot: " + slot + ".",
      "Reply with ONLY a JSON block inside <mod>...</mod>:",
      `<mod>{"displayName":"...", "constraints":["tag-needed", "!incompatible-tag"], "grantsTags":["granted"]}</mod>`,
      "constraints are tag predicates ('!' prefix negates); grantsTags are added to the body when equipped.",
    ].join("\n");
    try {
      const resp = await this.generator.textGen({ prompt, max_tokens: 200 });
      const body = resp?.result ?? "";
      const m = /<mod>([\s\S]*?)<\/mod>/i.exec(body);
      if (!m) { this.failInvent(id); return; }
      const parsed = JSON.parse(m[1]) as { displayName?: string; constraints?: string[]; grantsTags?: string[] };
      const real = eqFromDict({
        id, slot,
        constraints: parsed.constraints ?? [],
        onConflict: "unequip",
        grantsTags: parsed.grantsTags ?? [],
        displayName: parsed.displayName ?? id,
      });
      MODS.replace(id, real);
    } catch {
      this.failInvent(id);
    }
  }

  private failInvent(id: string): void {
    // Resolve with a no-op def so any waiters don't hang; mark the
    // displayName so the LLM sees the failure in available_equip.
    const slot = MODS.get(id)?.slot ?? "head";
    MODS.replace(id, eqFromDict({
      id, slot, constraints: ["__unfabricable__"],
      onConflict: "unequip", grantsTags: [],
      displayName: "(fabrication failed)",
    }));
  }

  private buildCombat() {
    const { tags, effects } = this.grantsForEquipped();
    this.combatantsHolder.cs = buildCombatants(tags, effects, this.tick.n);
    this.combatantsHolder.ended = undefined;
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
        properties: { interoceptive: { slots: () => {
          const out: Record<string, string[]> = {};
          for (const [s, t] of this.body.getAllEffectiveTags()) out[s] = t.toArray();
          return out;
        } } },
      },
      {
        id: "loadout", channels: ["visual"], salience: () => 0.4, habituationTau: 6,
        properties: { visual: {
          equipped: () => [...this.loadout.getAllEquipped()].map(([slot, inst]) => ({ slot, id: inst.def.id, fit: this.loadout.fit(slot, now)?.fit })),
          grants: () => this.grantsForEquipped().tags,
          violations: () => this.loadout.checkAllConstraints(),
        } },
      },
    ];
    if (this.tick.mode === "shop") {
      baseSources.push({
        id: "shop", channels: ["visual"], salience: () => 0.5, habituationTau: 4,
        properties: { visual: {
          inventory: () => {
            const out: Record<string, { item: string; count: number }[]> = {};
            for (const spot of this.inv.spots()) {
              out[spot] = this.inv.contents(spot).map((s) => ({ item: this.inv.getDef(s.defId)?.displayName ?? s.defId, count: s.count }));
            }
            return out;
          },
          available_tfs: () => TFS.keys(),
          available_equip: () => MODS.entries().map(([id, m]) => ({ id, slot: m.slot, requires: m.constraints, pending: MODS.isPlaceholder(id) })),
        } },
      });
    } else {
      baseSources.push({
        id: "combat", channels: ["visual"], salience: () => 1, habituationTau: 0,
        properties: { visual: {
          combatants: () => this.combatantsHolder.cs.map((c) => ({
            id: c.id, hp: c.hp, ap: c.resources?.ap ?? 0,
            dodge: (c.stats?.dodge ?? 0) + (c.effects?.totalMagnitudes(now).stats?.dodge ?? 0),
            tags: c.tags ?? [], effects: c.effects?.active().map((i) => i.id) ?? [],
          })),
        } },
      });
      // Append the combat-events timeline as its own source; it provides
      // last_events on the auditory channel via ObservationSource.
      baseSources.push(this.events);
    }
    return baseSources;
  }

  async beforePrompt(msg: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    this.tick.n += 1;
    const now = this.tick.n;
    const observed = assembleObservations(this.observationSources(now), { now }, { now, maxCount: 5 });
    const prefix = this.tick.mode === "shop"
      ? "Maven runs the clinic. Tags she understands from you (the LLM): " +
        "`<install>install_neural_port|install_spinal_port|fleshweave</install>`, " +
        "`<equip>deckjack|reflex_booster|...</equip>` (any id in available_equip; entries " +
        "with pending=true are still being fabricated), `<unequip>head|torso</unequip>`, " +
        "`<take>deckjack|reflex_booster|stim</take>` (from counter or locker to pocket), " +
        "`<invent>head|torso</invent>` to commission Maven to fabricate a NEW cyberware mod " +
        "for that slot — she'll spin up a placeholder you can see in available_equip and " +
        "fill it in over the next message. `<start_combat>true</start_combat>` to draw on " +
        "the scav waiting at the door. If equipment violations exist, surface them in prose " +
        "before any action."
      : "Combat with the scav. To pick the player's action emit `<action>swing|hack</action>` " +
        "(hack requires jacked-in-capable tag). Last-events lists what just happened — " +
        "render it; do not invent hits.";
    const stageDirections = emitStageDirections({
      observations: observed,
      architectures: this.tick.mode === "shop" ? ["body_then_world", "appositive_fold"] : ["fragment_cascade", "terminal_sense_shift"],
      register: { pov: "close-second", tense: "present", distance: "close" },
      prefix,
    });
    return mergeResponses({ stageDirections }, await this.bound.beforePrompt(msg));
  }

  async afterResponse(botMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    const now = this.tick.n;
    const [r1, r2, r3, r4, r5, r6, r7] = parseTagsBatch(botMessage.content, [
      { install: { kind: "string", enum: TFS.keys() } },
      { equip: { kind: "string" } },
      { unequip: { kind: "string", enum: ["head", "torso"] } },
      { take: { kind: "string" } },
      { start_combat: { kind: "bool" } },
      { action: { kind: "string", enum: ["swing", "hack"] } },
      { invent: { kind: "string", enum: ["head", "torso"] } },
    ]);
    const text = r7.stripped;

    if (this.tick.mode === "shop") {
      if (typeof r1.parsed.install === "string" && r1.parsed.install) {
        applyTf(TFS.require(r1.parsed.install as string), this.body, now);
        this.tick.lastAction = `installed:${r1.parsed.install}`;
      }
      if (typeof r2.parsed.equip === "string" && r2.parsed.equip) {
        const modDef = MODS.get(r2.parsed.equip as string);
        if (!modDef) { this.tick.lastAction = `equip-failed:no-such-mod`; }
        else {
        const res = this.loadout.equip(modDef, now);
        this.tick.lastAction = res.ok ? `equipped:${r2.parsed.equip}` : `equip-failed:${(res as { reason: string }).reason}`;
        }
      }
      if (typeof r3.parsed.unequip === "string" && r3.parsed.unequip) {
        this.loadout.unequip(r3.parsed.unequip as string);
        this.tick.lastAction = `unequipped:${r3.parsed.unequip}`;
      }
      if (typeof r4.parsed.take === "string" && r4.parsed.take) {
        const found = this.inv.find(r4.parsed.take as string);
        if (found.length) {
          const def = this.inv.getDef(r4.parsed.take as string);
          if (def && !this.inv.capacityOK("pocket", def, 1)) {
            const v = this.inv.capacityViolation("pocket", def, 1);
            this.tick.lastAction = `take-refused:${r4.parsed.take}:${v?.kind}-over-${v?.overBy?.toFixed(1)}`;
          } else {
            this.inv.move(found[0].spot, "pocket", r4.parsed.take as string, 1);
            this.tick.lastAction = `took:${r4.parsed.take}`;
          }
        }
      }
      if (typeof r7.parsed.invent === "string" && r7.parsed.invent) {
        const slot = r7.parsed.invent as string;
        const id = this.inventCyberware(slot, now);
        this.tick.lastAction = `inventing:${id}`;
      }
      if (r5.parsed.start_combat === true) {
        this.tick.mode = "combat";
        this.buildCombat();
        this.events.clear();
        this.tick.lastAction = "combat-started";
      }
    } else if (this.tick.mode === "combat") {
      if (typeof r6.parsed.action === "string" && r6.parsed.action) this.pcChoice = r6.parsed.action as "swing" | "hack";
      const cs = this.combatantsHolder.cs;
      for (const c of cs) if (c.resources) c.resources.ap = c.id === "pc" ? 3 : 2;
      for (const c of cs) c.effects?.tick(now);
      const round = runRound(cs, this.chooseFor, { combatants: cs }, now, this.rng.mechanical);
      for (const e of round) this.events.push(e, now);
      const pc = cs.find((c) => c.id === "pc")!;
      const scav = cs.find((c) => c.id === "scav")!;
      if (pc.hp <= 0) { this.combatantsHolder.ended = "pc-down"; this.tick.mode = "ended"; }
      else if (scav.hp <= 0) { this.combatantsHolder.ended = "enemy-down"; this.tick.mode = "ended"; }
    }
    const stripped = text !== botMessage.content ? text : null;
    const sys = this.combatantsHolder.ended ? `[combat ends: ${this.combatantsHolder.ended}]` : null;
    return mergeResponses({ modifiedMessage: stripped, systemMessage: sys }, await this.bound.afterResponse(botMessage));
  }

  // Manual slot UI handlers. saveSlot/loadSlot persist via each shard's
  // own backend with a "__slot__manual__<shardName>" key — independent of
  // the per-message tree.
  saveSlot = async () => {
    await this.store.saveSlot("manual");
    this.slotMsg = `saved @ tick ${this.tick.n}`;
    this.forceRerender();
  };
  loadSlot = async () => {
    await this.store.loadSlot("manual");
    this.slotMsg = `loaded`;
    this.forceRerender();
  };
  private rerender = 0;
  private forceRerender(): void {
    // Trigger React update by mutating a counter the render reads.
    this.rerender += 1;
    // The render method runs on each re-render the host triggers; this
    // is a best-effort nudge for the dev TestRunner.
  }

  render(): ReactElement {
    const _ = this.rerender;
    return (
      <div style={{ padding: 12, fontFamily: "ui-monospace, monospace", color: "#ddd", background: "#111" }}>
        <h3 style={{ marginTop: 0 }}>Maven&apos;s clinic — {this.tick.mode} — tick {this.tick.n}</h3>
        <div style={{ marginBottom: 8 }}>
          <button onClick={this.saveSlot} style={{ marginRight: 8 }}>Save Slot</button>
          <button onClick={this.loadSlot}>Load Slot</button>
          {this.slotMsg && <span style={{ marginLeft: 12, opacity: 0.7 }}>{this.slotMsg}</span>}
        </div>
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
              <li key={slot}>{inst.def.id} on {slot} — {this.loadout.fit(slot, this.tick.n)?.fit}</li>
            ))}</ul>
            <div style={{ fontSize: "0.85rem", opacity: 0.7 }}>last: {this.tick.lastAction ?? "—"}</div>
          </div>
          <div>
            {this.tick.mode === "shop" ? (
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
                  {this.combatantsHolder.cs.map((c) => (
                    <tr key={c.id}><td style={{ color: "#9ad" }}>{c.id}</td><td>HP {c.hp}</td><td>AP {c.resources?.ap}</td><td>{c.effects?.active().map((i) => i.id).join(",") || "—"}</td></tr>
                  ))}
                </tbody></table>
                <pre style={{ background: "#000", padding: 6, maxHeight: 160, overflow: "auto" }}>{summarize(this.events.window(30), (e, at) => `${at}: ${JSON.stringify(e)}`) || "—"}</pre>
                {this.combatantsHolder.ended && <h4 style={{ color: "#e88" }}>End: {this.combatantsHolder.ended}</h4>}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
}
