/*
 * inventory.ts — spot-based inventory with carry-class semantics.
 *
 * WHAT: Items live in named "spots" (pocket, hand, backpack-main, kitchen-counter,
 *       …) as stacks `{ defId, count }`. Each ItemDef has a carryClass:
 *         - "fixed"     : never moves between scenes on its own (e.g. furniture
 *                          item).
 *         - "explicit"  : moves only when the player/scene explicitly takes it.
 *         - "habitual"  : may auto-follow the actor on scene change (carried-out
 *                          by reflex; controlled by `resolveLeaveLocation`).
 *       Each spot tracks `disorder` (0..1, drift from "neat"; affects access
 *       time) and `lastAccessed` (raises accessibility). `accessibility(def, spot)`
 *       returns a unitless score the stage can compare or threshold.
 *       Sketched after existence's items/clothing model (pockets, drift, fish-
 *       through cost), generalized to arbitrary spot graphs.
 *
 * WHY: Rule #2 (def/instance: stacks reference defIds), #4 (accessibility is
 *       computed on read), #8 (tier the resulting accessibility number with
 *       your own TierFn).
 *
 * SHAPE:
 *   type CarryClass = "fixed" | "explicit" | "habitual"
 *   interface ItemDef {
 *     id; carryClass; portable; counted;
 *     defaultSpot?; channels?: string[]; size?: number; tags?: string[];
 *     displayName?; description?;
 *   }
 *   interface Stack { defId: string; count: number }
 *   interface SpotMeta { disorder: number; lastAccessed: number; capacity?: number }
 *   class Inventory
 *     register(def): this
 *     getDef(id): ItemDef | undefined
 *     ensureSpot(name, meta?): this
 *     spots(): string[]
 *     contents(spot): Stack[]
 *     add(spot, defId, n=1): void
 *     remove(spot, defId, n=1): number   // actually removed
 *     move(from, to, defId, n=1): number // actually moved
 *     find(defId): Array<{spot, count}>
 *     touch(spot, now): void
 *     accessibility(defId, spot, now): number  // higher = easier to reach
 *     resolveLeaveLocation(stress: number, rng?): { kept: Stack[]; left: Record<spot, Stack[]> }
 *     toJSON()
 */

import { RngStream } from "./rng";

export type CarryClass = "fixed" | "explicit" | "habitual";

export interface ItemDef {
  id: string;
  carryClass: CarryClass;
  /** Can it be picked up / moved at all? */
  portable: boolean;
  /** Stackable count, or unique-instance. */
  counted: boolean;
  defaultSpot?: string;
  /** Sensory channels this item produces signal on (visual, olfactory, ...). */
  channels?: string[];
  /** Bulk units; spot capacity is also in bulk units. */
  size?: number;
  /** Free-form tags. */
  tags?: string[];
  displayName?: string;
  description?: string;
}

export interface Stack {
  defId: string;
  count: number;
}

export interface SpotMeta {
  disorder: number;
  lastAccessed: number;
  capacity?: number;
}

export class Inventory {
  private _defs: Map<string, ItemDef> = new Map();
  private _spots: Map<string, Stack[]> = new Map();
  private _meta: Map<string, SpotMeta> = new Map();

  register(def: ItemDef): this {
    this._defs.set(def.id, def);
    return this;
  }

  getDef(id: string): ItemDef | undefined {
    return this._defs.get(id);
  }

  ensureSpot(name: string, meta?: Partial<SpotMeta>): this {
    if (!this._spots.has(name)) this._spots.set(name, []);
    if (!this._meta.has(name))
      this._meta.set(name, { disorder: 0, lastAccessed: 0, capacity: meta?.capacity });
    if (meta) {
      const m = this._meta.get(name)!;
      if (meta.disorder !== undefined) m.disorder = meta.disorder;
      if (meta.lastAccessed !== undefined) m.lastAccessed = meta.lastAccessed;
      if (meta.capacity !== undefined) m.capacity = meta.capacity;
    }
    return this;
  }

  spots(): string[] {
    return [...this._spots.keys()];
  }

  contents(spot: string): Stack[] {
    return [...(this._spots.get(spot) ?? [])];
  }

  meta(spot: string): SpotMeta | undefined {
    return this._meta.get(spot);
  }

  add(spot: string, defId: string, n = 1): void {
    this.ensureSpot(spot);
    const def = this._defs.get(defId);
    const stacks = this._spots.get(spot)!;
    if (def?.counted !== false) {
      const existing = stacks.find((s) => s.defId === defId);
      if (existing) {
        existing.count += n;
        return;
      }
    }
    stacks.push({ defId, count: n });
  }

  remove(spot: string, defId: string, n = 1): number {
    const stacks = this._spots.get(spot);
    if (!stacks) return 0;
    let remaining = n;
    for (let i = stacks.length - 1; i >= 0 && remaining > 0; i--) {
      if (stacks[i].defId !== defId) continue;
      const take = Math.min(stacks[i].count, remaining);
      stacks[i].count -= take;
      remaining -= take;
      if (stacks[i].count <= 0) stacks.splice(i, 1);
    }
    return n - remaining;
  }

  move(from: string, to: string, defId: string, n = 1): number {
    const removed = this.remove(from, defId, n);
    if (removed > 0) this.add(to, defId, removed);
    return removed;
  }

  find(defId: string): { spot: string; count: number }[] {
    const out: { spot: string; count: number }[] = [];
    for (const [spot, stacks] of this._spots) {
      let count = 0;
      for (const s of stacks) if (s.defId === defId) count += s.count;
      if (count > 0) out.push({ spot, count });
    }
    return out;
  }

  touch(spot: string, now: number): void {
    const m = this._meta.get(spot);
    if (m) m.lastAccessed = now;
  }

  /**
   * Higher score = easier to reach.
   *   base 1.0
   *   - 0.5 if spot is disordered (linearly with `disorder`)
   *   + 0.5 if accessed recently (exponential decay with half-life 1.0 in
   *         whatever time units the stage uses; rescale via `now`)
   *   - 0.3 if the item is "habitual" but stored in a non-default spot
   *   - 0.2 per channel mismatch (channel routing is a stage concern; we
   *         only penalize if the def lists channels and the spot's name
   *         starts with "blind-" / similar prefix conventions)
   */
  accessibility(defId: string, spot: string, now: number): number {
    const def = this._defs.get(defId);
    const meta = this._meta.get(spot);
    if (!def || !meta) return 0;
    let score = 1.0;
    score -= 0.5 * Math.min(1, Math.max(0, meta.disorder));
    const recency = Math.exp(-Math.max(0, now - meta.lastAccessed));
    score += 0.5 * recency;
    if (def.carryClass === "habitual" && def.defaultSpot && def.defaultSpot !== spot) score -= 0.3;
    return score;
  }

  /**
   * Decide what items follow the actor when the scene changes location.
   * "fixed" items always stay; "explicit" items always stay unless already
   * in the actor's body-spots; "habitual" items follow probabilistically
   * — high stress drops more of them, accessibility raises retention.
   * `actorSpots` is the set of spot-names that the actor carries with them
   * (pockets, hands, equipped slots). Anything in those spots is treated as
   * already-on-body and kept; everything else is filtered by carry-class.
   */
  resolveLeaveLocation(
    stress: number,
    now: number,
    actorSpots: ReadonlySet<string>,
    rng?: RngStream,
  ): { kept: Record<string, Stack[]>; left: Record<string, Stack[]> } {
    const kept: Record<string, Stack[]> = {};
    const left: Record<string, Stack[]> = {};
    for (const [spot, stacks] of this._spots) {
      const onBody = actorSpots.has(spot);
      const dst = onBody ? kept : left;
      const altDst = onBody ? left : kept;
      for (const s of stacks) {
        const def = this._defs.get(s.defId);
        if (!def) {
          (dst[spot] ??= []).push({ ...s });
          continue;
        }
        if (def.carryClass === "fixed") {
          (left[spot] ??= []).push({ ...s });
          continue;
        }
        if (def.carryClass === "explicit") {
          (dst[spot] ??= []).push({ ...s });
          continue;
        }
        // habitual: roll per-stack
        const access = this.accessibility(s.defId, spot, now);
        const followProb = Math.max(0, Math.min(1, access - stress * 0.5));
        const roll = rng ? rng.float() : Math.random();
        const follows = roll < followProb;
        const target = follows ? dst : altDst;
        (target[spot] ??= []).push({ ...s });
      }
    }
    return { kept, left };
  }

  toJSON(): {
    defs: ItemDef[];
    spots: Record<string, Stack[]>;
    meta: Record<string, SpotMeta>;
  } {
    const spots: Record<string, Stack[]> = {};
    const meta: Record<string, SpotMeta> = {};
    for (const [k, v] of this._spots) spots[k] = v.map((s) => ({ ...s }));
    for (const [k, v] of this._meta) meta[k] = { ...v };
    return { defs: [...this._defs.values()], spots, meta };
  }
}
