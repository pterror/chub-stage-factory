/*
 * snapshots.ts — named save/restore/diff for a Body.
 *
 * WHAT: Capture a body's base tags + transformation stack under a string name;
 *       restore them later; diff named snapshot against current state.
 *       Body-only by design — if stages want to snapshot inventory or stats
 *       too, they compose their own snapshotter following the same pattern.
 *
 * WHY: Rule #4 (mutable holder, externally observable). Snapshots are
 *      orthogonal to Body, so save/restore stays optional.
 *
 * SHAPE:
 *   interface SnapshotData { baseSlots: Record<slot, string[]>; transformations: TF[] }
 *   interface DiffResult {
 *     changed, slotsAdded[], slotsRemoved[],
 *     tagsAdded: Record<slot, string[]>, tagsRemoved: Record<slot, string[]>,
 *     tfsAdded[], tfsRemoved[]
 *   }
 *   class Snapshots
 *     constructor(body)
 *     save(name): void
 *     restore(name): boolean
 *     has(name), delete(name), list(): string[]
 *     clear(): void
 *     get(name): SnapshotData | undefined
 *     set(name, data): void
 *     diff(name): DiffResult | { error }
 *     toJSON(): { snaps: Record<name, SnapshotData> }
 *     static fromJSON(data, body): Snapshots
 */

import { Body, TransformationInstance } from "./body";
import { TagSet } from "./tags";

export interface SnapshotData {
  baseSlots: Record<string, string[]>;
  transformations: TransformationInstance[];
}

export interface DiffResult {
  changed: boolean;
  slotsAdded: string[];
  slotsRemoved: string[];
  tagsAdded: Record<string, string[]>;
  tagsRemoved: Record<string, string[]>;
  tfsAdded: string[];
  tfsRemoved: string[];
}

function capture(body: Body): SnapshotData {
  const baseSlots: Record<string, string[]> = {};
  for (const slot of body.getSlots()) baseSlots[slot] = body.getBaseTags(slot).toArray();
  return {
    baseSlots,
    transformations: body.getTransformations().map((tf) => ({ ...tf })),
  };
}

export class Snapshots {
  private _snaps: Map<string, SnapshotData> = new Map();
  constructor(private _body: Body) {}

  save(name: string): void {
    this._snaps.set(name, capture(this._body));
  }

  restore(name: string): boolean {
    const snap = this._snaps.get(name);
    if (!snap) return false;
    // Clear existing TFs
    for (const tf of this._body.getTransformations()) this._body.removeTransformation(tf.id);
    // Clear slots not present in snapshot
    for (const slot of this._body.getSlots()) {
      if (!Object.prototype.hasOwnProperty.call(snap.baseSlots, slot)) this._body.removeSlot(slot);
    }
    // Restore base tags
    for (const [slot, tags] of Object.entries(snap.baseSlots)) {
      if (this._body.hasSlot(slot)) this._body.setBaseTags(slot, new TagSet(tags));
      else this._body.addSlot(slot, tags);
    }
    // Restore TFs
    for (const tf of snap.transformations) this._body.applyTransformation({ ...tf });
    return true;
  }

  has(name: string): boolean {
    return this._snaps.has(name);
  }

  delete(name: string): boolean {
    return this._snaps.delete(name);
  }

  list(): string[] {
    return [...this._snaps.keys()];
  }

  clear(): void {
    this._snaps.clear();
  }

  get(name: string): SnapshotData | undefined {
    return this._snaps.get(name);
  }

  set(name: string, data: SnapshotData): void {
    this._snaps.set(name, data);
  }

  /** Serialize all stored snapshots. The body reference is not serialized. */
  toJSON(): { snaps: Record<string, SnapshotData> } {
    const snaps: Record<string, SnapshotData> = {};
    for (const [name, data] of this._snaps) {
      snaps[name] = {
        baseSlots: { ...data.baseSlots },
        transformations: data.transformations.map((tf) => ({ ...tf })),
      };
    }
    return { snaps };
  }

  /**
   * Reconstruct a Snapshots instance from serialized data. The caller must
   * supply the live body (snapshot data and body must refer to the same slots).
   */
  static fromJSON(data: { snaps: Record<string, SnapshotData> }, body: Body): Snapshots {
    const s = new Snapshots(body);
    for (const [name, snap] of Object.entries(data.snaps)) {
      s._snaps.set(name, {
        baseSlots: { ...snap.baseSlots },
        transformations: snap.transformations.map((tf) => ({ ...tf })),
      });
    }
    return s;
  }

  diff(name: string): DiffResult | { error: string } {
    const snap = this._snaps.get(name);
    if (!snap) return { error: "snapshot_not_found" };
    const current = capture(this._body);
    const result: DiffResult = {
      changed: false,
      slotsAdded: [],
      slotsRemoved: [],
      tagsAdded: {},
      tagsRemoved: {},
      tfsAdded: [],
      tfsRemoved: [],
    };
    const oldSlots = new Set(Object.keys(snap.baseSlots));
    const newSlots = new Set(Object.keys(current.baseSlots));
    for (const s of newSlots) if (!oldSlots.has(s)) result.slotsAdded.push(s);
    for (const s of oldSlots) if (!newSlots.has(s)) result.slotsRemoved.push(s);
    for (const slot of oldSlots) {
      if (!newSlots.has(slot)) continue;
      const oldT = new Set(snap.baseSlots[slot]);
      const newT = new Set(current.baseSlots[slot]);
      const added: string[] = [];
      const removed: string[] = [];
      for (const t of newT) if (!oldT.has(t)) added.push(t);
      for (const t of oldT) if (!newT.has(t)) removed.push(t);
      if (added.length) result.tagsAdded[slot] = added;
      if (removed.length) result.tagsRemoved[slot] = removed;
    }
    const oldIds = new Set(snap.transformations.map((tf) => tf.id));
    const newIds = new Set(current.transformations.map((tf) => tf.id));
    for (const id of newIds) if (!oldIds.has(id)) result.tfsAdded.push(id);
    for (const id of oldIds) if (!newIds.has(id)) result.tfsRemoved.push(id);
    result.changed =
      result.slotsAdded.length > 0 ||
      result.slotsRemoved.length > 0 ||
      result.tfsAdded.length > 0 ||
      result.tfsRemoved.length > 0 ||
      Object.keys(result.tagsAdded).length > 0 ||
      Object.keys(result.tagsRemoved).length > 0;
    return result;
  }
}
