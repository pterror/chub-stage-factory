/*
 * stats.ts — quantitative stats with stacking modifiers + tier functions.
 *
 * WHAT: A Stat has a `base` number, a list of Modifier entries, and a TierFn.
 *       Modifiers stack in declared order with three kinds: "flat" (added),
 *       "mult" (multiplied), "add" (added after mult). `effective()`
 *       recomputes every call. `tier()` returns the qualitative label.
 *       Phase 6 adds an asymmetric habituation modifier kind: it leaks toward
 *       a setpoint at different rates depending on whether the value is above
 *       or below; useful for mood-style stats that recover slowly from pain
 *       but normalize fast from pleasure (or vice versa).
 *
 * WHY: Rule #4 (pure calculator + mutable holder), #8 (tier over threshold).
 *
 * SHAPE:
 *   type ModifierKind = "flat" | "mult" | "add" | "habituation"
 *   interface Modifier {
 *     id?, kind, value, source?,
 *     // habituation extras:
 *     setpoint?, leakUp?, leakDown?, lastAppliedAt?
 *   }
 *   type TierFn<T = string> = (value: number) => T
 *   class Stat<T = string>
 *     constructor({ base, tiers?: TierFn<T>, modifiers?: Modifier[] })
 *     base: number  (mutable)
 *     addModifier(m), removeModifier(id), clearModifiers()
 *     getModifiers(): readonly Modifier[]
 *     effective(now?): number
 *     tier(now?): T | null
 *     tick(now): void   // updates habituation modifiers in place
 *     toJSON()
 *   thresholdTiers([{below, label}, ...], fallback): TierFn
 */

export type ModifierKind = "flat" | "mult" | "add" | "habituation";

export interface Modifier {
  id?: string;
  kind: ModifierKind;
  value: number;
  source?: string;
  // habituation extras
  setpoint?: number;
  /** Per-unit-time leak rate when value > setpoint. */
  leakUp?: number;
  /** Per-unit-time leak rate when value < setpoint. */
  leakDown?: number;
  /** Last absolute time this habituation modifier was ticked. */
  lastAppliedAt?: number;
}

export type TierFn<T = string> = (value: number) => T;

export function thresholdTiers<T extends string = string>(
  bands: { below: number; label: T }[],
  fallback: T,
): TierFn<T> {
  const sorted = [...bands].sort((a, b) => a.below - b.below);
  return (v: number) => {
    for (const b of sorted) if (v < b.below) return b.label;
    return fallback;
  };
}

export interface StatInit<T = string> {
  base: number;
  tiers?: TierFn<T>;
  modifiers?: Modifier[];
}

export class Stat<T = string> {
  base: number;
  private _modifiers: Modifier[];
  tiers?: TierFn<T>;

  constructor(init: StatInit<T>) {
    this.base = init.base;
    this.tiers = init.tiers;
    this._modifiers = (init.modifiers ?? []).map((m) => ({ ...m }));
  }

  addModifier(m: Modifier): Stat<T> {
    if (m.id) this.removeModifier(m.id);
    this._modifiers.push({ ...m });
    return this;
  }

  removeModifier(id: string): boolean {
    const before = this._modifiers.length;
    this._modifiers = this._modifiers.filter((m) => m.id !== id);
    return this._modifiers.length !== before;
  }

  clearModifiers(): void {
    this._modifiers = [];
  }

  getModifiers(): readonly Modifier[] {
    return this._modifiers;
  }

  /** Recompute effective in modifier order; habituation modifiers contribute their current value. */
  effective(_now?: number): number {
    let v = this.base;
    for (const m of this._modifiers) {
      switch (m.kind) {
        case "flat":
          v += m.value;
          break;
        case "mult":
          v *= m.value;
          break;
        case "add":
          v += m.value;
          break;
        case "habituation":
          v += m.value;
          break;
      }
    }
    return v;
  }

  tier(now?: number): T | null {
    return this.tiers ? this.tiers(this.effective(now)) : null;
  }

  /**
   * Tick habituation modifiers toward their setpoints using asymmetric
   * leakUp / leakDown rates. Other modifier kinds are inert under tick.
   */
  tick(now: number): void {
    for (const m of this._modifiers) {
      if (m.kind !== "habituation") continue;
      const setpoint = m.setpoint ?? 0;
      const last = m.lastAppliedAt ?? now;
      const dt = Math.max(0, now - last);
      m.lastAppliedAt = now;
      if (dt === 0) continue;
      const above = m.value > setpoint;
      const rate = above ? m.leakUp ?? 0 : m.leakDown ?? 0;
      if (rate <= 0) continue;
      const step = rate * dt;
      if (above) m.value = Math.max(setpoint, m.value - step);
      else m.value = Math.min(setpoint, m.value + step);
    }
  }

  toJSON(): { base: number; modifiers: Modifier[] } {
    return { base: this.base, modifiers: this._modifiers.map((m) => ({ ...m })) };
  }
}
