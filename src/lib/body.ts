/*
 * body.ts — body with slots, base tags, and a stack of transformations.
 *
 * WHAT: A Body has a map of slot-name -> base TagSet (the "natural" state) and a
 *       list of active TransformationInstance entries. The effective tags for a
 *       slot are computed on every read: start from base, then apply each
 *       transformation's removeTags then addTags in stack order.
 *
 * WHY: Rule #2 (def/instance), #4 (pure calculator + mutable holder), #6 (time
 *      tracked via startTime). Body is the substrate; transformation defs live
 *      in transformation.ts.
 *
 * SHAPE:
 *   interface TransformationInstance { id, slot, addTags, removeTags, startTime,
 *     duration?: number | null, source?: any (def back-ref) }
 *   class Body
 *     constructor(initialSlots?: Record<string, Iterable<string>> | Map<...>)
 *     hasSlot(s), getSlots(), getBaseTags(s), setBaseTags(s, tags)
 *     addSlot(s, tags?), removeSlot(s)
 *     getEffectiveTags(s): TagSet
 *     getAllEffectiveTags(): Map<string, TagSet>
 *     applyTransformation(tf): Body
 *     removeTransformation(id): boolean
 *     hasTransformation(id), getTransformation(id), getTransformations()
 *     getTransformationsForSlot(s)
 *     applyPermanent(patch): { success, reason? }   // dissolve into base
 *     tick(now): TransformationInstance[]            // returns expired
 *     toJSON()
 */

import { TagSet } from "./tags";

export interface TransformationInstance {
  id: string;
  slot: string;
  addTags: string[];
  removeTags: string[];
  /** Absolute time the TF was applied. tick(now) uses (now - startTime) for elapsed. */
  startTime: number;
  /** null/undefined = permanent. Otherwise duration in same units as startTime. */
  duration?: number | null;
  /** Back-reference to a TransformationDef for relationship lookups (optional). */
  source?: unknown;
}

export interface PermanentPatch {
  slot: string;
  addTags?: string[];
  removeTags?: string[];
}

export type ApplyResult = { success: true } | { success: false; reason: string };

export class Body {
  private _baseSlots: Map<string, TagSet> = new Map();
  private _transformations: TransformationInstance[] = [];

  constructor(
    initialSlots?:
      | Record<string, Iterable<string> | TagSet>
      | Map<string, Iterable<string> | TagSet>,
  ) {
    if (!initialSlots) return;
    const entries: Iterable<[string, Iterable<string> | TagSet]> =
      initialSlots instanceof Map ? initialSlots : Object.entries(initialSlots);
    for (const [slot, tags] of entries) {
      this._baseSlots.set(slot, tags instanceof TagSet ? tags.clone() : new TagSet(tags));
    }
  }

  hasSlot(slot: string): boolean {
    return this._baseSlots.has(slot);
  }

  getSlots(): string[] {
    return [...this._baseSlots.keys()];
  }

  getBaseTags(slot: string): TagSet {
    const t = this._baseSlots.get(slot);
    return t ? t.clone() : new TagSet();
  }

  setBaseTags(slot: string, tags: TagSet | Iterable<string>): Body {
    this._baseSlots.set(slot, tags instanceof TagSet ? tags.clone() : new TagSet(tags));
    return this;
  }

  addSlot(slot: string, tags: Iterable<string> = []): Body {
    this._baseSlots.set(slot, new TagSet(tags));
    return this;
  }

  removeSlot(slot: string): boolean {
    // also drop transformations targeting this slot
    this._transformations = this._transformations.filter((tf) => tf.slot !== slot);
    return this._baseSlots.delete(slot);
  }

  getEffectiveTags(slot: string): TagSet {
    const tags = this.getBaseTags(slot);
    for (const tf of this._transformations) {
      if (tf.slot !== slot) continue;
      for (const t of tf.removeTags) tags.remove(t);
      for (const t of tf.addTags) tags.add(t);
    }
    return tags;
  }

  getAllEffectiveTags(): Map<string, TagSet> {
    const result = new Map<string, TagSet>();
    for (const slot of this._baseSlots.keys()) {
      result.set(slot, this.getEffectiveTags(slot));
    }
    return result;
  }

  applyTransformation(tf: TransformationInstance): Body {
    if (!tf.id) throw new Error("Transformation must have 'id'");
    if (!tf.slot) throw new Error("Transformation must have 'slot'");
    this.removeTransformation(tf.id);
    this._transformations.push(tf);
    return this;
  }

  removeTransformation(id: string): boolean {
    const before = this._transformations.length;
    this._transformations = this._transformations.filter((tf) => tf.id !== id);
    return this._transformations.length !== before;
  }

  hasTransformation(id: string): boolean {
    return this._transformations.some((tf) => tf.id === id);
  }

  getTransformation(id: string): TransformationInstance | undefined {
    return this._transformations.find((tf) => tf.id === id);
  }

  getTransformations(): TransformationInstance[] {
    return [...this._transformations];
  }

  getTransformationsForSlot(slot: string): TransformationInstance[] {
    return this._transformations.filter((tf) => tf.slot === slot);
  }

  applyPermanent(patch: PermanentPatch): ApplyResult {
    if (!this.hasSlot(patch.slot)) return { success: false, reason: "slot_missing" };
    const base = this._baseSlots.get(patch.slot)!;
    for (const t of patch.removeTags ?? []) base.remove(t);
    for (const t of patch.addTags ?? []) base.add(t);
    return { success: true };
  }

  /** Advance the world clock; remove transformations whose duration has elapsed. */
  tick(now: number): TransformationInstance[] {
    const expired: TransformationInstance[] = [];
    const surviving: TransformationInstance[] = [];
    for (const tf of this._transformations) {
      if (tf.duration == null) {
        surviving.push(tf);
        continue;
      }
      const elapsed = now - tf.startTime;
      if (elapsed >= tf.duration) expired.push(tf);
      else surviving.push(tf);
    }
    this._transformations = surviving;
    return expired;
  }

  toJSON(): {
    baseSlots: Record<string, string[]>;
    transformations: TransformationInstance[];
  } {
    const baseSlots: Record<string, string[]> = {};
    for (const [k, v] of this._baseSlots) baseSlots[k] = v.toArray();
    return {
      baseSlots,
      transformations: this._transformations.map((tf) => ({ ...tf, source: undefined })),
    };
  }

  static fromJSON(data: {
    baseSlots: Record<string, string[]>;
    transformations: TransformationInstance[];
  }): Body {
    const b = new Body(data.baseSlots);
    for (const tf of data.transformations) b.applyTransformation({ ...tf });
    return b;
  }

  toString(): string {
    return `Body(slots=[${this.getSlots().join(", ")}], tfs=${this._transformations.length})`;
  }
}
