# patterns/cyber-slots.ts

## Purpose

Wires `Body` + `Loadout` (equipment + constraint checking) +
`Registry<TransformationDef>` + default visual/interoceptive
`ObservationSource` into a single bundle. Handles the scaffold every
ripperdoc-style stage repeats: constructing the body from a slot map,
binding a loadout, and assembling observation sources for body tags,
equipped mods, and violations.

The composer owns no state. `body`, `loadout`, `mods`, `tfs` are the
underlying primitives, directly accessible.

## API

```ts
interface CyberSlotsInit {
  slots: Record<string, string[]>;      // initial body slot tags
  mods: Registry<EquipmentDef>;         // available cyberware
  tfs:  Registry<TransformationDef>;    // available surgical TFs
}

interface CyberSlotsBundle {
  body: Body;
  loadout: Loadout;
  mods: Registry<EquipmentDef>;
  tfs:  Registry<TransformationDef>;
  applyTf(id, now): void;
  equip(id, now): ReturnType<Loadout["equip"]>;
  unequip(slot): void;
  violations(now): ReturnType<Loadout["checkAllConstraints"]>;
  observationSources(now): ObservationSource<{ now: number }>[];
}

function cyberSlotsPattern(init: CyberSlotsInit): CyberSlotsBundle
```

## Example

```ts
const cyber = cyberSlotsPattern({
  slots: { head: ["flesh-only", "hair-short"], torso: ["flesh-only"] },
  mods: MODS,
  tfs: TFS,
});

// in afterResponse:
cyber.applyTf("install_neural_port", now);
const result = cyber.equip("deckjack", now);
if (!result.ok) console.warn("equip failed:", result.reason);
cyber.unequip("head");

// in beforePrompt:
const observed = assembleObservations(
  cyber.observationSources(now),
  { now }, { now, maxCount: 4 },
);
```

## Gotchas

- `applyTf` silently no-ops for unknown ids. Use `tfs.require(id)` +
  `applyTfFn` directly if you need an error on unknown ids.
- `equip` calls `mods.require(id)` — throws if the id is not in the
  registry. Validate against `mods.keys()` in `parseTags` before calling.
- `violations(now)` calls `loadout.checkAllConstraints()` on every
  invocation — it's not cached. In tight loops, save the result.
- The `observationSources` salience for `violations` is 1 when any
  violation is present and 0 otherwise — intentionally non-habituating
  (`habituationTau: 0`) so violations always surface to the LLM.
- Persistence (body + loadout serialisation) is not included here; it
  remains in the stage, because serialisation strategy (chatState vs
  messageState, branch policy) is stage-specific.
