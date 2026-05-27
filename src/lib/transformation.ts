/*
 * transformation.ts — definitions for body modifications.
 *
 * WHAT: A TransformationDef is a blueprint: which slot it touches, which tags it
 *       adds/removes, how long it lasts, what tags it requires/forbids on the
 *       slot, and how it relates to other TFs (the conflicts map).
 *       `apply(body, now)` creates a TransformationInstance and pushes it onto
 *       the body's stack. `getConflicts(body)` returns two-perspective records
 *       so the stage's own conflict policy can decide what to do.
 *       Phase 6 adds `trajectory(elapsed) -> {addTags, removeTags}` so a TF can
 *       vary its effect over its lifetime.
 *
 * WHY: Rule #2 (def/instance), #3 (detect-vs-resolve — `getConflicts` produces
 *      data; resolution is the stage's policy), #6 (time = now - startTime).
 *
 * SHAPE:
 *   type RelationKind = string  // "stack" | "replace" | "block" | ... user-defined
 *   interface ConflictRecord { existingId, existingTf, incomingSays, existingSays }
 *   interface TrajectoryStep { addTags: string[]; removeTags: string[] }
 *   type Trajectory = (elapsedFraction: number, elapsed: number) => TrajectoryStep
 *   interface TransformationDef {
 *     id; slot; addTags; removeTags; baseDuration?;
 *     requiresTags?; conflictsWithTags?; conflicts?: Record<id-or-"*", RelationKind>;
 *     trajectory?: Trajectory;
 *     displayName?; description?;
 *   }
 *   getRelationship(def, otherId): RelationKind | null
 *   canApply(def, body): { ok: true } | { ok: false, reason, detail? }
 *   getConflicts(def, body): ConflictRecord[]
 *   apply(def, body, now, durationOverride?): TransformationInstance | null
 *   fromDict(data): TransformationDef
 */

import { Body, TransformationInstance } from "./body";

export type RelationKind = string;

export interface TrajectoryStep {
  addTags: string[];
  removeTags: string[];
}

/**
 * A trajectory varies a transformation's effect over its lifetime.
 *   elapsedFraction is elapsed/duration in [0,1] (or >1 for permanent past base).
 *   elapsed is absolute (same units as startTime).
 * Returning add/remove tags REPLACES the def's base add/removeTags for this read.
 * Phase 6 hook: stages that don't need it can ignore it; body.getEffectiveTags
 * is unaware of trajectories (it reads what's on the instance), so a separate
 * sweep `applyTrajectories(body, now)` rewrites instance.addTags/removeTags.
 */
export type Trajectory = (elapsedFraction: number, elapsed: number) => TrajectoryStep;

export interface TransformationDef {
  id: string;
  slot: string;
  addTags: string[];
  removeTags: string[];
  /** 0 / undefined / null = permanent. */
  baseDuration?: number | null;
  requiresTags?: string[];
  conflictsWithTags?: string[];
  /** Map of other-TF-id (or "*") to a relationship label. Game decides semantics. */
  conflicts?: Record<string, RelationKind>;
  trajectory?: Trajectory;
  displayName?: string;
  description?: string;
}

export interface ConflictRecord {
  existingId: string;
  existingTf: TransformationInstance;
  incomingSays: RelationKind | null;
  existingSays: RelationKind | null;
}

export type CanApply =
  | { ok: true }
  | { ok: false; reason: "slot_missing"; detail: string }
  | { ok: false; reason: "missing_required"; detail: string }
  | { ok: false; reason: "conflicts"; detail: string };

export function getRelationship(
  def: TransformationDef,
  otherId: string,
): RelationKind | null {
  const c = def.conflicts;
  if (!c) return null;
  if (Object.prototype.hasOwnProperty.call(c, otherId)) return c[otherId];
  if (Object.prototype.hasOwnProperty.call(c, "*")) return c["*"];
  return null;
}

function existingRelationship(
  existingTf: TransformationInstance,
  otherId: string,
): RelationKind | null {
  const src = existingTf.source as TransformationDef | undefined;
  if (!src || typeof src !== "object") return null;
  return getRelationship(src, otherId);
}

export function canApply(def: TransformationDef, body: Body): CanApply {
  if (!body.hasSlot(def.slot)) return { ok: false, reason: "slot_missing", detail: def.slot };
  const effective = body.getEffectiveTags(def.slot);
  for (const tag of def.requiresTags ?? []) {
    if (!effective.has(tag)) return { ok: false, reason: "missing_required", detail: tag };
  }
  for (const tag of def.conflictsWithTags ?? []) {
    if (effective.has(tag)) return { ok: false, reason: "conflicts", detail: tag };
  }
  return { ok: true };
}

export function getConflicts(def: TransformationDef, body: Body): ConflictRecord[] {
  const result: ConflictRecord[] = [];
  for (const tf of body.getTransformations()) {
    const incomingSays = getRelationship(def, tf.id);
    const existingSays = existingRelationship(tf, def.id);
    if (incomingSays !== null || existingSays !== null) {
      result.push({
        existingId: tf.id,
        existingTf: tf,
        incomingSays,
        existingSays,
      });
    }
  }
  return result;
}

/**
 * Build the instance and push it onto the body's stack.
 * Returns null if the def cannot be applied. Does NOT resolve conflicts —
 * call getConflicts first and let the stage's policy decide.
 */
export function apply(
  def: TransformationDef,
  body: Body,
  now: number,
  durationOverride?: number | null,
): TransformationInstance | null {
  if (!canApply(def, body).ok) return null;
  const dur =
    durationOverride !== undefined
      ? durationOverride
      : def.baseDuration && def.baseDuration > 0
        ? def.baseDuration
        : null;
  const inst: TransformationInstance = {
    id: def.id,
    slot: def.slot,
    addTags: [...def.addTags],
    removeTags: [...def.removeTags],
    startTime: now,
    duration: dur,
    source: def,
    displayName: def.displayName,
    description: def.description,
  };
  body.applyTransformation(inst);
  return inst;
}

/**
 * Phase 6: walk all transformation instances; for any whose source def has a
 * trajectory, rewrite the instance's addTags/removeTags from the current elapsed.
 * Permanent TFs use elapsedFraction = 1 once their nominal trajectory window
 * (also stored as baseDuration) is past.
 */
export function applyTrajectories(body: Body, now: number): void {
  for (const tf of body.getTransformations()) {
    const def = tf.source as TransformationDef | undefined;
    if (!def?.trajectory) continue;
    const elapsed = now - tf.startTime;
    const window = def.baseDuration && def.baseDuration > 0 ? def.baseDuration : elapsed || 1;
    const frac = window > 0 ? Math.min(elapsed / window, 1) : 1;
    const step = def.trajectory(frac, elapsed);
    tf.addTags = [...step.addTags];
    tf.removeTags = [...step.removeTags];
  }
}

export function fromDict(data: Partial<TransformationDef> & { id: string; slot: string }): TransformationDef {
  return {
    id: data.id,
    slot: data.slot,
    addTags: data.addTags ?? [],
    removeTags: data.removeTags ?? [],
    baseDuration: data.baseDuration ?? null,
    requiresTags: data.requiresTags ?? [],
    conflictsWithTags: data.conflictsWithTags ?? [],
    conflicts: data.conflicts ?? {},
    trajectory: data.trajectory,
    displayName: data.displayName ?? data.id,
    description: data.description ?? "",
  };
}
