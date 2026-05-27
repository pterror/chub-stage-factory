/*
 * equipment.ts — equipment defs + a Loadout that equips them onto a Body.
 *
 * WHAT: An EquipmentDef declares which slot it occupies, the tag constraints
 *       on that slot, what tags it grants while equipped, and what to do when
 *       the body changes such that constraints no longer hold. A Loadout owns
 *       the equipped instances and exposes equip/unequip/check/resolve.
 *       Phase 6 adds an acquisition-time snapshot of body tags so `fit()`
 *       returns "comfortable" | "tight" | "rides_up" | "too_loose" | "broken"
 *       based on the diff between equip-time and now.
 *
 * WHY: Rule #2 (def/instance), #3 (detect-vs-resolve — `checkAll` returns
 *      violations as data, `resolveViolations` is just one default policy
 *      composing them with on-conflict actions).
 *
 * SHAPE:
 *   type OnConflict = "unequip" | "degrade" | "adapt" | "destroy" | "prompt" | "custom"
 *   interface EquipmentDef {
 *     id, slot, constraints (tag query terms), onConflict, degradePenalties?,
 *     adaptAlternatives? (alt constraint arrays), grantsTags?, displayName?, description?
 *   }
 *   interface EquipmentInstance { def, equippedAt, snapshotTags: string[] }
 *   interface FitReport { fit, degradedTerms: string[] }
 *   canEquip(def, body): { ok: true } | { ok: false, reason, detail? }
 *   checkConstraints(def, body): null | Violation | { adapted, alternative }
 *   class Loadout
 *     constructor(body)
 *     equip(def, now): { ok: true, slot } | { ok: false, ... }
 *     unequip(slot): EquipmentInstance | null
 *     getEquipped(slot), getAllEquipped()
 *     checkAllConstraints(): Violation[]
 *     resolveViolations(): { unequipped, degraded, adapted, destroyed, prompted, custom }
 *     fit(slot, now): FitReport | null     // phase 6
 *     toJSON(): { equipped: Record<slot, { defId, equippedAt, snapshotTags }> }
 *     static fromJSON(data, body, defs): Loadout
 */

import { Body } from "./body";
import { Violation, check } from "./constraints";

export type OnConflict =
  | "unequip"
  | "degrade"
  | "adapt"
  | "destroy"
  | "prompt"
  | "custom";

export interface EquipmentDef {
  id: string;
  slot: string;
  /** Tag query terms (e.g. ["hand", "!clawed"]). */
  constraints: string[];
  onConflict: OnConflict;
  /** For "degrade" strategy: penalties to apply (stage interprets shape). */
  degradePenalties?: Record<string, number>;
  /** For "adapt": alternative tag-query arrays that also pass. */
  adaptAlternatives?: string[][];
  /** Tags this equipment grants to the slot while equipped (stage may merge them). */
  grantsTags?: string[];
  displayName?: string;
  description?: string;
}

export interface EquipmentInstance {
  def: EquipmentDef;
  /** Absolute time the item was equipped. */
  equippedAt: number;
  /** Snapshot of the slot's effective tags at the moment of equip (phase 6). */
  snapshotTags: string[];
}

export type FitKind =
  | "comfortable"
  | "tight"
  | "rides_up"
  | "too_loose"
  | "broken";

export interface FitReport {
  fit: FitKind;
  /** Constraint terms that no longer hold against the current effective tags. */
  failedTerms: string[];
  /** Tags added since equip-time. */
  added: string[];
  /** Tags removed since equip-time. */
  removed: string[];
}

export type CanEquip =
  | { ok: true }
  | { ok: false; reason: "slot_missing"; detail: string }
  | { ok: false; reason: "constraints"; detail: string[] };

function failedTerms(def: EquipmentDef, body: Body): string[] {
  const eff = body.getEffectiveTags(def.slot);
  const failed: string[] = [];
  for (const term of def.constraints) if (!eff.matchesTerm(term)) failed.push(term);
  return failed;
}

export function canEquip(def: EquipmentDef, body: Body): CanEquip {
  if (!body.hasSlot(def.slot)) return { ok: false, reason: "slot_missing", detail: def.slot };
  const failed = failedTerms(def, body);
  if (failed.length === 0) return { ok: true };
  return { ok: false, reason: "constraints", detail: failed };
}

export type ConstraintReport =
  | null
  | { adapted: true; alternative: string[] }
  | Violation;

export function checkConstraints(def: EquipmentDef, body: Body): ConstraintReport {
  const eff = body.getEffectiveTags(def.slot);
  if (eff.matches(def.constraints)) return null;
  for (const alt of def.adaptAlternatives ?? []) {
    if (eff.matches(alt)) return { adapted: true, alternative: alt };
  }
  return check(def.id, def.constraints, eff, { slot: def.slot, onConflict: def.onConflict })!;
}

/**
 * Phase 6 fit classifier.
 *
 * Compares the slot's effective tags now against the snapshot taken at equip time.
 * - Any unmet constraint terms → "broken" (if degrade penalties absent) or "tight"
 *   (the canonical "doesn't fit anymore" state).
 * - Tags added since equip (and the constraints still hold) → "tight".
 * - Tags removed since equip (constraints hold) → "too_loose".
 * - Both added and removed → "rides_up" (shape changed under the garment).
 * - Otherwise "comfortable".
 *
 * The mapping is intentionally simple; stages can compute their own from
 * the same diff if they want richer vocabulary.
 */
export function fit(inst: EquipmentInstance, body: Body): FitReport {
  const eff = body.getEffectiveTags(inst.def.slot);
  const nowTags = new Set(eff.toArray());
  const thenTags = new Set(inst.snapshotTags);
  const added: string[] = [];
  const removed: string[] = [];
  for (const t of nowTags) if (!thenTags.has(t)) added.push(t);
  for (const t of thenTags) if (!nowTags.has(t)) removed.push(t);
  const failed = failedTerms(inst.def, body);

  let kind: FitKind;
  if (failed.length > 0) {
    kind = inst.def.degradePenalties ? "tight" : "broken";
  } else if (added.length > 0 && removed.length > 0) kind = "rides_up";
  else if (added.length > 0) kind = "tight";
  else if (removed.length > 0) kind = "too_loose";
  else kind = "comfortable";

  return { fit: kind, failedTerms: failed, added, removed };
}

export interface ResolveResult {
  unequipped: string[];
  degraded: Record<string, Record<string, number>>;
  adapted: string[];
  destroyed: string[];
  prompted: Violation[];
  custom: Violation[];
}

export class Loadout {
  private _equipped: Map<string, EquipmentInstance> = new Map();
  constructor(private _body: Body) {}

  equip(
    def: EquipmentDef,
    now: number,
  ): { ok: true; slot: string } | { ok: false; reason: string; detail?: unknown } {
    const c = canEquip(def, this._body);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!c.ok) return { ok: false, reason: c.reason, detail: (c as any).detail };
    if (this._equipped.has(def.slot)) this.unequip(def.slot);
    const snapshotTags = this._body.getEffectiveTags(def.slot).toArray();
    this._equipped.set(def.slot, { def, equippedAt: now, snapshotTags });
    return { ok: true, slot: def.slot };
  }

  unequip(slot: string): EquipmentInstance | null {
    const inst = this._equipped.get(slot);
    if (!inst) return null;
    this._equipped.delete(slot);
    return inst;
  }

  getEquipped(slot: string): EquipmentInstance | undefined {
    return this._equipped.get(slot);
  }

  getAllEquipped(): Map<string, EquipmentInstance> {
    return new Map(this._equipped);
  }

  checkAllConstraints(): Violation[] {
    const out: Violation[] = [];
    for (const inst of this._equipped.values()) {
      const r = checkConstraints(inst.def, this._body);
      if (r && !("adapted" in r)) out.push(r);
    }
    return out;
  }

  fit(slot: string, _now?: number): FitReport | null {
    const inst = this._equipped.get(slot);
    if (!inst) return null;
    return fit(inst, this._body);
  }

  /**
   * Serialize equipped instances. Def objects (functions) are not serialized;
   * only the def id is stored. `fromJSON` requires the caller to supply the
   * def catalog.
   */
  toJSON(): {
    equipped: Record<string, { defId: string; equippedAt: number; snapshotTags: string[] }>;
  } {
    const equipped: Record<string, { defId: string; equippedAt: number; snapshotTags: string[] }> = {};
    for (const [slot, inst] of this._equipped) {
      equipped[slot] = { defId: inst.def.id, equippedAt: inst.equippedAt, snapshotTags: [...inst.snapshotTags] };
    }
    return { equipped };
  }

  static fromJSON(
    data: { equipped: Record<string, { defId: string; equippedAt: number; snapshotTags: string[] }> },
    body: Body,
    defs: Record<string, EquipmentDef>,
  ): Loadout {
    const l = new Loadout(body);
    for (const [slot, snap] of Object.entries(data.equipped)) {
      const def = defs[snap.defId];
      if (!def) continue;
      l._equipped.set(slot, { def, equippedAt: snap.equippedAt, snapshotTags: [...snap.snapshotTags] });
    }
    return l;
  }

  resolveViolations(): ResolveResult {
    const result: ResolveResult = {
      unequipped: [],
      degraded: {},
      adapted: [],
      destroyed: [],
      prompted: [],
      custom: [],
    };
    for (const inst of [...this._equipped.values()]) {
      const r = checkConstraints(inst.def, this._body);
      if (!r) continue;
      if ("adapted" in r) {
        result.adapted.push(inst.def.id);
        continue;
      }
      const policy = inst.def.onConflict;
      switch (policy) {
        case "unequip":
          this.unequip(inst.def.slot);
          result.unequipped.push(inst.def.id);
          break;
        case "degrade":
          result.degraded[inst.def.id] = { ...(inst.def.degradePenalties ?? {}) };
          break;
        case "destroy":
          this.unequip(inst.def.slot);
          result.destroyed.push(inst.def.id);
          break;
        case "prompt":
          result.prompted.push(r);
          break;
        case "custom":
          result.custom.push(r);
          break;
        default:
          this.unequip(inst.def.slot);
          result.unequipped.push(inst.def.id);
      }
    }
    return result;
  }
}

export function fromDict(data: Partial<EquipmentDef> & { id: string; slot: string }): EquipmentDef {
  return {
    id: data.id,
    slot: data.slot,
    constraints: data.constraints ?? [],
    onConflict: data.onConflict ?? "unequip",
    degradePenalties: data.degradePenalties ?? {},
    adaptAlternatives: data.adaptAlternatives ?? [],
    grantsTags: data.grantsTags ?? [],
    displayName: data.displayName ?? data.id,
    description: data.description ?? "",
  };
}
