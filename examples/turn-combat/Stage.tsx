/*
 * turn-combat/Stage.tsx — duel on the steps.
 *
 * Mechanic: PC vs one enemy (a temple-step duellist). The LLM emits
 * `<action>swing|guard|sunder</action>` to choose the PC's move; the stage
 * runs one round (initiative-ordered, damage pipeline, effects). Events
 * surface to the LLM through observation, not prose.
 *
 * Primitives: action, combat-turn, effects, rng, tag-parser, persistence.
 * Philosophy: rule #3 (events are data; LLM renders), rule #7 (mechanical
 * RNG stream separate from any cosmetic noise).
 *
 * Persistence: per the plan —
 *   - `turn` (round counter, queued choice): messageState + chubTreeHistory
 *   - `combatants` (persistent HP/effects): chatState + forbidBranching.
 *     A swipe re-narrates a round but does NOT un-damage anyone; the
 *     duellist is a persistent person. This is a deliberate game-design
 *     stance — pair with messageState-tree mechanics where roll outcomes
 *     should explore alternates.
 */

import { ReactElement } from "react";
import { StageBase, StageResponse, InitialData, Message } from "@chub-ai/stages-ts";
import { LoadResponse } from "@chub-ai/stages-ts/dist/types/load";
import { ActionDef } from "../../src/lib/action";
import { Combatant, World, runRound, AttackProfile, CombatEvent } from "../../src/lib/combat-turn";
import { EffectStore, EffectDef } from "../../src/lib/effects";
import { Registry } from "../../src/lib/registry";
import { Timeline, summarize } from "../../src/lib/timeline";
import { Rng } from "../../src/lib/rng";
import { parseTags } from "../../src/lib/tag-parser";
import { emitStageDirections } from "../../src/lib/chub-adapters";
import { assembleObservations, ObservationSource } from "../../src/lib/observation";
import {
  PersistenceStore, createChubLayers, chubTreeHistory, snapshotHistory, forbidBranching,
  bindStore, mergeResponses, shard,
} from "../../src/lib/persistence";

interface MessageStateType { round: number; choice?: string; [k: string]: unknown }
interface ChatStateType { [k: string]: unknown }
type InitStateType = null;
type ConfigType = null;

const GUARD_EFFECT: EffectDef = {
  id: "guarded", duration: 1, stacking: "replace",
  targets: { stats: ["armor"] }, baseMagnitudes: { stats: { armor: 3 } },
};
const SUNDER_EFFECT: EffectDef = {
  id: "sundered", duration: 2, stacking: "replace",
  targets: { stats: ["armor"] }, baseMagnitudes: { stats: { armor: -2 } },
};
const EFFECT_DEFS = new Registry<EffectDef>()
  .register(GUARD_EFFECT.id, GUARD_EFFECT)
  .register(SUNDER_EFFECT.id, SUNDER_EFFECT);

const SWING: ActionDef<Combatant, Combatant, World> = {
  id: "swing", costs: { ap: 1 }, range: 1, effects: [],
  targetFilter: (a, t) => t.hp > 0 && t.id !== a.id,
};
const GUARD: ActionDef<Combatant, Combatant, World> = {
  id: "guard", costs: { ap: 1 }, range: 0, effects: [GUARD_EFFECT],
  targetFilter: (a, t) => t.id === a.id,
};
const SUNDER: ActionDef<Combatant, Combatant, World> = {
  id: "sunder", costs: { ap: 2 }, range: 1, cooldown: 2, effects: [SUNDER_EFFECT],
  targetFilter: (a, t) => t.hp > 0 && t.id !== a.id,
};
const ATTACK: AttackProfile = { damage: 6, type: "slash", crit: 0.1, accuracy: 0.85 };
const SUNDER_PROFILE: AttackProfile = { damage: 3, type: "blunt", crit: 0, accuracy: 0.9 };

// Serializable form of a combatant for the persistence layer.
interface CombatantSnap {
  id: string;
  hp: number;
  ap: number;
  effects: ReturnType<EffectStore["toJSON"]>;
}
interface CombatantsSnap { items: CombatantSnap[]; ended?: "pc-down" | "enemy-down" }

function buildCombatants(): Combatant[] {
  return [
    { id: "pc", initiative: 12, hp: 30, resources: { ap: 3 },
      position: { x: 0, y: 0 }, stats: { dodge: 0.15, armor: 1, critResist: 0.05 },
      effects: new EffectStore() },
    { id: "duellist", initiative: 10, hp: 22, resources: { ap: 2 },
      position: { x: 1, y: 0 }, stats: { dodge: 0.1, armor: 2 },
      effects: new EffectStore() },
  ];
}

function snapCombatants(cs: Combatant[], ended?: "pc-down" | "enemy-down"): CombatantsSnap {
  return {
    items: cs.map((c) => ({
      id: c.id, hp: c.hp, ap: c.resources?.ap ?? 0,
      effects: c.effects?.toJSON() ?? { instances: [] },
    })),
    ended,
  };
}

function restoreCombatants(holder: { cs: Combatant[]; ended?: "pc-down" | "enemy-down" }, data: CombatantsSnap): void {
  for (const snap of data.items) {
    const c = holder.cs.find((x) => x.id === snap.id);
    if (!c) continue;
    c.hp = snap.hp;
    if (c.resources) c.resources.ap = snap.ap;
    c.effects = EffectStore.fromJSON(snap.effects, EFFECT_DEFS.toJSON());
  }
  holder.ended = data.ended;
}

export class TurnCombatStage extends StageBase<InitStateType, ChatStateType, MessageStateType, ConfigType> {
  rng = Rng.fromSeed("temple-steps");
  combatants: Combatant[];
  combatantsHolder: { cs: Combatant[]; ended?: "pc-down" | "enemy-down" };
  turn = { n: 0, choice: "swing" as "swing" | "guard" | "sunder" };
  events = new Timeline<CombatEvent>({ id: "last-round-events", channels: ["auditory"], windowSize: 20, saliencePer: 8, habituationTau: 1 });
  lastRound: CombatEvent[] = [];
  habituation = new Map<string, number>();
  layers = createChubLayers();
  store!: PersistenceStore;
  bound!: ReturnType<typeof bindStore<ChatStateType, MessageStateType>>;

  constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
    super(data);
    this.combatants = buildCombatants();
    this.combatantsHolder = { cs: this.combatants };
    this.layers = createChubLayers({
      messageState: (data.messageState as Record<string, string | undefined> | null) ?? null,
      chatState: (data.chatState as Record<string, string | undefined> | null) ?? null,
    });
    this.store = new PersistenceStore({
      turn: shard("turn", this.turn,
        (i) => ({ n: i.n, choice: i.choice }),
        (d: { n: number; choice: "swing" | "guard" | "sunder" }) => ({ n: d.n, choice: d.choice }),
        this.layers.messageStateBackend, chubTreeHistory()),
      combatants: shard("combatants", this.combatantsHolder,
        (i) => snapCombatants(i.cs, i.ended),
        (d: CombatantsSnap) => {
          const holder = { cs: this.combatants, ended: undefined as "pc-down" | "enemy-down" | undefined };
          restoreCombatants(holder, d);
          return holder;
        },
        this.layers.chatStateBackend, forbidBranching(snapshotHistory())),
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

  private chooseFor = (actor: Combatant, world: World) => {
    if (actor.id === "pc") {
      const choice = this.turn.choice;
      const target = world.combatants.find((c) => c.id === "duellist")!;
      if (choice === "guard") return { action: GUARD, target: actor };
      if (choice === "sunder") return { action: SUNDER, target, profile: SUNDER_PROFILE };
      return { action: SWING, target, profile: ATTACK };
    }
    const target = world.combatants.find((c) => c.id === "pc")!;
    if (actor.hp < 7) return { action: GUARD, target: actor };
    if (this.turn.n % 3 === 0) return { action: SUNDER, target, profile: SUNDER_PROFILE };
    return { action: SWING, target, profile: ATTACK };
  };

  private observationSources(now: number): ObservationSource<{ now: number }>[] {
    const summary = (c: Combatant) => ({
      id: c.id, hp: c.hp, ap: c.resources?.ap ?? 0,
      armor: (c.stats?.armor ?? 0) + (c.effects?.totalMagnitudes(now).stats?.armor ?? 0),
      effects: c.effects?.active().map((i) => i.id) ?? [],
    });
    return [
      { id: "combat-state", channels: ["visual"], salience: () => 1, habituationTau: 0,
        properties: { visual: { combatants: () => this.combatants.map(summary) } } },
    ];
  }

  async beforePrompt(msg: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    const now = this.turn.n;
    const observed = assembleObservations(
      [...this.observationSources(now), this.events],
      { now }, { now, maxCount: 3 },
    );
    const stageDirections = emitStageDirections({
      observations: observed,
      architectures: ["fragment_cascade", "terminal_sense_shift"],
      register: { pov: "close-second", tense: "present", distance: "close" },
      prefix:
        "You are narrating a duel on temple steps. On the player's behalf, choose ONE action " +
        "for the next round by emitting `<action>swing</action>` (or guard/sunder) somewhere in " +
        "your reply. The previous round's events are in the auditory observation — render them, " +
        "do not invent damage numbers.",
    });
    return mergeResponses({ stageDirections }, await this.bound.beforePrompt(msg));
  }

  async afterResponse(botMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    const r = parseTags<Record<string, unknown>>(botMessage.content, {
      action: { kind: "string", enum: ["swing", "guard", "sunder"], default: "swing" },
    });
    const choice = (typeof r.parsed.action === "string" ? r.parsed.action : "swing") as "swing" | "guard" | "sunder";
    this.turn.choice = choice;
    if (this.combatantsHolder.ended) {
      const stripped = r.stripped !== botMessage.content ? r.stripped : null;
      return mergeResponses({ modifiedMessage: stripped }, await this.bound.afterResponse(botMessage));
    }
    this.turn.n += 1;
    for (const c of this.combatants) if (c.resources) c.resources.ap = c.id === "pc" ? 3 : 2;
    for (const c of this.combatants) c.effects?.tick(this.turn.n);
    this.lastRound = runRound(this.combatants, this.chooseFor, { combatants: this.combatants }, this.turn.n, this.rng.mechanical);
    for (const e of this.lastRound) this.events.push(e, this.turn.n);
    const pc = this.combatants.find((c) => c.id === "pc")!;
    const en = this.combatants.find((c) => c.id === "duellist")!;
    if (pc.hp <= 0) this.combatantsHolder.ended = "pc-down";
    else if (en.hp <= 0) this.combatantsHolder.ended = "enemy-down";
    const stripped = r.stripped !== botMessage.content ? r.stripped : null;
    const sys = this.combatantsHolder.ended ? `[combat ends: ${this.combatantsHolder.ended}]` : null;
    return mergeResponses({ modifiedMessage: stripped, systemMessage: sys }, await this.bound.afterResponse(botMessage));
  }

  render(): ReactElement {
    return (
      <div style={{ padding: 12, fontFamily: "ui-monospace, monospace", color: "#ddd", background: "#111" }}>
        <h3 style={{ marginTop: 0 }}>Duel — round {this.turn.n} (you queued: {this.turn.choice})</h3>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr><th align="left">combatant</th><th>HP</th><th>AP</th><th>armor</th><th align="left">effects</th></tr></thead>
          <tbody>
            {this.combatants.map((c) => (
              <tr key={c.id} style={{ borderTop: "1px solid #333" }}>
                <td style={{ padding: "4px 8px" }}>{c.id}</td>
                <td align="center">{c.hp}</td>
                <td align="center">{c.resources?.ap ?? 0}</td>
                <td align="center">{(c.stats?.armor ?? 0) + (c.effects?.totalMagnitudes(this.turn.n).stats?.armor ?? 0)}</td>
                <td>{c.effects?.active().map((i) => i.id).join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h4>Last round events</h4>
        <pre style={{ background: "#000", padding: 8, maxHeight: 220, overflow: "auto" }}>
{summarize(this.events.window(30), (e, at) => `${at}: ${JSON.stringify(e)}`) || "—"}
        </pre>
        {this.combatantsHolder.ended && <h3 style={{ color: "#e88" }}>Combat ended: {this.combatantsHolder.ended}</h3>}
      </div>
    );
  }
}
