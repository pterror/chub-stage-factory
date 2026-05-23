/*
 * turn-combat/Stage.tsx — duel on the steps.
 *
 * Mechanic: PC vs one enemy (a temple-step duellist). The LLM emits
 * `<action>swing|guard|sunder</action>` to choose the PC's move; the stage
 * runs one round (initiative-ordered, damage pipeline, effects). Events
 * surface to the LLM through observation, not prose.
 *
 * Primitives: action, combat-turn, effects, stats, rng, tag-parser.
 * Philosophy: rule #3 (events are data; LLM renders), rule #7 (mechanical
 * RNG stream separate from any cosmetic noise).
 */

import { ReactElement } from "react";
import { StageBase, StageResponse, InitialData, Message } from "@chub-ai/stages-ts";
import { LoadResponse } from "@chub-ai/stages-ts/dist/types/load";
import { ActionDef } from "../../src/lib/action";
import { Combatant, World, runRound, AttackProfile, CombatEvent } from "../../src/lib/combat-turn";
import { EffectStore, EffectDef } from "../../src/lib/effects";
import { Rng } from "../../src/lib/rng";
import { parseTags } from "../../src/lib/tag-parser";
import { emitStageDirections } from "../../src/lib/chub-adapters";
import { assembleObservations, ObservationSource } from "../../src/lib/observation";

interface MessageStateType {
  round: number;
  pcHp: number;
  enemyHp: number;
  ended?: "pc-down" | "enemy-down";
}
type ChatStateType = null;
type InitStateType = null;
type ConfigType = null;

const GUARD_EFFECT: EffectDef = {
  id: "guarded", duration: 1, stacking: "replace",
  targets: { stats: ["armor"] },
  baseMagnitudes: { stats: { armor: 3 } },
};
const SUNDER_EFFECT: EffectDef = {
  id: "sundered", duration: 2, stacking: "replace",
  targets: { stats: ["armor"] },
  baseMagnitudes: { stats: { armor: -2 } },
};

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

export class TurnCombatStage extends StageBase<InitStateType, ChatStateType, MessageStateType, ConfigType> {
  rng = Rng.fromSeed("temple-steps");
  combatants: Combatant[];
  msg: MessageStateType = { round: 0, pcHp: 30, enemyHp: 22 };
  events: CombatEvent[] = [];
  habituation = new Map<string, number>();
  pcChoice: "swing" | "guard" | "sunder" = "swing";

  constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
    super(data);
    if (data.messageState) this.msg = { ...this.msg, ...data.messageState };
    this.combatants = [
      { id: "pc", initiative: 12, hp: this.msg.pcHp, resources: { ap: 3 },
        position: { x: 0, y: 0 }, stats: { dodge: 0.15, armor: 1, critResist: 0.05 },
        effects: new EffectStore() },
      { id: "duellist", initiative: 10, hp: this.msg.enemyHp, resources: { ap: 2 },
        position: { x: 1, y: 0 }, stats: { dodge: 0.1, armor: 2 },
        effects: new EffectStore() },
    ];
  }

  async load(): Promise<Partial<LoadResponse<InitStateType, ChatStateType, MessageStateType>>> {
    return { success: true, error: null, initState: null, chatState: null };
  }
  async setState(state: MessageStateType): Promise<void> {
    if (state) this.msg = { ...this.msg, ...state };
  }

  private chooseFor = (actor: Combatant, world: World) => {
    if (actor.id === "pc") {
      const choice = this.pcChoice;
      const target = world.combatants.find((c) => c.id === "duellist")!;
      if (choice === "guard") return { action: GUARD, target: actor };
      if (choice === "sunder") return { action: SUNDER, target, profile: SUNDER_PROFILE };
      return { action: SWING, target, profile: ATTACK };
    }
    // Enemy AI: alternate swing/sunder; guard if HP < 30%
    const target = world.combatants.find((c) => c.id === "pc")!;
    if (actor.hp < 7) return { action: GUARD, target: actor };
    if (this.msg.round % 3 === 0) return { action: SUNDER, target, profile: SUNDER_PROFILE };
    return { action: SWING, target, profile: ATTACK };
  };

  private observationSources(now: number): ObservationSource<{ now: number }>[] {
    const summary = (c: Combatant) => ({
      id: c.id, hp: c.hp, ap: c.resources?.ap ?? 0,
      armor: (c.stats?.armor ?? 0) + (c.effects?.totalMagnitudes(now).stats?.armor ?? 0),
      effects: c.effects?.active().map((i) => i.id) ?? [],
    });
    return [
      {
        id: "combat-state",
        channels: ["visual"],
        salience: () => 1,
        habituationTau: 0,
        properties: { visual: { combatants: () => this.combatants.map(summary) } },
      },
      {
        id: "last-round-events",
        channels: ["auditory"],
        salience: () => Math.min(1, this.events.length / 8),
        habituationTau: 1,
        properties: { auditory: { events: () => this.events.slice(-20) } },
      },
    ];
  }

  async beforePrompt(_userMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    const now = this.msg.round;
    const observed = assembleObservations(this.observationSources(now), { now }, { now, maxCount: 3 });
    const stageDirections = emitStageDirections({
      observations: observed,
      architectures: ["fragment_cascade", "terminal_sense_shift"],
      register: "close-2nd-present",
      prefix:
        "You are narrating a duel on temple steps. On the player's behalf, choose ONE action " +
        "for the next round by emitting `<action>swing</action>` (or guard/sunder) somewhere in " +
        "your reply. The previous round's events are in the auditory observation — render them, " +
        "do not invent damage numbers.",
    });
    return { stageDirections, messageState: this.msg };
  }

  async afterResponse(botMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    const r = parseTags<Record<string, unknown>>(botMessage.content, {
      action: { kind: "string", enum: ["swing", "guard", "sunder"], default: "swing" },
    });
    const choice = (typeof r.parsed.action === "string" ? r.parsed.action : "swing") as "swing" | "guard" | "sunder";
    this.pcChoice = choice;
    if (this.msg.ended) {
      return { messageState: this.msg, modifiedMessage: r.stripped, stageDirections: null, systemMessage: null, error: null, chatState: null };
    }
    this.msg.round += 1;
    // Replenish AP each round
    for (const c of this.combatants) c.resources!.ap = c.id === "pc" ? 3 : 2;
    // Tick effects
    for (const c of this.combatants) c.effects?.tick(this.msg.round);
    this.events = runRound(this.combatants, this.chooseFor, { combatants: this.combatants }, this.msg.round, this.rng.mechanical);
    const pc = this.combatants.find((c) => c.id === "pc")!;
    const en = this.combatants.find((c) => c.id === "duellist")!;
    this.msg.pcHp = pc.hp; this.msg.enemyHp = en.hp;
    if (pc.hp <= 0) this.msg.ended = "pc-down";
    else if (en.hp <= 0) this.msg.ended = "enemy-down";
    return {
      messageState: this.msg,
      modifiedMessage: r.stripped !== botMessage.content ? r.stripped : null,
      systemMessage: this.msg.ended ? `[combat ends: ${this.msg.ended}]` : null,
      error: null, chatState: null, stageDirections: null,
    };
  }

  render(): ReactElement {
    return (
      <div style={{ padding: 12, fontFamily: "ui-monospace, monospace", color: "#ddd", background: "#111" }}>
        <h3 style={{ marginTop: 0 }}>Duel — round {this.msg.round} (you queued: {this.pcChoice})</h3>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr><th align="left">combatant</th><th>HP</th><th>AP</th><th>armor</th><th align="left">effects</th></tr></thead>
          <tbody>
            {this.combatants.map((c) => (
              <tr key={c.id} style={{ borderTop: "1px solid #333" }}>
                <td style={{ padding: "4px 8px" }}>{c.id}</td>
                <td align="center">{c.hp}</td>
                <td align="center">{c.resources?.ap ?? 0}</td>
                <td align="center">{(c.stats?.armor ?? 0) + (c.effects?.totalMagnitudes(this.msg.round).stats?.armor ?? 0)}</td>
                <td>{c.effects?.active().map((i) => i.id).join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h4>Last round events</h4>
        <pre style={{ background: "#000", padding: 8, maxHeight: 220, overflow: "auto" }}>
{this.events.map((e) => JSON.stringify(e)).join("\n") || "—"}
        </pre>
        {this.msg.ended && <h3 style={{ color: "#e88" }}>Combat ended: {this.msg.ended}</h3>}
      </div>
    );
  }
}
