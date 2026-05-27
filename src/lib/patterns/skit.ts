/*
 * patterns/skit.ts — PARC Skit shape: scene + observation + outcome-resolution
 *                    + actor.
 *
 * WHAT: `skitPattern(init)` delivers the "make a Skit" ergonomics from PARC
 *       as a pure composition of existing primitives:
 *
 *         - One or more `Actor` instances (the scene participants).
 *         - A `Scene` via `scenePattern` (action dispatch + arousal).
 *         - An `ObservationSource` bundle via `assembleObservations` so the
 *           stage can feed the LLM structured state without hand-wiring.
 *         - An outcome-resolution callback type (`onOutcome`) the stage author
 *           supplies; fired after every `step()` with the `SceneOutcome`.
 *
 *       Returns a `SkitBundle` that exposes `step`, `tick`, `observe`, and
 *       direct access to all composed parts.
 *
 *       Composes: `scenePattern` + `Actor`/`ActorPool` + `observation` +
 *                 `Timeline`.
 *
 * WHY: COMPOSITION.md §"Domain-noun mapping" calls out `Skit` specifically:
 *      "a pattern over existing primitives. The monolith feel at the import
 *      statement is preserved; the substance underneath is pure composition."
 *      ROADMAP lists it as "scene + observation + outcome-resolution + actor."
 *      The first caller will be any LT/CoC-axis stage that wants a single
 *      import to stand up a scene with participant actors and LLM-ready
 *      observations — rather than separately instantiating Scene, Timeline,
 *      ActorPool, and observation wiring.
 *
 * SHAPE:
 *   type SkitOutcomeHandler = (outcome, bundle) => void
 *   interface SkitBundleInit
 *     { actors; actions; position; agency; pace; rng;
 *       onOutcome?; proseTagSchema?; timeline? }
 *   interface SkitBundle
 *     { scene; actors; timeline; consequences;
 *       step(performerId, receiverId, actionId, roles?): SceneOutcome | null;
 *       tick(now, effects?): SceneEvent[];
 *       observe(state, opts?): AssembledObservation[] }
 *   function skitPattern(init: SkitBundleInit): SkitBundle
 */

import type { ActorId, ActorPool } from "../actor";
import type { Actor } from "../actor";
import type { EffectStore } from "../effects";
import type { Registry } from "../registry";
import { type Rng, RngStream } from "../rng";
import type { Agency, Pace, SceneActionDef, SceneEvent, SceneOutcome } from "../scene";
import type { ScenePosition, ProseRoles } from "../scene";
import type { ParseResult, Schema } from "../tag-parser";
import { Timeline } from "../timeline";
import {
  assembleObservations,
  type AssembledObservation,
  type AssembleOptions,
} from "../observation";
import { scenePattern, type SceneBundle, type SceneBundleInit } from "./scene";

export type SkitOutcomeHandler = (outcome: SceneOutcome, bundle: SkitBundle) => void;

export interface SkitBundleInit {
  /** Participants. Either an ActorPool or a plain Map — passed directly to scenePattern. */
  actors: ActorPool | Map<ActorId, Actor>;
  actions: Registry<SceneActionDef>;
  position: ScenePosition;
  agency: Map<ActorId, Agency>;
  pace: Map<ActorId, Pace>;
  rng: Rng | RngStream;
  /** Called after every successful `step`. Stage author handles consequence side-effects. */
  onOutcome?: SkitOutcomeHandler;
  /** Optional tag-parser schema for LLM-emitted action intents. */
  proseTagSchema?: Schema;
  /** Bring-your-own timeline. Created if omitted. */
  timeline?: Timeline<SceneEvent>;
}

export interface SkitBundle {
  scene: SceneBundle;
  actors: ActorPool | Map<ActorId, Actor>;
  timeline: Timeline<SceneEvent>;
  /**
   * Dispatch one action from performer to receiver. Fires `onOutcome` if an
   * outcome results. Returns null when the action is not legal.
   */
  step(
    performerId: ActorId,
    receiverId: ActorId,
    actionId: string,
    roles?: ProseRoles,
  ): SceneOutcome | null;
  /** Advance scene clock; returns fired events. */
  tick(now: number, effects?: Map<ActorId, EffectStore>): SceneEvent[];
  /** Assemble structured observations for LLM context (salience-ranked). */
  observe(state: unknown, opts: AssembleOptions): AssembledObservation[];
  /** Defined when proseTagSchema was supplied. */
  parseActionTags?(llmOutput: string): ParseResult;
}

export function skitPattern(init: SkitBundleInit): SkitBundle {
  const sceneInit: SceneBundleInit = {
    actors: init.actors,
    actions: init.actions,
    position: init.position,
    agency: init.agency,
    pace: init.pace,
    rng: init.rng,
    timeline: init.timeline,
    proseTagSchema: init.proseTagSchema,
  };
  const scene = scenePattern(sceneInit);

  const bundle: SkitBundle = {
    scene,
    actors: init.actors,
    timeline: scene.timeline,
    step(performerId, receiverId, actionId, roles): SceneOutcome | null {
      const outcome = scene.step(performerId, receiverId, actionId, roles);
      if (outcome !== null) init.onOutcome?.(outcome, bundle);
      return outcome;
    },
    tick(now, effects): SceneEvent[] {
      return scene.tick(now, effects);
    },
    observe(state, opts): AssembledObservation[] {
      // The timeline already implements ObservationSource; pass it as the
      // single observation source. Stages with additional sources add them.
      return assembleObservations([scene.timeline], state, opts);
    },
  };

  if (scene.parseActionTags) {
    bundle.parseActionTags = scene.parseActionTags.bind(scene);
  }

  return bundle;
}
