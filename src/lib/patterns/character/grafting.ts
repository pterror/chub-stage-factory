/*
 * patterns/grafting.ts — Helminth-style ability/feature transfer with provenance
 *                         (Wave 2D). Design: src/lib/design/GRAFTING.md.
 *
 * WHAT: `graftingPattern(opts)` provides the Warframe Helminth mechanic:
 *   - `subsume(formId, library)` — permanently add a form's ability to the
 *     learned library (irreversible, chatState-permanent).
 *   - `inject(req)` / `replace(req)` — inject a learned ability into a target
 *     form's config slot; branches independently per config (messageState).
 *   - `listLearned()` / `listInjected(formId)` — inspection surfaces.
 *
 *       Provenance (InjectionRecord) is tracked on every inject. Stage authors
 *       can extend provenance via the `provenanceTracking` knob.
 *
 * WHY: Warframe-shape (#9) — collect frames, mod them, graft abilities across
 *      forms. The GRAFTING.md design spec is implementation-ready; this file
 *      is the assembly. No new primitives; composes Registry + PlaceholderRegistry.
 *
 * SHAPE: see src/lib/design/GRAFTING.md for the full type listing.
 *   function graftingPattern(opts: GraftingOptions): GraftingBundle
 */

import { Registry, PlaceholderRegistry } from "../registry";
import type { Form } from "./form";

// ─── Public types ───────────────────────────────────────────────────────────

export type AbilityId = string;
export type FormId = string;

export interface AbilityDef {
  id: AbilityId;
  name: string;
  /** Which form contributes this ability to the library when subsumed. */
  nativeFormId: FormId;
  /** Helminth-tuned override fields (weaker version injected into other forms). */
  helminthOverride?: Partial<AbilityDef>;
  scalingRule: AbilityScalingPolicy;
  tags?: string[];
}

export type AbilityScalingPolicy =
  | "casting-form"
  | "source-form"
  | { custom: (castingForm: Form, def: AbilityDef) => AbilityDef };

/** One config loadout slot on a form; holds an optional injected ability. */
export interface FormConfig {
  slot: number;
  injectedAbility: AbilityId | null;
  injectedSlot: number | null;
  provenance: InjectionRecord | null;
  /** The helminth-versioned ability def as it will fire (post helminthVersion transform). */
  effectiveDef: AbilityDef | null;
}

export interface InjectionRecord {
  sourceFormId: FormId;
  abilityId: AbilityId;
  injectedAt: number;
  extra?: Record<string, unknown>;
}

export interface SubsumeRequest {
  sourceFormId: FormId;
  abilityId: AbilityId;
  targetFormId: FormId;
  /** Which config (0-indexed) to inject into. */
  configSlot: number;
  /** Which ability slot on the form (typically 0, 1, or 2). */
  abilitySlot: number;
}

export type ProvenanceExtender = (
  base: InjectionRecord,
  req: SubsumeRequest,
) => InjectionRecord;

export interface InvigorationsConfig {
  buffPool: AbilityDef[];
  /** Max simultaneous active invigorations per form. Default: 1. */
  maxActive?: number;
}

export type ResourceCost = { kind: string; amount: number };

// ─── Options ─────────────────────────────────────────────────────────────────

export interface GraftingOptions {
  /** Form catalog. Provided by formCollectionPattern. */
  forms: PlaceholderRegistry<Form>;
  /** Helminth learned-ability library. Grows via subsume. */
  learnedLibrary: Registry<AbilityDef>;
  /** Cost to subsume a form. Default: null (free). */
  subsumableCost?: ResourceCost | null;
  /** If true, removes sourceFormId from forms on subsume. Default: false. */
  consumeOnSubsume?: boolean;
  /**
   * Tuned-down transform applied to an ability when it is injected via
   * Helminth. Default: identity (no change).
   */
  helminthVersion?: (def: AbilityDef) => AbilityDef;
  abilityScaling?: AbilityScalingPolicy;
  /** If true, the last config slot (maxConfigSlots-1) is locked. Default: true. */
  slot4Lock?: boolean;
  invigorations?: InvigorationsConfig | null;
  provenanceTracking?: ProvenanceExtender | null;
  /** Number of config (loadout) slots per form. Default: 3. */
  maxConfigSlots?: number;
}

// ─── Bundle ───────────────────────────────────────────────────────────────────

export interface GraftingBundle {
  hooks: {
    /**
     * Permanently add a form's ability to the learned library.
     * If `consumeOnSubsume` is true, removes the form from the registry.
     * Returns the InjectionRecord for the learn event.
     */
    subsume(formId: FormId, abilityId: AbilityId): InjectionRecord;
    /**
     * Inject a learned ability into a target form's config slot.
     * Equivalent to `replace` when the slot is already occupied.
     */
    inject(req: SubsumeRequest): FormConfig;
    /**
     * Replace the ability in a target form's config slot.
     * Slot-4 lock is enforced: `configSlot !== maxConfigSlots - 1`.
     */
    replace(req: SubsumeRequest): FormConfig;
    /** All abilities in the learned library. */
    listLearned(): AbilityDef[];
    /** All config slots for a form across all config indices. */
    listInjected(formId: FormId): FormConfig[];
  };
}

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Key format for per-form per-config injection state.
 * `${formId}::${configSlot}::${abilitySlot}`
 */
function injectionKey(formId: FormId, configSlot: number, abilitySlot: number): string {
  return `${formId}::${configSlot}::${abilitySlot}`;
}

export function graftingPattern(opts: GraftingOptions): GraftingBundle {
  const maxConfigSlots = opts.maxConfigSlots ?? 3;
  const slot4Lock = opts.slot4Lock ?? true;
  const helminthVersion = opts.helminthVersion ?? ((d: AbilityDef) => d);
  const consumeOnSubsume = opts.consumeOnSubsume ?? false;
  const provenanceTracking = opts.provenanceTracking ?? null;

  /**
   * Per-form injection state: maps injectionKey → FormConfig.
   * Not persisted by the pattern itself — the stage wires this into a Shard
   * if durable persistence is needed (see GRAFTING.md §Shard Composition).
   */
  const injections = new Map<string, FormConfig>();

  function canReplace(configSlot: number): boolean {
    return !slot4Lock || configSlot !== maxConfigSlots - 1;
  }

  function buildRecord(req: SubsumeRequest, extra?: Record<string, unknown>): InjectionRecord {
    const base: InjectionRecord = {
      sourceFormId: req.sourceFormId,
      abilityId: req.abilityId,
      injectedAt: Date.now(),
    };
    if (extra) base.extra = extra;
    const extended = provenanceTracking ? provenanceTracking(base, req) : base;
    return extended;
  }

  function doInject(req: SubsumeRequest): FormConfig {
    if (!canReplace(req.configSlot)) {
      throw new Error(
        `graftingPattern: config slot ${req.configSlot} is locked (slot-4 lock). ` +
          `Set slot4Lock: false to allow replacement of the ultimate slot.`,
      );
    }
    const abilityDef = opts.learnedLibrary.get(req.abilityId);
    if (!abilityDef) {
      throw new Error(
        `graftingPattern: ability "${req.abilityId}" not found in learned library. ` +
          `Subsume the source form first.`,
      );
    }
    const helminthed = helminthVersion(abilityDef);
    const record = buildRecord(req);
    const config: FormConfig = {
      slot: req.configSlot,
      injectedAbility: req.abilityId,
      injectedSlot: req.abilitySlot,
      provenance: record,
      effectiveDef: helminthed,
    };

    const key = injectionKey(req.targetFormId, req.configSlot, req.abilitySlot);
    injections.set(key, config);
    return config;
  }

  return {
    hooks: {
      subsume(formId: FormId, abilityId: AbilityId): InjectionRecord {
        if (!opts.forms.has(formId) || opts.forms.isPlaceholder(formId)) {
          throw new Error(
            `graftingPattern: form "${formId}" not found or still locked.`,
          );
        }
        // Permanently record in learned library.
        const abilityDef = opts.learnedLibrary.get(abilityId);
        if (!abilityDef) {
          throw new Error(
            `graftingPattern: ability "${abilityId}" not in learnedLibrary.`,
          );
        }
        // Mark as subsumed — noop if already present (subsume is idempotent).
        opts.learnedLibrary.register(abilityId, abilityDef);

        if (consumeOnSubsume) opts.forms.delete(formId);

        const record: InjectionRecord = {
          sourceFormId: formId,
          abilityId,
          injectedAt: Date.now(),
        };
        return record;
      },

      inject(req: SubsumeRequest): FormConfig {
        return doInject(req);
      },

      replace(req: SubsumeRequest): FormConfig {
        return doInject(req);
      },

      listLearned(): AbilityDef[] {
        return opts.learnedLibrary.values();
      },

      listInjected(formId: FormId): FormConfig[] {
        const out: FormConfig[] = [];
        for (const [key, cfg] of injections) {
          if (key.startsWith(`${formId}::`)) out.push(cfg);
        }
        return out;
      },
    },
  };
}
