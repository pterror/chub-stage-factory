/*
 * patterns/body-transformation.ts — body + transformation + tags + snapshots + timeline + observation composer.
 *
 * WHAT: `bodyTransformationPattern(init)` wires a `Body` + `Snapshots` +
 *       `Timeline<string>` + tick counter with persistence shards (tick on
 *       messageState, body+snaps on chatState+forbidBranching). Returns helpers
 *       for `beforePrompt` (trajectory advance → body.tick → observation →
 *       stage directions) and `buildAfterResponse` (drink/restore tag parse →
 *       tryApply → restore → strip).
 *
 *       The composer is a recipe, not a primitive. All state is in the
 *       returned bundle's exposed fields.
 *
 * WHY: Every body-transformation stage re-derives the same tick → trajectories
 *      → observation → parse(drink/restore) → tryApply pipeline. The composer
 *      collapses that wiring into a single declaration, leaving only the body
 *      slot schema, transformation definitions, and prose config in the stage.
 *
 *      No new mechanics. No private state. See `BODY-TRANSFORMATION.md` for
 *      Purpose / API / Gotchas.
 *
 * SHAPE:
 *   interface BodyTransformationBundleInit
 *     { messageState; chatState; initialSlots; tfs; drinkTagName?;
 *       restoreTagName?; stageDirections }
 *   interface BodyTransformationBundle
 *     { body; snaps; tick; applied; layers; store;
 *       buildBeforePrompt(msg, bound): Promise<StageResponse fragment>;
 *       buildAfterResponse(msg, bound): Promise<StageResponse fragment> }
 *   function bodyTransformationPattern(init): BodyTransformationBundle
 */

import type { Message, StageResponse } from "@chub-ai/stages-ts";
import { Body } from "../body";
import { Registry } from "../registry";
import { Timeline } from "../timeline";
import { type TransformationDef, apply, applyTrajectories, getConflicts } from "../transformation";
import { Snapshots } from "../snapshots";
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
  shardOf,
} from "../persistence";

export interface BodyTransformationBundleInit {
  /** Raw messageState from `InitialData`. */
  messageState: Record<string, string | undefined> | null;
  /** Raw chatState from `InitialData`. */
  chatState: Record<string, string | undefined> | null;
  /**
   * Initial slot → tags mapping used to construct the `Body`.
   * Example: `{ head: ["human", "hair-long"], tail: [] }`.
   */
  initialSlots: Record<string, string[]>;
  /**
   * Named snapshot to auto-save after body construction.
   * Set to `null` to skip. Default `"baseline"`.
   */
  baselineSnapshot?: string | null;
  /** Registry of available transformation definitions keyed by id. */
  tfs: Registry<TransformationDef>;
  /**
   * Tag name the LLM emits to apply a transformation. Default `"drink"`.
   * E.g. `<drink>cat_tail</drink>`.
   */
  drinkTagName?: string;
  /**
   * Tag name the LLM emits to restore a snapshot. Default `"restore"`.
   * E.g. `<restore>baseline</restore>`.
   */
  restoreTagName?: string;
  /** Stage-directions options forwarded to `emitStageDirections`. */
  stageDirections: {
    architectures?: readonly ArchitectureName[];
    register?: RegisterSpec;
    prefix?: string;
  };
}

export interface BodyTransformationBundle {
  body: Body;
  snaps: Snapshots;
  tick: { n: number; lastApplied?: string };
  applied: Timeline<string>;
  layers: ReturnType<typeof createChubLayers>;
  store: PersistenceStore;
  /**
   * Runs `applyTrajectories`, `body.tick`, assembles observations, and emits
   * stage directions. Call inside `beforePrompt`.
   */
  buildBeforePrompt(
    msg: Message,
    bound: { beforePrompt(msg: Message): Promise<Partial<StageResponse<unknown, unknown>>> },
  ): Promise<Partial<StageResponse<unknown, unknown>>>;
  /**
   * Parses drink/restore tags, applies transformation or restores snapshot,
   * strips matched tags from the response. Call inside `afterResponse`.
   */
  buildAfterResponse(
    msg: Message,
    bound: { afterResponse(msg: Message): Promise<Partial<StageResponse<unknown, unknown>>> },
  ): Promise<Partial<StageResponse<unknown, unknown>>>;
}

export function bodyTransformationPattern(init: BodyTransformationBundleInit): BodyTransformationBundle {
  const drinkTag = init.drinkTagName ?? "drink";
  const restoreTag = init.restoreTagName ?? "restore";
  const baselineSnapshot = init.baselineSnapshot === undefined ? "baseline" : init.baselineSnapshot;

  const body = new Body(init.initialSlots);
  const snaps = new Snapshots(body);
  if (baselineSnapshot) snaps.save(baselineSnapshot);

  const tick: { n: number; lastApplied?: string } = { n: 0, lastApplied: undefined };
  const applied = new Timeline<string>({
    id: "tinctures-applied", channels: ["interoceptive"], key: "applied", windowSize: 8, habituationTau: 6,
  });
  const layers = createChubLayers({
    messageState: init.messageState ?? null,
    chatState: init.chatState ?? null,
  });

  const store = new PersistenceStore({
    tick: shard("tick", tick,
      (i) => ({ n: i.n, lastApplied: i.lastApplied }),
      (d: { n: number; lastApplied?: string }) => ({ n: d.n, lastApplied: d.lastApplied }),
      layers.messageStateBackend, chubTreeHistory()),
    body: shardOf("body", body, (d) => Body.fromJSON(d), layers.chatStateBackend, forbidBranching(snapshotHistory())),
    snaps: shard("snaps", snaps,
      (i) => i.toJSON(),
      (d: ReturnType<Snapshots["toJSON"]>) => Snapshots.fromJSON(d, body),
      layers.chatStateBackend, forbidBranching(snapshotHistory())),
  });

  const tryApply = (id: string, now: number): { ok: boolean; reason?: string } => {
    const def = init.tfs.get(id);
    if (!def) return { ok: false, reason: "no-such-tf" };
    const confs = getConflicts(def, body);
    for (const c of confs) {
      if (c.incomingSays === "block" || c.existingSays === "block") return { ok: false, reason: `block:${c.existingId}` };
      if (c.incomingSays === "replace") body.removeTransformation(c.existingId);
    }
    const inst = apply(def, body, now);
    if (!inst) return { ok: false, reason: "canApply-failed" };
    applied.push(id, now);
    return { ok: true };
  };

  const observationSources = (now: number): ObservationSource<{ now: number }>[] => [
    {
      id: "body-state", channels: ["interoceptive"],
      salience: () => Math.min(1, body.getTransformations().length / 3 + 0.3),
      habituationTau: 4,
      properties: {
        interoceptive: {
          slots: () => {
            const out: Record<string, string[]> = {};
            for (const [slot, tags] of body.getAllEffectiveTags()) out[slot] = tags.toArray();
            return out;
          },
          in_progress: () => body.getTransformations().map((tf) => ({
            id: tf.id, slot: tf.slot, elapsed: now - tf.startTime, duration: tf.duration, current_tags: tf.addTags,
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
    applyTrajectories(body, now);
    body.tick(now);
    const observed = assembleObservations(
      [...observationSources(now), applied],
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
    const r1 = parseTags<Record<string, unknown>>(msg.content, { [drinkTag]: { kind: "string", enum: init.tfs.keys() } });
    const r2 = parseTags<Record<string, unknown>>(r1.stripped, { [restoreTag]: { kind: "string" } });
    if (typeof r1.parsed[drinkTag] === "string" && r1.parsed[drinkTag]) {
      const res = tryApply(r1.parsed[drinkTag] as string, now);
      if (res.ok) tick.lastApplied = r1.parsed[drinkTag] as string;
    }
    if (typeof r2.parsed[restoreTag] === "string" && r2.parsed[restoreTag]) {
      snaps.restore(r2.parsed[restoreTag] as string);
      applied.clear();
    }
    const stripped = r2.stripped !== msg.content ? r2.stripped : null;
    return mergeResponses({ modifiedMessage: stripped }, await bound.afterResponse(msg));
  };

  return { body, snaps, tick, applied, layers, store, buildBeforePrompt, buildAfterResponse };
}
