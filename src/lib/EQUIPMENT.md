# Equipment — equipment defs, constraint checking, and fit reports

`EquipmentDef` declares what a piece of equipment needs from a body slot
(tag constraints), what it grants while worn (`grantsTags`), and what
happens when those constraints break (`onConflict`). `Loadout` manages
the set of equipped items for one body.

Used by stage authors to model clothing, weapons, restraints, and any
wearable that cares about the slot's current body tags.

## Concepts

**Equipping** snapshots the slot's effective tags at the moment of equip.
Later, `fit(slot)` diffs that snapshot against the current effective tags
to classify the fit as `"comfortable"`, `"tight"`, `"rides_up"`,
`"too_loose"`, or `"broken"`.

**Constraint checking** separates detection (`checkAllConstraints` →
`Violation[]`) from resolution (`resolveViolations` → per-policy result).
Stage authors can supply their own resolution logic using the violation
data; `resolveViolations` is one default policy.

`onConflict` values and their behavior in `resolveViolations`:
- `"unequip"` / `"destroy"` — removes from loadout
- `"degrade"` — records `degradePenalties` in result; item stays equipped
- `"adapt"` — resolved silently if an `adaptAlternative` constraint set passes
- `"prompt"` / `"custom"` — passed through to the stage for handling

## API [`src/lib/equipment.ts`](./equipment.ts#L102-L298)

- `canEquip(def, body)` — `CanEquip`; checks slot existence and constraints
- `checkConstraints(def, body)` — `null` | adapted record | `Violation`
- `fit(inst, body)` — `FitReport` with `fit` kind, `failedTerms`, `added`, `removed`
- `fromDict(data)` — fill defaults for optional fields

- `new Loadout(body)`
- `loadout.equip(def, now)` — checks `canEquip`; unequips existing item in slot first
- `loadout.unequip(slot)` — returns the removed instance or `null`
- `loadout.getEquipped(slot)` / `getAllEquipped()`
- `loadout.checkAllConstraints()` — `Violation[]` across all equipped items
- `loadout.fit(slot)` — `FitReport | null`
- `loadout.resolveViolations()` — apply `onConflict` policies; returns `ResolveResult`
- `loadout.toJSON()` / `Loadout.fromJSON(data, body, defs)` — defs catalog required for restore

## Gotchas

- `toJSON` stores only `defId`, not the full def (functions aren't
  serializable). `fromJSON` silently skips items whose `defId` is absent
  from the supplied catalog.
- `grantsTags` is stored on the def but `Loadout` does not automatically
  apply them to the body — the stage is responsible for merging granted
  tags when building the effective tag set.
