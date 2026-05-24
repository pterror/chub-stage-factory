# Wave 2D GRAFTING design
> Synthesized 2026-05-24 from src/lib/mining/GRAFTING.md + ROADMAP Wave 2D spec.
> Implementation-ready: concrete pattern API, default contract enforced, knobs typed.
---

## Pattern API

```ts
// src/lib/patterns/grafting.ts
function graftingPattern(opts: GraftingOptions): ComposedSubsystem
```

`ComposedSubsystem` per COMPOSITION.md: `{ shards, hooks, observations }`. No private state; internals are `Registry` + `PersistenceStore` shards.

```ts
interface GraftingOptions {
  // Required
  forms: PlaceholderRegistry<Form>;              // form catalog (Wave 2D form-collection)
  learnedLibrary: Registry<AbilityId, AbilityDef>;

  // Knobs — all optional, see Knobs section for defaults
  subsumableCost?: ResourceCost | null;          // default: null (free)
  subsumeCooldown?: number | null;               // ms; default: null
  consumeOnSubsume?: boolean;                    // default: false
  helminthVersion?: (def: AbilityDef) => AbilityDef;  // default: identity
  abilityScaling?: AbilityScalingPolicy;         // default: "casting-form"
  slot4Lock?: boolean;                           // default: true
  invigorations?: InvigorationsConfig | null;    // default: null (disabled)
  provenanceTracking?: ProvenanceExtender | null; // default: null
  maxConfigSlots?: number;                       // default: 3
  learnedLibraryPersistence?: "chatState" | "messageState"; // default: "chatState"
}

interface ComposedSubsystem {
  shards: Shard[];
  hooks: {
    subsume(formId: FormId, targetLibrary: Registry<AbilityId, AbilityDef>): InjectionRecord;
    inject(req: SubsumeRequest): void;
    replace(req: SubsumeRequest): void;
    listLearned(): AbilityDef[];
    listInjected(formId: FormId): FormConfig[];
  };
  observations: ContextContributor[];  // Wave 2I — library + active injection summary
}
```

## Type Definitions

```ts
type AbilityId = string;
type FormId = string;

// Cross-reference: Form is defined in src/lib/patterns/form.ts (Wave 2D)
// A Form is Body + Stats + ActionDef set + aesthetics + lore; imported here.

interface AbilityDef {
  id: AbilityId;
  name: string;
  nativeFormId: FormId;           // which form contributes this to Helminth
  helminthOverride?: Partial<AbilityDef>; // tuned-down helminth-version fields
  scalingRule: AbilityScalingPolicy;
  tags?: string[];
}

type AbilityScalingPolicy =
  | "casting-form"                // mods/stats from the host form (Warframe default)
  | "source-form"                 // locked to original form's base stats
  | { custom: (castingForm: Form, def: AbilityDef) => AbilityDef };

// One of up to maxConfigSlots per form; holds one injected ability or none.
interface FormConfig {
  slot: number;                   // 0-indexed; slot === maxConfigSlots-1 locked by default
  injectedAbility: AbilityId | null;
  injectedSlot: number | null;    // which ability slot on the form (0-2 by default)
  provenance: InjectionRecord | null;
}

interface InjectionRecord {
  sourceFormId: FormId;
  abilityId: AbilityId;
  injectedAt: number;             // Date.now() timestamp
  extra?: Record<string, unknown>; // provenanceTracking extension point
}

type LearnedLibrary = Registry<AbilityId, AbilityDef>;

interface SubsumeRequest {
  sourceFormId: FormId;      // form being subsumed (must be in forms registry)
  abilityId: AbilityId;      // must be in learnedLibrary
  targetFormId: FormId;      // form receiving the injection
  configSlot: number;        // which Config (0, 1, 2 by default)
  abilitySlot: number;       // which ability slot on the form (0, 1, 2; not slot4)
}

interface InvigorationsConfig {
  buffPool: EffectDef[];
  weeklyScheduler: Scheduler<unknown>;
  maxActive?: number;        // default: 1 per form at a time
}

type ResourceCost = { kind: string; amount: number };
type ProvenanceExtender = (base: InjectionRecord, req: SubsumeRequest) => InjectionRecord;
```

## Invariants Enforced by Default

All three are enforced in `inject` and `replace` before any mutation:

1. **Slot-4 lock.** `canReplace(slotIndex) = slotIndex !== maxConfigSlots - 1` (0-indexed; overridable via `slot4Lock: false`).
2. **One injected ability per config.** Injecting into a config slot that already holds an ability overwrites it — no accumulation. `replace` is idiomatic; `inject` calls `replace` internally if the slot is occupied.
3. **Config-independent.** Each of the `maxConfigSlots` config slots carries its own `FormConfig`; changing Config A never touches Config B.
4. **Provenance tracked.** Every successful inject records `InjectionRecord` on the `FormConfig`. Stage-author can extend via `provenanceTracking` knob.
5. **Learned library is permanent by default.** Shard uses `chatState + forbidBranching`; subsuming a form is irreversible unless `learnedLibraryPersistence: "messageState"` is set.
6. **Per-form injection is replaceable.** The injection shard uses `messageState + chubTreeHistory`; branches can explore different injections independently.

## Shard Composition

Matches the mining recommendation exactly:

| Shard | Backend | History | Rationale |
|---|---|---|---|
| `helminth-library` | `chatState` | `forbidBranching` | Permanent — subsuming a form is a one-way biological act |
| `form-injections` | `messageState` | `chubTreeHistory` | Per-branch — player can explore different injections per branch |
| `invigoration-state` (if enabled) | `chatState` | `forbidBranching` | Weekly ticks; buff history is canon |

`PersistenceStore` holds all three; `store.commit()` / `store.load()` cover the full cycle.

## Knobs

| Knob | Type | Default | What overriding changes |
|---|---|---|---|
| `subsumableCost` | `ResourceCost \| null` | `null` (free) | Requires a resource deduction before subsume proceeds |
| `subsumeCooldown` | `number \| null` | `null` | Schedules a Scheduler event blocking next subsume |
| `consumeOnSubsume` | `boolean` | `false` | If `true`, removes `sourceFormId` from `forms` on subsume |
| `helminthVersion` | `(AbilityDef) => AbilityDef` | identity | Applies the tuned-down helminth transform to each injected ability |
| `abilityScaling` | `AbilityScalingPolicy` | `"casting-form"` | Determines which form's stats/mods apply when the ability fires |
| `slot4Lock` | `boolean` | `true` | If `false`, the ultimate ability slot becomes replaceable |
| `invigorations` | `InvigorationsConfig \| null` | `null` | Enables the weekly random-buff track per form |
| `provenanceTracking` | `ProvenanceExtender \| null` | `null` | Extends `InjectionRecord` with extra metadata (operator name, lore text) |
| `maxConfigSlots` | `number` | `3` | Config A/B/C count; stages with more loadout slots set this higher |
| `learnedLibraryPersistence` | `"chatState" \| "messageState"` | `"chatState"` | `"messageState"` makes the library rewindable for experimental modes |

## Composition with Existing Primitives

- **`PlaceholderRegistry<Form>`** (`registry.ts`) — form catalog. `formCollectionPattern` wraps this; `graftingPattern` takes it as a dependency, not a peer.
- **`Registry<AbilityId, AbilityDef>`** (`registry.ts`) — the Helminth learned library. Shard-backed via `asSaveable`.
- **`PersistenceStore` / `Shard`** (`persistence/store.ts`) — `helminth-library` + `form-injections` + optional `invigoration-state` shards.
- **`actor.ts`** — player as Tenno actor (`chatState` canon); currently-equipped form is a separate `Actor` instance (`puppetPattern` handles the piloting layer). `graftingPattern` touches the form actor's `ActionDef` set, not the Tenno actor.
- **`puppetPattern`** (`patterns/puppet.ts`, Wave 2D) — cross-reference: the pilot/form split is `puppetPattern`'s concern. `graftingPattern` operates on the form's ability catalog; `puppetPattern` decides which form is active.
- **`scheduler.ts`** — cooldown lock (when `subsumeCooldown` set) + weekly invigoration tick (when enabled).
- **`prose-register.ts`** — bio-mechanical lore register for narrative calls (see Prose-Register Hint).
- **`effects.ts`** — invigoration buffs: asymmetric kinetics via `trajectory`, 7-day duration, `duration: 7 * 24 * 60 * 60 * 1000`.

## Prose-Register Hint

From mining section 11: the lore register is *visceral, biological, symbiotic-but-parasitic*. Subsume is permanent biological commitment; injection is graft, not data transfer.

Snippet stages should paste into their internal `textGen` / `proseInstructions` calls — **not** injected via host `stageDirections` (north star #5: LLMs are single-shot; context is assembled, not accumulated):

```
Narrate Helminth interactions in a bio-mechanical register:
not "ability transferred" but "encoded into the organism's biomass";
not "slot updated" but "grafted into the frame's nervous tissue";
not "injection complete" but "the pattern took root."
Subsume is irreversible; treat it with the weight of digestion, not assignment.
```

Architecture note: pass via `proseInstructions({ architectures: [...], register: { extras: [snippetAbove] } })` inside the stage's `ContextContributor` chain.

## Example Stage Usage

```ts
import { graftingPattern } from "lib/patterns/grafting";
import { formPattern } from "lib/patterns/form";
import { puppetPattern } from "lib/patterns/puppet";
import { Actor } from "lib/actor";
import { Registry, PlaceholderRegistry } from "lib/registry";

const tenno = new Actor({ id: "tenno", name: "Operator", /* ... */ });
const forms = new PlaceholderRegistry<Form>();

const library = new Registry<AbilityId, AbilityDef>();

const grafting = graftingPattern({
  forms,
  learnedLibrary: library,
  consumeOnSubsume: true,
  helminthVersion: (def) => ({ ...def, power: def.power * 0.8 }),
  invigorations: {
    buffPool: [roarInvigoration, ironSkinInvigoration],
    weeklyScheduler: scheduler,
  },
});

const puppet = puppetPattern({ pilot: tenno, formRegistry: forms });

// Wire shards into store
const store = new PersistenceStore([
  ...grafting.shards,
  ...puppet.shards,
]);

// Subsume Rhino → learn Roar
grafting.hooks.subsume("rhino", library);

// Inject Roar onto Volt in Config A, ability slot 1
grafting.hooks.inject({
  sourceFormId: "rhino",
  abilityId: "roar",
  targetFormId: "volt",
  configSlot: 0,
  abilitySlot: 1,
});
```

The pattern reads as composition over framework: three named imports, one store, wired in one sitting.

## Open Questions

1. **`helminthVersion` override mechanism.** The `(AbilityDef) => AbilityDef` transformer is likely sufficient for staged-down scaling. First-class scaffolding (a `HelminthTier` type with a table of overrides) is only warranted if multiple patterns need to share the same transform logic. Defer until `formPattern` is implemented and its `ActionDef` shape is finalized.

2. **`abilityScaling` and mod access.** The mining spec says injected abilities scale with the *casting form's mods* — but mods are not a Wave 2D primitive. The casting form's `Stats` are accessible (via `Actor.getStat`); if stages need a mod-multiplier layer on top of stats, that is a stage-provided stat decorator, not a library primitive. `abilityScaling: "casting-form"` should resolve against the form's current `Stats` values at cast time; the mod→stat computation is the stage's concern.
