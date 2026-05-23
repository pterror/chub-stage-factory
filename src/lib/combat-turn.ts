/*
 * combat-turn.ts — turn-based combat pipeline.
 *
 * WHAT: A Round consists of initiative-ordered turns. Each turn runs the
 *       phases: selectAction -> validate -> payCosts -> resolveAttack ->
 *       applyEffects. Each phase is a pure function returning CombatEvent
 *       records. The damage pipeline is:
 *         raw -> resistanceReduction -> dodgeCheck -> critRoll -> finalApply.
 *       Stages decide UI/prose; this module returns the event stream.
 *
 * WHY: Rule #3 (events as data; the stage renders them), #4 (each phase
 *       pure-ish), #7 (mechanical RNG for hit/dodge/crit).
 *
 * SHAPE:
 *   interface Combatant { id; initiative; resources?; cooldowns?; position?;
 *     stats?: { armor?, dodge?, critResist? }; tags?: string[]; hp: number }
 *   interface AttackProfile { damage: number; type: string; crit?: number; accuracy?: number }
 *   type CombatEvent =
 *     | { kind: "turn_start"; actor }
 *     | { kind: "action_chosen"; actor; action }
 *     | { kind: "action_invalid"; actor; action; reason }
 *     | { kind: "costs_paid"; actor; costs }
 *     | { kind: "missed"; actor; target }
 *     | { kind: "dodged"; actor; target }
 *     | { kind: "hit"; actor; target; raw; final; crit }
 *     | { kind: "effect_applied"; actor; target; effectId }
 *     | { kind: "downed"; combatant }
 *     | { kind: "turn_end"; actor };
 *   initiativeOrder(combatants, rng?): Combatant[]
 *   resolveDamage(attacker, target, profile, rng): { final, crit, dodged }
 *   runTurn(actor, choose, world, now, rng): CombatEvent[]
 *   runRound(combatants, choose, world, now, rng): CombatEvent[]
 */

import { ActionDef, isOnCooldown, markCooldown, payCosts, validateAction } from "./action";
import { EffectStore } from "./effects";
import { RngStream } from "./rng";

export interface Combatant {
  id: string;
  initiative: number;
  hp: number;
  resources?: Record<string, number>;
  cooldowns?: Record<string, number>;
  position?: { x: number; y: number };
  stats?: { armor?: number; dodge?: number; critResist?: number };
  tags?: string[];
  effects?: EffectStore;
}

export interface AttackProfile {
  damage: number;
  type: string;
  /** Crit chance 0..1 before resist. */
  crit?: number;
  /** Accuracy 0..1; opposed by target dodge. */
  accuracy?: number;
  /** Crit multiplier; default 2. */
  critMultiplier?: number;
}

export type CombatEvent =
  | { kind: "turn_start"; actor: string }
  | { kind: "action_chosen"; actor: string; action: string }
  | { kind: "action_invalid"; actor: string; action: string; reason: string }
  | { kind: "costs_paid"; actor: string; costs: Record<string, number> }
  | { kind: "missed"; actor: string; target: string }
  | { kind: "dodged"; actor: string; target: string }
  | { kind: "hit"; actor: string; target: string; raw: number; final: number; crit: boolean }
  | { kind: "effect_applied"; actor: string; target: string; effectId: string }
  | { kind: "downed"; combatant: string }
  | { kind: "turn_end"; actor: string };

export function initiativeOrder(combatants: readonly Combatant[], rng?: RngStream): Combatant[] {
  // Stable sort, with tie-breaking by random rng to avoid first-defined bias.
  const tagged = combatants.map((c) => ({ c, jitter: rng ? rng.float() : 0 }));
  tagged.sort((a, b) => {
    if (a.c.initiative !== b.c.initiative) return b.c.initiative - a.c.initiative;
    return a.jitter - b.jitter;
  });
  return tagged.map((t) => t.c);
}

export function resolveDamage(
  _attacker: Combatant,
  target: Combatant,
  profile: AttackProfile,
  rng: RngStream,
): { final: number; crit: boolean; dodged: boolean; missed: boolean } {
  const accuracy = profile.accuracy ?? 1;
  const dodge = target.stats?.dodge ?? 0;
  // Two rolls: accuracy roll (miss) then dodge roll (active evasion).
  if (rng.float() > accuracy) return { final: 0, crit: false, dodged: false, missed: true };
  if (rng.float() < dodge) return { final: 0, crit: false, dodged: true, missed: false };
  const baseCrit = profile.crit ?? 0;
  const critResist = target.stats?.critResist ?? 0;
  const crit = rng.float() < Math.max(0, baseCrit - critResist);
  const armor = target.stats?.armor ?? 0;
  let dmg = Math.max(0, profile.damage - armor);
  if (crit) dmg *= profile.critMultiplier ?? 2;
  return { final: dmg, crit, dodged: false, missed: false };
}

export interface TurnChoice {
  action: ActionDef<Combatant, Combatant, World>;
  target?: Combatant;
  profile?: AttackProfile;
}

export interface World {
  combatants: Combatant[];
}

export function runTurn(
  actor: Combatant,
  choose: (actor: Combatant, world: World) => TurnChoice | null,
  world: World,
  now: number,
  rng: RngStream,
): CombatEvent[] {
  const events: CombatEvent[] = [{ kind: "turn_start", actor: actor.id }];
  const choice = choose(actor, world);
  if (!choice) {
    events.push({ kind: "turn_end", actor: actor.id });
    return events;
  }
  const { action, target, profile } = choice;
  events.push({ kind: "action_chosen", actor: actor.id, action: action.id });

  const v = validateAction(action, actor, target, world, now);
  if (!v.ok) {
    events.push({ kind: "action_invalid", actor: actor.id, action: action.id, reason: v.reason });
    events.push({ kind: "turn_end", actor: actor.id });
    return events;
  }
  payCosts(actor, action.costs);
  events.push({ kind: "costs_paid", actor: actor.id, costs: { ...action.costs } });
  markCooldown(actor, action, now);

  if (target && profile) {
    const r = resolveDamage(actor, target, profile, rng);
    if (r.missed) events.push({ kind: "missed", actor: actor.id, target: target.id });
    else if (r.dodged) events.push({ kind: "dodged", actor: actor.id, target: target.id });
    else {
      target.hp -= r.final;
      events.push({
        kind: "hit",
        actor: actor.id,
        target: target.id,
        raw: profile.damage,
        final: r.final,
        crit: r.crit,
      });
      if (target.hp <= 0) events.push({ kind: "downed", combatant: target.id });
    }
  }

  if (target) {
    for (const eff of action.effects) {
      target.effects?.apply(eff, now);
      events.push({ kind: "effect_applied", actor: actor.id, target: target.id, effectId: eff.id });
    }
  }

  events.push({ kind: "turn_end", actor: actor.id });
  return events;
}

export function runRound(
  combatants: Combatant[],
  choose: (actor: Combatant, world: World) => TurnChoice | null,
  world: World,
  now: number,
  rng: RngStream,
): CombatEvent[] {
  const order = initiativeOrder(combatants, rng);
  const events: CombatEvent[] = [];
  for (const c of order) {
    if (c.hp <= 0) continue;
    if (isOnCooldown(c, { id: "__round__" }, now)) continue;
    events.push(...runTurn(c, choose, world, now, rng));
  }
  return events;
}
