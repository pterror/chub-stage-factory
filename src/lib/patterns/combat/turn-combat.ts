/*
 * patterns/turn-combat.ts — action + combat-turn + effects + rng + timeline composer.
 *
 * WHAT: `turnCombatPattern(init)` wires a `Combatant[]` with `runRound`,
 *       per-combatant `EffectStore`s, a `Rng`, a `Timeline<CombatEvent>`,
 *       and `PersistenceStore` shards (turn counter on messageState, combatant
 *       state on chatState+forbidBranching). Returns helpers for `beforePrompt`
 *       (observation + stage directions) and `afterResponse` (action-tag parse
 *       → round execution → ended check).
 *
 *       The composer is a recipe, not a primitive. All state is in the
 *       returned bundle's exposed fields.
 *
 * WHY: A combat stage re-wires the same AP-reset → effects-tick → runRound →
 *      timeline-push → ended-check sequence every time. The composer collapses
 *      that wiring into a single declaration, leaving only combatant
 *      definitions, action defs, and the choose-for callback in the stage.
 *
 *      No new mechanics. No private state. See `TURN-COMBAT.md` for Purpose /
 *      API / Gotchas.
 *
 * SHAPE:
 *   interface TurnCombatBundleInit
 *     { messageState; chatState; combatants; rngSeed; chooseFor;
 *       apTagName?; stageDirections }
 *   interface TurnCombatBundle
 *     { combatants; turn; events; rng; layers; store;
 *       buildBeforePrompt(msg, bound): Promise<StageResponse fragment>;
 *       buildAfterResponse(msg, bound): Promise<StageResponse fragment> }
 *   function turnCombatPattern(init): TurnCombatBundle
 */

import type { Message, StageResponse } from "@chub-ai/stages-ts";
import { type Combatant, type World, runRound, type CombatEvent } from "../combat-turn";
import { EffectStore, type EffectDef } from "../effects";
import { Registry } from "../registry";
import { Timeline } from "../timeline";
import { Rng } from "../rng";
import { parseTags } from "../tag-parser";
import { emitStageDirections } from "../chub-adapters";
import { type ObservationSource, assembleObservations } from "../observation";
import type { ArchitectureName } from "../prose-register";
import type { RegisterSpec } from "../prose-register";
import {
  PersistenceStore,
  createChubLayers,
  chubTreeHistory,
  snapshotHistory,
  forbidBranching,
  mergeResponses,
  shard,
} from "../persistence";

/** Serializable form of combatant state used by the persistence layer. */
export interface CombatantSnap {
  id: string;
  hp: number;
  ap: number;
  effects: ReturnType<EffectStore["toJSON"]>;
}

export interface CombatantsSnap {
  items: CombatantSnap[];
  ended?: "pc-down" | "enemy-down";
}

export interface TurnCombatBundleInit {
  /** Raw messageState from `InitialData`. */
  messageState: Record<string, string | undefined> | null;
  /** Raw chatState from `InitialData`. */
  chatState: Record<string, string | undefined> | null;
  /** Initial combatant list. The composer mutates these in-place each round. */
  combatants: Combatant[];
  /** Effect definitions used during combatant state restoration. */
  effectDefs: Registry<EffectDef>;
  /** Seed string for the mechanical RNG stream. */
  rngSeed: string;
  /**
   * Chooses the action for `actor` given `world`. Called once per combatant
   * per round by `runRound`. Return `{ action, target, profile? }`.
   */
  chooseFor: Parameters<typeof runRound>[1];
  /** AP totals to restore at round start, keyed by combatant id. */
  apResets: Record<string, number>;
  /** Tag name the LLM emits for the PC's action choice. Default `"action"`. */
  actionTagName?: string;
  /** Enum of valid action ids for the action tag. */
  validActions: string[];
  /** Default action id when the LLM omits the tag. */
  defaultAction: string;
  /** Stage-directions options forwarded to `emitStageDirections`. */
  stageDirections: {
    architectures?: readonly ArchitectureName[];
    register?: RegisterSpec;
    prefix?: string;
  };
}

export interface TurnCombatBundle {
  combatants: Combatant[];
  combatantsHolder: { cs: Combatant[]; ended?: "pc-down" | "enemy-down" };
  turn: { n: number; choice: string };
  events: Timeline<CombatEvent>;
  rng: Rng;
  layers: ReturnType<typeof createChubLayers>;
  store: PersistenceStore;
  /**
   * Assembles combat-state observations and emits stage directions.
   * Call inside `beforePrompt`.
   */
  buildBeforePrompt(
    msg: Message,
    bound: { beforePrompt(msg: Message): Promise<Partial<StageResponse<unknown, unknown>>> },
  ): Promise<Partial<StageResponse<unknown, unknown>>>;
  /**
   * Parses action tag, advances one round (AP reset → effects tick → runRound
   * → ended check), strips the tag from the response.
   * Call inside `afterResponse`.
   */
  buildAfterResponse(
    msg: Message,
    bound: { afterResponse(msg: Message): Promise<Partial<StageResponse<unknown, unknown>>> },
  ): Promise<Partial<StageResponse<unknown, unknown>>>;
}

export function turnCombatPattern(init: TurnCombatBundleInit): TurnCombatBundle {
  const actionTag = init.actionTagName ?? "action";
  const rng = Rng.fromSeed(init.rngSeed);
  const turn = { n: 0, choice: init.defaultAction };
  const events = new Timeline<CombatEvent>({
    id: "last-round-events", channels: ["auditory"], windowSize: 20, saliencePer: 8, habituationTau: 1,
  });
  const combatantsHolder: { cs: Combatant[]; ended?: "pc-down" | "enemy-down" } = {
    cs: init.combatants,
  };
  const layers = createChubLayers({
    messageState: init.messageState ?? null,
    chatState: init.chatState ?? null,
  });

  const snapCombatants = (holder: typeof combatantsHolder): CombatantsSnap => ({
    items: holder.cs.map((c) => ({
      id: c.id, hp: c.hp, ap: c.resources?.ap ?? 0,
      effects: c.effects?.toJSON() ?? { instances: [] },
    })),
    ended: holder.ended,
  });

  const restoreCombatants = (holder: typeof combatantsHolder, data: CombatantsSnap): typeof combatantsHolder => {
    for (const snap of data.items) {
      const c = holder.cs.find((x) => x.id === snap.id);
      if (!c) continue;
      c.hp = snap.hp;
      if (c.resources) c.resources.ap = snap.ap;
      c.effects = EffectStore.fromJSON(snap.effects, init.effectDefs.toJSON());
    }
    holder.ended = data.ended;
    return holder;
  };

  const store = new PersistenceStore({
    turn: shard("turn", turn,
      (i) => ({ n: i.n, choice: i.choice }),
      (d: { n: number; choice: string }) => ({ n: d.n, choice: d.choice }),
      layers.messageStateBackend, chubTreeHistory()),
    combatants: shard("combatants", combatantsHolder,
      (i) => snapCombatants(i),
      (d: CombatantsSnap) => restoreCombatants({ cs: init.combatants, ended: undefined }, d),
      layers.chatStateBackend, forbidBranching(snapshotHistory())),
  });

  const observationSources = (now: number): ObservationSource<{ now: number }>[] => {
    const summary = (c: Combatant) => ({
      id: c.id, hp: c.hp, ap: c.resources?.ap ?? 0,
      armor: (c.stats?.armor ?? 0) + (c.effects?.totalMagnitudes(now).stats?.armor ?? 0),
      effects: c.effects?.active().map((i) => i.id) ?? [],
    });
    return [
      {
        id: "combat-state", channels: ["visual"], salience: () => 1, habituationTau: 0,
        properties: { visual: { combatants: () => init.combatants.map(summary) } },
      },
    ];
  };

  const buildBeforePrompt = async (
    msg: Message,
    bound: { beforePrompt(msg: Message): Promise<Partial<StageResponse<unknown, unknown>>> },
  ): Promise<Partial<StageResponse<unknown, unknown>>> => {
    const now = turn.n;
    const observed = assembleObservations(
      [...observationSources(now), events],
      { now }, { now, maxCount: 3 },
    );
    const stageDirections = emitStageDirections({ ...init.stageDirections, observations: observed });
    return mergeResponses({ stageDirections }, await bound.beforePrompt(msg));
  };

  const buildAfterResponse = async (
    msg: Message,
    bound: { afterResponse(msg: Message): Promise<Partial<StageResponse<unknown, unknown>>> },
  ): Promise<Partial<StageResponse<unknown, unknown>>> => {
    const r = parseTags<Record<string, unknown>>(msg.content, {
      [actionTag]: { kind: "string", enum: init.validActions, default: init.defaultAction },
    });
    const choice = typeof r.parsed[actionTag] === "string" ? r.parsed[actionTag] as string : init.defaultAction;
    turn.choice = choice;
    if (combatantsHolder.ended) {
      const stripped = r.stripped !== msg.content ? r.stripped : null;
      return mergeResponses({ modifiedMessage: stripped }, await bound.afterResponse(msg));
    }
    turn.n += 1;
    // Reset AP.
    for (const c of init.combatants) {
      if (c.resources) c.resources.ap = init.apResets[c.id] ?? c.resources.ap;
    }
    // Tick effects.
    for (const c of init.combatants) c.effects?.tick(turn.n);
    // Run one round.
    const roundEvents = runRound(
      init.combatants, init.chooseFor,
      { combatants: init.combatants } as World,
      turn.n, rng.mechanical,
    );
    for (const e of roundEvents) events.push(e, turn.n);
    // Check ended.
    const pc = init.combatants.find((c) => c.id === "pc");
    const enemies = init.combatants.filter((c) => c.id !== "pc");
    if (pc && pc.hp <= 0) combatantsHolder.ended = "pc-down";
    else if (enemies.length > 0 && enemies.every((e) => e.hp <= 0)) combatantsHolder.ended = "enemy-down";
    const stripped = r.stripped !== msg.content ? r.stripped : null;
    const sys = combatantsHolder.ended ? `[combat ends: ${combatantsHolder.ended}]` : null;
    return mergeResponses({ modifiedMessage: stripped, systemMessage: sys }, await bound.afterResponse(msg));
  };

  return { combatants: init.combatants, combatantsHolder, turn, events, rng, layers, store, buildBeforePrompt, buildAfterResponse };
}
