/*
 * effects.ts — buffs, debuffs, status effects with stacking + dispel.
 *
 * WHAT: An EffectDef describes an effect: which target axes it modifies
 *       (tags, stats, abilities), when it started, how long it lasts, and a
 *       trajectory `(elapsed) => Magnitudes` that lets the effect ramp up,
 *       fade, or pulse. A StackingPolicy decides what happens when the same
 *       effect id is applied while one is already active. Dispel by tag.
 *
 * WHY: Rule #3 (detect-vs-resolve — `tick` returns what expired, the stage
 *       removes them), #5 (explicit tick), #6 (elapsed = now - startTime).
 *
 * SHAPE:
 *   type StackingPolicy = "replace" | "extend" | "stack" | "highest"
 *   interface EffectMagnitudes {
 *     stats?: Record<statName, number>
 *     tagsAdd?: string[]
 *     tagsRemove?: string[]
 *     abilities?: Record<abilityName, number>   // e.g. cooldown scalar
 *   }
 *   interface EffectDef {
 *     id; targets: { stats?, tags?, abilities? };
 *     baseMagnitudes?: EffectMagnitudes;
 *     duration?: number | null;
 *     trajectory?: (elapsedFraction, elapsed) => EffectMagnitudes;
 *     stacking?: StackingPolicy;
 *     dispelTags?: string[];
 *   }
 *   interface EffectInstance { id, def, startTime, count }
 *   class EffectStore
 *     apply(def, now): EffectInstance
 *     remove(id): boolean
 *     dispelByTag(tag): EffectInstance[]
 *     active(): EffectInstance[]
 *     magnitudesFor(id, now): EffectMagnitudes | null
 *     totalMagnitudes(now): EffectMagnitudes
 *     tick(now): EffectInstance[]  // returns expired
 */

export type StackingPolicy = "replace" | "extend" | "stack" | "highest";

export interface EffectMagnitudes {
  stats?: Record<string, number>;
  tagsAdd?: string[];
  tagsRemove?: string[];
  abilities?: Record<string, number>;
}

export interface EffectDef {
  id: string;
  targets: {
    stats?: readonly string[];
    tags?: readonly string[];
    abilities?: readonly string[];
  };
  baseMagnitudes?: EffectMagnitudes;
  /** null/undefined = until removed. */
  duration?: number | null;
  trajectory?: (elapsedFraction: number, elapsed: number) => EffectMagnitudes;
  stacking?: StackingPolicy;
  dispelTags?: readonly string[];
}

export interface EffectInstance {
  id: string;
  def: EffectDef;
  startTime: number;
  /** How many stacks (for "stack" policy). */
  count: number;
}

function mergeMag(a: EffectMagnitudes, b: EffectMagnitudes): EffectMagnitudes {
  const out: EffectMagnitudes = {};
  if (a.stats || b.stats) {
    out.stats = { ...(a.stats ?? {}) };
    for (const [k, v] of Object.entries(b.stats ?? {})) out.stats[k] = (out.stats[k] ?? 0) + v;
  }
  if (a.tagsAdd || b.tagsAdd) out.tagsAdd = [...(a.tagsAdd ?? []), ...(b.tagsAdd ?? [])];
  if (a.tagsRemove || b.tagsRemove) out.tagsRemove = [...(a.tagsRemove ?? []), ...(b.tagsRemove ?? [])];
  if (a.abilities || b.abilities) {
    out.abilities = { ...(a.abilities ?? {}) };
    for (const [k, v] of Object.entries(b.abilities ?? {}))
      out.abilities[k] = (out.abilities[k] ?? 0) + v;
  }
  return out;
}

function scaleMag(m: EffectMagnitudes, k: number): EffectMagnitudes {
  if (k === 1) return m;
  const out: EffectMagnitudes = { ...m };
  if (m.stats) {
    out.stats = {};
    for (const [s, v] of Object.entries(m.stats)) out.stats[s] = v * k;
  }
  if (m.abilities) {
    out.abilities = {};
    for (const [a, v] of Object.entries(m.abilities)) out.abilities[a] = v * k;
  }
  return out;
}

export class EffectStore {
  private _active: Map<string, EffectInstance> = new Map();

  apply(def: EffectDef, now: number): EffectInstance {
    const policy: StackingPolicy = def.stacking ?? "replace";
    const existing = this._active.get(def.id);
    if (!existing) {
      const inst = { id: def.id, def, startTime: now, count: 1 };
      this._active.set(def.id, inst);
      return inst;
    }
    switch (policy) {
      case "replace":
        existing.startTime = now;
        existing.count = 1;
        existing.def = def;
        return existing;
      case "extend":
        // Push end time out by adding base duration onto the start time.
        if (def.duration != null && def.duration > 0) {
          existing.startTime = Math.max(existing.startTime, now - 0) + def.duration;
          existing.startTime = now - Math.max(0, now - existing.startTime);
        }
        return existing;
      case "stack":
        existing.count += 1;
        existing.startTime = now;
        return existing;
      case "highest": {
        const aMag = magnitudeMagnitude(existing.def, now - existing.startTime);
        const bMag = magnitudeMagnitude(def, 0);
        if (bMag > aMag) {
          existing.def = def;
          existing.startTime = now;
          existing.count = 1;
        }
        return existing;
      }
    }
  }

  remove(id: string): boolean {
    return this._active.delete(id);
  }

  dispelByTag(tag: string): EffectInstance[] {
    const out: EffectInstance[] = [];
    for (const inst of [...this._active.values()]) {
      if (inst.def.dispelTags?.includes(tag)) {
        out.push(inst);
        this._active.delete(inst.id);
      }
    }
    return out;
  }

  active(): EffectInstance[] {
    return [...this._active.values()];
  }

  magnitudesFor(id: string, now: number): EffectMagnitudes | null {
    const inst = this._active.get(id);
    if (!inst) return null;
    return instanceMagnitudes(inst, now);
  }

  totalMagnitudes(now: number): EffectMagnitudes {
    let total: EffectMagnitudes = {};
    for (const inst of this._active.values()) total = mergeMag(total, instanceMagnitudes(inst, now));
    return total;
  }

  tick(now: number): EffectInstance[] {
    const expired: EffectInstance[] = [];
    for (const inst of [...this._active.values()]) {
      const dur = inst.def.duration;
      if (dur == null) continue;
      if (now - inst.startTime >= dur) {
        expired.push(inst);
        this._active.delete(inst.id);
      }
    }
    return expired;
  }
}

function instanceMagnitudes(inst: EffectInstance, now: number): EffectMagnitudes {
  const elapsed = Math.max(0, now - inst.startTime);
  const dur = inst.def.duration;
  const frac = dur && dur > 0 ? Math.min(elapsed / dur, 1) : 0;
  let mag: EffectMagnitudes = inst.def.baseMagnitudes ? { ...inst.def.baseMagnitudes } : {};
  if (inst.def.trajectory) mag = mergeMag(mag, inst.def.trajectory(frac, elapsed));
  if (inst.count !== 1) mag = scaleMag(mag, inst.count);
  return mag;
}

/** Crude scalar for "highest"-policy comparison: sum of |stat| + |ability| contributions. */
function magnitudeMagnitude(def: EffectDef, elapsed: number): number {
  let mag = def.baseMagnitudes ?? {};
  if (def.trajectory) {
    const dur = def.duration && def.duration > 0 ? def.duration : 1;
    mag = mergeMag(mag, def.trajectory(Math.min(elapsed / dur, 1), elapsed));
  }
  let s = 0;
  for (const v of Object.values(mag.stats ?? {})) s += Math.abs(v);
  for (const v of Object.values(mag.abilities ?? {})) s += Math.abs(v);
  return s;
}
