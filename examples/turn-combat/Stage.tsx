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
    this.layers = this.p.layers;
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

    const pc = combatants.find((c) => c.id === "pc");
    const duellist = combatants.find((c) => c.id === "duellist");

    function hpBar(hp: number, max: number): ReactElement {
      const pct = Math.max(0, Math.min(1, hp / max));
      const color = pct > 0.6 ? "#5a5" : pct > 0.3 ? "#aa5" : "#a55";
      return (
        <span style={{ display: "inline-block", width: 80, height: 8, background: "#333", borderRadius: 4, verticalAlign: "middle", marginLeft: 6 }}>
          <span style={{ display: "block", width: `${Math.round(pct * 100)}%`, height: "100%", background: color, borderRadius: 4 }} />
        </span>
      );
    }

    // Map effect ids to short status labels.
    const EFFECT_LABELS: Record<string, string> = {
      guarded: "Guarding (+armor)",
      sundered: "Sundered (−armor)",
    };

    function combatantStatus(c: Combatant, maxHp: number): ReactElement {
      const effectMods = c.effects?.totalMagnitudes(now).stats?.armor ?? 0;
      const armor = (c.stats?.armor ?? 0) + effectMods;
      const activeEffects = c.effects?.active().map((i) => EFFECT_LABELS[i.id] ?? i.id) ?? [];
      return (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: "bold", fontSize: "0.9rem" }}>
            {c.id === "pc" ? "You" : "The duellist"}
            {hpBar(c.hp, maxHp)}
            <span style={{ color: "#aaa", fontSize: "0.8rem", marginLeft: 8 }}>{c.hp} hp · armor {armor}</span>
          </div>
          {activeEffects.length > 0 && (
            <div style={{ color: "#9ad", fontSize: "0.8rem", marginLeft: 4 }}>{activeEffects.join(", ")}</div>
          )}
        </div>
      );
    }

    // Narrate combat events as plain prose.
    type CombatEvent = { kind: string; actor?: string; target?: string; final?: number; crit?: boolean; effectId?: string; combatant?: string };
    function narrateEvent(e: CombatEvent): string | null {
      const who = (id?: string) => id === "pc" ? "You" : id === "duellist" ? "The duellist" : (id ?? "?");
      switch (e.kind) {
        case "hit": return `${who(e.actor)} strikes${e.crit ? " critically" : ""}${e.final != null ? ` for ${e.final} damage` : ""}. ${who(e.target)} reels.`;
        case "missed": return `${who(e.actor)}'s strike goes wide.`;
        case "dodged": return `${who(e.target)} sidesteps ${who(e.actor)}'s blow.`;
        case "effect_applied": return `${who(e.target)} is ${EFFECT_LABELS[e.effectId ?? ""] ?? e.effectId}.`;
        case "downed": return `${who(e.combatant)} is downed!`;
        default: return null;
      }
    }

    const narrations = events
      .window(30)
      .map((ev) => narrateEvent(ev.payload as CombatEvent))
      .filter((s): s is string => s !== null);

    // Queue hint: tell the player what their queued move will do.
    const QUEUE_HINTS: Record<string, string> = {
      swing: "You'll attack — standard slash.",
      guard: "You'll raise your guard (+3 armor this round).",
      sunder: "You'll sunder — reduced damage but weakens their armor for 2 rounds.",
    };
    const nextHint = turn.choice ? QUEUE_HINTS[turn.choice] ?? `Queued: ${turn.choice}` : "Waiting for your move — describe your action.";

    return (
      <div style={{ padding: 12, fontFamily: "sans-serif", color: "#ddd", background: "#1a1a1a", maxWidth: 480 }}>
        <h3 style={{ marginTop: 0, fontSize: "1rem", color: "#e8c97a" }}>Duel — Round {now}</h3>

        {pc && combatantStatus(pc, 30)}
        {duellist && combatantStatus(duellist, 22)}

        <div style={{ marginTop: 8, padding: "6px 10px", background: "#252525", borderRadius: 4, fontSize: "0.85rem", color: "#ccc", borderLeft: "3px solid #7a9" }}>
          {nextHint}
        </div>

        {narrations.length > 0 && (
          <>
            <h4 style={{ fontSize: "0.85rem", color: "#888", marginBottom: 4, marginTop: 12 }}>Last round</h4>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {narrations.map((s, i) => (
                <li key={i} style={{ fontSize: "0.85rem", marginBottom: 3, color: "#ccc" }}>{s}</li>
              ))}
            </ul>
          </>
        )}

        {this.p.combatantsHolder.ended && (
          <div style={{ marginTop: 12, padding: "8px 12px", background: "#3a1a1a", borderRadius: 4, color: "#e88", fontWeight: "bold" }}>
            {this.p.combatantsHolder.ended === "pc-down" ? "You have fallen." : this.p.combatantsHolder.ended === "enemy-down" ? "The duellist is defeated." : `Combat ended.`}
          </div>
        )}
      </div>
    );
  }
}
