# patterns/grafting.ts

## Purpose

Helminth-style ability/feature transfer with provenance. A Form is subsumed into
a learned library (permanent, biological); abilities from that library are then
injected into other Forms' config slots (replaceable per branch).

Design spec: `src/lib/design/GRAFTING.md`.  Enables **Warframe-shape (#9)**.

## API

```ts
function graftingPattern(opts: GraftingOptions): GraftingBundle
```

**Key options** (all optional except `forms` and `learnedLibrary`)

| Knob | Default | Effect |
|---|---|---|
| `consumeOnSubsume` | `false` | Remove subsumed form from registry |
| `helminthVersion` | identity | Weaken ability on injection |
| `slot4Lock` | `true` | Lock the last config slot |
| `maxConfigSlots` | `3` | Config A/B/C count |
| `provenanceTracking` | `null` | Extend InjectionRecord with extra metadata |

**`GraftingBundle.hooks`**

| Method | Description |
|---|---|
| `subsume(formId, abilityId)` | Add ability to learned library; returns InjectionRecord |
| `inject(req)` | Inject a learned ability into a form config slot |
| `replace(req)` | Same as inject; idiomatic when slot is already occupied |
| `listLearned()` | All abilities in the learned library |
| `listInjected(formId)` | All FormConfig entries for a form |

## Example

```ts
import { graftingPattern } from "lib/patterns/grafting";
import { Registry } from "lib/registry";

const learnedLibrary = new Registry<AbilityDef>();
learnedLibrary.register("roar", { id: "roar", name: "Roar", nativeFormId: "rhino", scalingRule: "casting-form" });

const grafting = graftingPattern({
  forms: collection.registry,
  learnedLibrary,
  consumeOnSubsume: true,
  helminthVersion: (def) => ({ ...def, name: `${def.name} (Helminth)` }),
});

// Subsume Rhino — permanently adds Roar to library
grafting.hooks.subsume("rhino", "roar");

// Inject Roar into Volt's Config A, ability slot 1
grafting.hooks.inject({ sourceFormId: "rhino", abilityId: "roar",
  targetFormId: "volt", configSlot: 0, abilitySlot: 1 });
```

## Gotchas

- Slot-4 lock: `configSlot === maxConfigSlots - 1` throws unless `slot4Lock: false`.
- `subsume` requires the ability to already exist in `learnedLibrary`. The stage
  author populates the library; subsume marks it as learned. This mirrors the
  GRAFTING.md design: the library is the catalog, not the result of subsume.
- Injection state is in-memory only. Wire the returned `GraftingBundle` into a
  `PersistenceStore` Shard if durability across sessions is needed (see
  `src/lib/design/GRAFTING.md §Shard Composition`).
- `helminthVersion` is applied at inject time; the transformed def is recorded
  in the config slot. The original `learnedLibrary` entry is not mutated.
