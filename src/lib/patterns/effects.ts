/*
 * patterns/effects.ts — effects + stats + timeline composer.
 *
 * WHAT: `effectsPattern(init)` wires an `EffectStore` + `Timeline` + tick
 *       counter with persistence shards, builds observation sources for
 *       active-effects and a tincture menu, and returns a `buildBeforePrompt`
 *       helper that handles tick, effect expiry, and stage-directions
 *       emission. The `buildAfterResponse` helper strips apply/dispel tags
 *       from the bot message and applies them.
 *
 *       The composer is a recipe, not a primitive. All state is in the
 *       returned bundle's exposed fields.
 *
 * WHY: Every effects stage re-derives the same tick → tick() → observe →
 *      emitStageDirections pipeline plus the parseTags → apply/dispel loop.
 *      The composer collapses that wiring into a single declaration, leaving
 *      only effect definitions and prose config in the stage.
 *
 *      No new mechanics. No private state. See `EFFECTS.md` for Purpose /
 *      API / Gotchas.
 *
 * SHAPE:
 *   interface EffectsBundleInit
 *     { messageState; tinctures; applyTagName?; dispelTagName?;
 *       stageDirections }
 *   interface EffectsBundle
 *     { effectStore; tick; events; layers; store;
 *       buildBeforePrompt(msg, bound): Promise<StageResponse fragment>;
 *       buildAfterResponse(msg, bound): Promise<StageResponse fragment> }
 *   function effectsPattern(init): EffectsBundle
 */

import type { Message, StageResponse } from "@chub-ai/stages-ts";
import { type EffectDef, EffectStore, type EffectMagnitudes } from "../effects";
import { Registry } from "../registry";
import { Timeline } from "../timeline";
import { parseTags } from "../tag-parser";
import { emitStageDirections } from "../chub-adapters";
import { type ObservationSource, assembleObservations } from "../observation";
import type { ArchitectureName } from "../prose-register";
import type { RegisterSpec } from "../prose-register";
import {
  PersistenceStore,
  createChubLayers,
  chubTreeHistory,
  mergeResponses,
  counterShard,
  shardOf,
} from "../persistence";

export interface EffectsBundleInit {
  /** Raw messageState from `InitialData`. */
  messageState: Record<string, string | undefined> | null;
  /** Registry of available effect definitions keyed by id. */
  tinctures: Registry<EffectDef>;
  /**
   * Tag name the LLM emits to apply an effect. Default `"apply"`.
   * E.g. `<apply>adrenaline</apply>` → `effectStore.apply(...)`.
   */
  applyTagName?: string;
  /**
   * Tag name the LLM emits to dispel effects by tag. Default `"dispel"`.
   * E.g. `<dispel>calm</dispel>` → `effectStore.dispelByTag(...)`.
   */
  dispelTagName?: string;
  /** Stage-directions options forwarded to `emitStageDirections`. */
  stageDirections: {
    architectures?: readonly ArchitectureName[];
    register?: RegisterSpec;
    prefix?: string;
  };
}

export interface EffectsBundle {
  effectStore: EffectStore;
  tick: { n: number };
  events: Timeline<string>;
  layers: ReturnType<typeof createChubLayers>;
  store: PersistenceStore;
  /**
   * Increments tick, drains expired effects onto the timeline, assembles
   * observations, and calls `emitStageDirections`. Call inside `beforePrompt`.
   */
  buildBeforePrompt(
    msg: Message,
    bound: { beforePrompt(msg: Message): Promise<Partial<StageResponse<unknown, unknown>>> },
  ): Promise<Partial<StageResponse<unknown, unknown>>>;
  /**
   * Parses apply/dispel tags from the bot message, mutates `effectStore`,
   * strips matched tags from the response. Call inside `afterResponse`.
   */
  buildAfterResponse(
    msg: Message,
    bound: { afterResponse(msg: Message): Promise<Partial<StageResponse<unknown, unknown>>> },
  ): Promise<Partial<StageResponse<unknown, unknown>>>;
}

export function effectsPattern(init: EffectsBundleInit): EffectsBundle {
  const applyTag = init.applyTagName ?? "apply";
  const dispelTag = init.dispelTagName ?? "dispel";
  const effectStore = new EffectStore();
  const tick = { n: 0 };
  const events = new Timeline<string>({
    id: "tincture-events", channels: ["interoceptive"], windowSize: 20, habituationTau: 2,
  });
  const layers = createChubLayers({ messageState: init.messageState ?? null });

  const store = new PersistenceStore({
    tick: counterShard("tick", tick, layers.messageStateBackend, chubTreeHistory()),
    effects: shardOf(
      "effects", effectStore,
      (d) => EffectStore.fromJSON(d, init.tinctures.toJSON()),
      layers.messageStateBackend, chubTreeHistory(),
    ),
  });

  const observationSources = (now: number): ObservationSource<{ now: number }>[] => [
    {
      id: "active-effects", channels: ["interoceptive"],
      salience: () => Math.min(1, effectStore.active().length / 3), habituationTau: 3,
      properties: {
        interoceptive: {
          active: () => effectStore.active().map((i) => {
            const m: EffectMagnitudes = effectStore.magnitudesFor(i.id, now) ?? {};
            return {
              id: i.id,
              remaining: i.def.duration != null ? Math.max(0, i.def.duration - (now - i.startTime)) : null,
              stacks: i.count, stats: m.stats ?? {}, tags: m.tagsAdd ?? [],
            };
          }),
        },
      },
    },
    {
      id: "tincture-menu", channels: ["visual"], salience: () => 0.3, habituationTau: 20,
      properties: {
        visual: {
          available: () => init.tinctures.entries().map(([id, def]) => ({
            id, stacking: def.stacking, duration: def.duration,
          })),
        },
      },
    },
  ];

  const buildBeforePrompt = async (
    msg: Message,
    bound: { beforePrompt(msg: Message): Promise<Partial<StageResponse<unknown, unknown>>> },
  ): Promise<Partial<StageResponse<unknown, unknown>>> => {
    tick.n += 1;
    const now = tick.n;
    const expired = effectStore.tick(now);
    for (const e of expired) events.push(`expired:${e.id}`, now);
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
    const now = tick.n;
    const r1 = parseTags<Record<string, unknown>>(msg.content, { [applyTag]: { kind: "string" } });
    const r2 = parseTags<Record<string, unknown>>(r1.stripped, { [dispelTag]: { kind: "string" } });
    const applyId = typeof r1.parsed[applyTag] === "string" ? (r1.parsed[applyTag] as string).trim() : "";
    const tincture = applyId ? init.tinctures.get(applyId) : undefined;
    if (tincture) {
      effectStore.apply(tincture, now);
      events.push(`applied:${applyId}`, now);
    }
    const dispelValue = typeof r2.parsed[dispelTag] === "string" ? (r2.parsed[dispelTag] as string).trim() : "";
    if (dispelValue) {
      const dispelled = effectStore.dispelByTag(dispelValue);
      for (const d of dispelled) events.push(`dispelled:${d.id}`, now);
    }
    const stripped = r2.stripped !== msg.content ? r2.stripped : null;
    return mergeResponses({ modifiedMessage: stripped }, await bound.afterResponse(msg));
  };

  return { effectStore, tick, events, layers, store, buildBeforePrompt, buildAfterResponse };
}
