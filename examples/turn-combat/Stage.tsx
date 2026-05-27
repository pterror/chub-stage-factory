/*
 * turn-combat/Stage.tsx — duel on the steps.
 *
 * Mechanic: PC vs one enemy (a temple-step duellist). The LLM emits
 * `<action>swing|guard|sunder</action>` to choose the PC's move; the stage
 * runs one round (initiative-ordered, damage pipeline, effects). Events
 * surface to the LLM through observation, not prose.
 *
 * Primitives: turnCombatPattern (composer).
 * Philosophy: rule #3 (events are data; LLM renders), rule #7 (mechanical
 * RNG stream separate from any cosmetic noise).
 *
 * Persistence: per the plan —
 *   - `turn` (round counter, queued choice): messageState + chubTreeHistory
 *   - `combatants` (persistent HP/effects): chatState + forbidBranching.
 *     A swipe re-narrates a round but does NOT un-damage anyone; the
 *     duellist is a persistent person.
 */

import { ReactElement } from "react";
import { StageResponse, InitialData, Message } from "@chub-ai/stages-ts";
import { ActionDef } from "../../src/lib/action";
import { Combatant, World, AttackProfile } from "../../src/lib/combat-turn";
import { EffectStore, EffectDef } from "../../src/lib/effects";
import { Registry } from "../../src/lib/registry";
import { summarize } from "../../src/lib/timeline";
import { withPersistence } from "../../src/lib/persistence";
import { turnCombatPattern, type TurnCombatBundle } from "../../src/lib/patterns/turn-combat";

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

export class TurnCombatStage extends withPersistence<ChatStateType, InitStateType, MessageStateType, ConfigType>() {
  p!: TurnCombatBundle;

  constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {
    super(data);
    const combatants = buildCombatants();
    const ms = (data.messageState as Record<string, string | undefined> | null) ?? null;
    const cs = (data.chatState as Record<string, string | undefined> | null) ?? null;

    const chooseFor = (actor: Combatant, world: World) => {
      if (actor.id === "pc") {
        const choice = this.p.turn.choice;
        const target = world.combatants.find((c) => c.id === "duellist")!;
        if (choice === "guard") return { action: GUARD, target: actor };
        if (choice === "sunder") return { action: SUNDER, target, profile: SUNDER_PROFILE };
        return { action: SWING, target, profile: ATTACK };
      }
      const target = world.combatants.find((c) => c.id === "pc")!;
      if (actor.hp < 7) return { action: GUARD, target: actor };
      if (this.p.turn.n % 3 === 0) return { action: SUNDER, target, profile: SUNDER_PROFILE };
      return { action: SWING, target, profile: ATTACK };
    };

    this.p = turnCombatPattern({
      messageState: ms,
      chatState: cs,
      combatants,
      effectDefs: EFFECT_DEFS,
      rngSeed: "temple-steps",
      chooseFor,
      apResets: { pc: 3, duellist: 2 },
      validActions: ["swing", "guard", "sunder"],
      defaultAction: "swing",
      stageDirections: {
        architectures: ["fragment_cascade", "terminal_sense_shift"],
        register: { pov: "close-second", tense: "present", distance: "close" },
        prefix:
          "You are narrating a duel on temple steps. On the player's behalf, choose ONE action " +
          "for the next round by emitting `<action>swing</action>` (or guard/sunder) somewhere in " +
          "your reply. The previous round's events are in the auditory observation — render them, " +
          "do not invent damage numbers.",
      },
    });
    this.initStore(() => this.p.store);
  }

  async beforePrompt(msg: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    return this.p.buildBeforePrompt(msg, this.bound) as Promise<Partial<StageResponse<ChatStateType, MessageStateType>>>;
  }

  async afterResponse(msg: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
    return this.p.buildAfterResponse(msg, this.bound) as Promise<Partial<StageResponse<ChatStateType, MessageStateType>>>;
  }

  render(): ReactElement {
    const { combatants, turn, events } = this.p;
    const now = turn.n;
    return (
      <div style={{ padding: 12, fontFamily: "ui-monospace, monospace", color: "#ddd", background: "#111" }}>
        <h3 style={{ marginTop: 0 }}>Duel — round {now} (you queued: {turn.choice})</h3>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr><th align="left">combatant</th><th>HP</th><th>AP</th><th>armor</th><th align="left">effects</th></tr></thead>
          <tbody>
            {combatants.map((c) => (
              <tr key={c.id} style={{ borderTop: "1px solid #333" }}>
                <td style={{ padding: "4px 8px" }}>{c.id}</td>
                <td align="center">{c.hp}</td>
                <td align="center">{c.resources?.ap ?? 0}</td>
                <td align="center">{(c.stats?.armor ?? 0) + (c.effects?.totalMagnitudes(now).stats?.armor ?? 0)}</td>
                <td>{c.effects?.active().map((i) => i.id).join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h4>Last round events</h4>
        <pre style={{ background: "#000", padding: 8, maxHeight: 220, overflow: "auto" }}>
{summarize(events.window(30), (e, at) => `${at}: ${JSON.stringify(e)}`) || "—"}
        </pre>
        {this.p.combatantsHolder.ended && <h3 style={{ color: "#e88" }}>Combat ended: {this.p.combatantsHolder.ended}</h3>}
      </div>
    );
  }
}
