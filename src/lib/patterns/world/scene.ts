/*
 * patterns/scene.ts — Wave 2A `scenePattern` composer.
 *
 * WHAT: Wires `Scene` + `Body` (via `Actor`) + `Timeline` + `Rng` +
 *       `SceneConsequenceRegistry` + an optional `tag-parser` schema for
 *       LLM-emitted scene actions. Returns a small object the stage holds
 *       on its instance: `actions` registry, `scene` instance, `timeline`,
 *       `consequences`, and a `step(performerId, receiverId, actionId,
 *       roles?)` helper that resolves the action, performs it, and emits
 *       the resulting events through the consequence registry — all the
 *       wiring a stage author would otherwise re-do per scene.
 *
 *       The composer is a recipe, not a primitive. It owns no state of its
 *       own; everything it returns is one of the underlying primitives,
 *       directly accessible.
 *
 * WHY: A scene is the most-composed primitive in the catalog — body tags,
 *      action gates, ongoing matrix, timeline events, effect-driven
 *      arousal trajectories, consequence handlers, prose role
 *      substitution. The composer collapses the boilerplate of wiring
 *      these together so a stage's scene-bring-up reads as a single
 *      declaration.
 *
 *      No new mechanics. No private state. See `src/lib/design/SCENE.md`
 *      for the full design + key decisions; this file is the assembly.
 *
 * SHAPE:
 *   interface SceneBundleInit
 *     { actors: ActorPool | Map<ActorId, Actor>;
 *       actions: Registry<SceneActionDef>;
 *       position; agency; pace;
 *       rng: Rng | RngStream;
 *       timeline?: Timeline<SceneEvent>;
 *       consequences?: SceneConsequenceRegistry;
 *       resolvers?: Resolvers<SceneState, ActorId>;
 *       proseTagSchema?: Schema; }
 *   interface SceneBundle
 *     { scene; timeline; consequences; rng; actions; bodies;
 *       step(performerId, receiverId, actionId, roles?): SceneOutcome | null;
 *       tick(now, effects?): SceneEvent[];
 *       parseActionTags?(llmOutput): ParseResult; }
 *   function scenePattern(init: SceneBundleInit): SceneBundle
 */

import type { Actor, ActorId, ActorPool } from "../actor";
import type { Body } from "../body";
import type { EffectStore } from "../effects";
import type { Resolvers } from "../predicate";
import type { Registry } from "../registry";
import { type Rng, RngStream } from "../rng";
import { Timeline } from "../timeline";
import {
  type Agency,
  type Pace,
  Scene,
  type SceneActionDef,
  type SceneEvent,
  type SceneOutcome,
  type SceneState,
  type ScenePosition,
  type ProseRoles,
  SceneConsequenceRegistry,
} from "../scene";
import type { ParseResult, Schema } from "../tag-parser";
import { parseTags } from "../tag-parser";

export interface SceneBundleInit {
  /** Actor source — either an ActorPool or a plain Map. Used to extract
   *  per-actor Body for the predicate tag resolver. */
  actors: ActorPool | Map<ActorId, Actor>;
  actions: Registry<SceneActionDef>;
  position: ScenePosition;
  agency: Map<ActorId, Agency>;
  pace: Map<ActorId, Pace>;
  /** Rng or pre-split stream. If an Rng is supplied, the `mechanical`
   *  stream drives prose-variant selection and any future probabilistic
   *  scene rolls. */
  rng: Rng | RngStream;
  /** Bring-your-own Timeline. Created if not supplied. */
  timeline?: Timeline<SceneEvent>;
  /** Bring-your-own consequence registry. Created if not supplied. */
  consequences?: SceneConsequenceRegistry;
  /** Stage-author resolvers for predicate kinds outside `tag-on` /
   *  `world-flag` (which the scene fills automatically). */
  resolvers?: Resolvers<SceneState, ActorId>;
  /** Optional tag-parser schema for an LLM emitting structured action
   *  intents (e.g. `<scene-action>kiss</scene-action>`). When provided,
   *  the bundle exposes `parseActionTags`. */
  proseTagSchema?: Schema;
}

export interface SceneBundle {
  scene: Scene;
  timeline: Timeline<SceneEvent>;
  consequences: SceneConsequenceRegistry;
  rng: RngStream;
  actions: Registry<SceneActionDef>;
  /** Per-actor body extraction. Re-derived on each `step` so Body
   *  mutations from consequence handlers are visible immediately. */
  bodies(): Map<ActorId, Body>;
  /** Resolve action, perform it, push the resulting event through the
   *  consequence registry. Returns null if the action is not currently
   *  legal for the performer→receiver pair (the caller decides whether
   *  to surface a reason). */
  step(
    performerId: ActorId,
    receiverId: ActorId,
    actionId: string,
    roles?: ProseRoles,
  ): SceneOutcome | null;
  /** Tick the scene clock; emit fired events through the consequence
   *  registry; push them to the timeline. Returns the events. */
  tick(now: number, effects?: Map<ActorId, EffectStore>): SceneEvent[];
  /** Defined only when `proseTagSchema` was supplied at construction. */
  parseActionTags?(llmOutput: string): ParseResult;
}

function asActorMap(src: ActorPool | Map<ActorId, Actor>): Map<ActorId, Actor> {
  if (src instanceof Map) return src;
  // ActorPool exposes `forEach`; collect into a Map.
  const out = new Map<ActorId, Actor>();
  src.forEach((a) => out.set(a.id, a));
  return out;
}

export function scenePattern(init: SceneBundleInit): SceneBundle {
  const rng: RngStream =
    init.rng instanceof RngStream ? init.rng : init.rng.mechanical;
  const timeline = init.timeline ?? new Timeline<SceneEvent>({ windowSize: 12 });
  const consequences = init.consequences ?? new SceneConsequenceRegistry();
  const actors = asActorMap(init.actors);
  const scene = new Scene({
    position: init.position,
    agency: init.agency,
    pace: init.pace,
    resolvers: init.resolvers,
  });

  const bodies = (): Map<ActorId, Body> => {
    const out = new Map<ActorId, Body>();
    for (const [id, a] of actors) out.set(id, a.body);
    return out;
  };

  const step: SceneBundle["step"] = (performerId, receiverId, actionId, roles) => {
    const def = init.actions.get(actionId);
    if (!def) return null;
    const legal = scene.availableActions(performerId, receiverId, init.actions, bodies());
    if (!legal.some((d) => d.id === actionId)) return null;
    const outcome = scene.perform(
      {
        participant: { id: performerId },
        performingArea: def.performingArea,
        targetedArea: def.targetedArea,
      },
      receiverId,
      def,
      rng,
      timeline,
      roles,
    );
    for (const evt of outcome.events) consequences.emit(evt, scene);
    return outcome;
  };

  const tick: SceneBundle["tick"] = (now, effects) => {
    const fired = scene.tick(now, effects);
    for (const evt of fired) {
      timeline.push(evt);
      consequences.emit(evt, scene);
    }
    return fired;
  };

  const bundle: SceneBundle = {
    scene,
    timeline,
    consequences,
    rng,
    actions: init.actions,
    bodies,
    step,
    tick,
  };

  if (init.proseTagSchema) {
    const schema = init.proseTagSchema;
    bundle.parseActionTags = (llmOutput: string) => parseTags(llmOutput, schema);
  }

  return bundle;
}
