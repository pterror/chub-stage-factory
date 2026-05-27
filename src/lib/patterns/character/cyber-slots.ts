/*
 * patterns/cyber-slots.ts — Body + Loadout + Transformation + Observation composer.
 *
 * WHAT: `cyberSlotsPattern(init)` wires a `Body` with a `Loadout` (equipment
 *       + constraints) and an optional `Registry<TransformationDef>` for
 *       body-mod TFs. Returns a bundle with:
 *         - `body` — the `Body` instance.
 *         - `loadout` — the `Loadout` instance.
 *         - `tfs` — the `Registry<TransformationDef>` (pass-through).
 *         - `mods` — the `Registry<EquipmentDef>` (pass-through).
 *         - `applyTf(id, now)` — look up the TF and apply it to `body`.
 *         - `equip(id, now)` — look up the def and call `loadout.equip`.
 *         - `unequip(slot)` — call `loadout.unequip`.
 *         - `violations(now)` — `loadout.checkAllConstraints()`.
 *         - `observationSources(now)` — body-tags + equipped mods +
 *           violations observation sources.
 *
 * WHY: `cyber-slots/Stage.tsx` manually assembled body + loadout + TFs +
 *      observation in the stage constructor and `afterResponse`. Every
 *      ripperdoc-style stage repeats the same wiring; the only stage-specific
 *      bits are the mod/TF registries and the slot initialisation. This
 *      composer collapses the scaffold while leaving data entirely in the
 *      caller's control.
 *
 *      No new mechanics. No private state. The underlying primitives are
 *      directly accessible on the returned bundle.
 *
 * SHAPE:
 *   interface CyberSlotsInit
 *     { slots: Record<string, string[]>;
 *       mods: Registry<EquipmentDef>;
 *       tfs: Registry<TransformationDef>; }
 *   interface CyberSlotsBundle
 *     { body; loadout; mods; tfs;
 *       applyTf(id, now): void;
 *       equip(id, now): EquipResult;
 *       unequip(slot): void;
 *       violations(now): ConstraintViolation[];
 *       observationSources(now): ObservationSource<{ now: number }>[]; }
 *   function cyberSlotsPattern(init): CyberSlotsBundle
 */

import { Body } from "../body";
import { apply as applyTfFn, type TransformationDef } from "../transformation";
import { type EquipmentDef, Loadout } from "../equipment";
import type { Registry } from "../registry";
import type { ObservationSource } from "../observation";

export interface CyberSlotsInit {
  /** Initial body slot tags: `{ head: ["flesh-only"], torso: ["flesh-only"] }`. */
  slots: Record<string, string[]>;
  /** Equipment registry — defines available cyberware mods. */
  mods: Registry<EquipmentDef>;
  /** Transformation registry — defines surgical body-mod TFs. */
  tfs: Registry<TransformationDef>;
}

export interface CyberSlotsBundle {
  body: Body;
  loadout: Loadout;
  mods: Registry<EquipmentDef>;
  tfs: Registry<TransformationDef>;
  /** Look up TF by id and apply it to body. No-ops if id is unknown. */
  applyTf(id: string, now: number): void;
  /** Look up mod by id and equip it. Returns the loadout equip result. */
  equip(id: string, now: number): ReturnType<Loadout["equip"]>;
  /** Unequip whatever is in a slot. */
  unequip(slot: string): void;
  /** Current constraint violations across all equipped mods. */
  violations(now: number): ReturnType<Loadout["checkAllConstraints"]>;
  /** Default observation sources for body-tags, equipped mods, violations. */
  observationSources(now: number): ObservationSource<{ now: number }>[];
}

export function cyberSlotsPattern(init: CyberSlotsInit): CyberSlotsBundle {
  const body = new Body(init.slots);
  const loadout = new Loadout(body);

  const applyTf = (id: string, now: number): void => {
    const def = init.tfs.get(id);
    if (def) applyTfFn(def, body, now);
  };

  const equip = (id: string, now: number): ReturnType<Loadout["equip"]> => {
    const def = init.mods.require(id);
    return loadout.equip(def, now);
  };

  const unequip = (slot: string): void => {
    loadout.unequip(slot);
  };

  const violations = (_now: number) => loadout.checkAllConstraints();

  const observationSources = (now: number): ObservationSource<{ now: number }>[] => [
    {
      id: "body-tags",
      channels: ["visual"],
      salience: () => 0.5,
      habituationTau: 4,
      properties: {
        visual: {
          slots: () => {
            const out: Record<string, string[]> = {};
            for (const [s, t] of body.getAllEffectiveTags()) out[s] = t.toArray();
            return out;
          },
        },
      },
    },
    {
      id: "equipped",
      channels: ["visual"],
      salience: () => Math.min(1, loadout.getAllEquipped().size / 2),
      habituationTau: 6,
      properties: {
        visual: {
          mods: () => {
            const out: Record<string, { id: string; fit: string; failed: string[] }> = {};
            for (const [slot, inst] of loadout.getAllEquipped()) {
              const f = loadout.fit(slot, now)!;
              out[slot] = { id: inst.def.id, fit: f.fit, failed: f.failedTerms };
            }
            return out;
          },
          available: () =>
            init.mods.entries().map(([id, def]) => ({
              id,
              slot: def.slot,
              constraints: def.constraints,
            })),
        },
      },
    },
    {
      id: "violations",
      channels: ["interoceptive"],
      salience: () => (loadout.checkAllConstraints().length > 0 ? 1 : 0),
      habituationTau: 0,
      properties: {
        interoceptive: { current: () => loadout.checkAllConstraints() },
      },
    },
  ];

  return { body, loadout, mods: init.mods, tfs: init.tfs, applyTf, equip, unequip, violations, observationSources };
}
