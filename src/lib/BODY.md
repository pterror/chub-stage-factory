# Body — body slots, base tags, and transformation stack

`Body` is the substrate for a character's physical state. It holds a map
of named slots (`hand`, `mouth`, `chest`, …) each with a base `TagSet`,
plus a list of active `TransformationInstance` entries that layer
additions and removals on top.

Used by `transformation.ts`, `equipment.ts`, `scene.ts`, and `actor.ts`.
Everything that asks "what is this body part right now?" calls
`getEffectiveTags(slot)`.

## Concepts

**Base tags** are the slot's permanent identity (e.g. `hand` has
`"human"`, `"fingered"`). **Transformations** are overlaid in push order:
each one removes then adds tags. `getEffectiveTags` recomputes from
scratch on every call — it is a pure function over base + active stack.

**Permanent patches** (`applyPermanent`) dissolve directly into base tags
and leave no instance behind. Use for irreversible changes.

## API [`src/lib/body.ts`](./body.ts#L54-L197)

- `new Body(initialSlots?)` — map of slot name → tag iterable or `TagSet`
- `body.hasSlot(s)` / `getSlots()` — slot membership
- `body.getBaseTags(s)` / `setBaseTags(s, tags)` — direct base access
- `body.addSlot(s, tags?)` / `removeSlot(s)` — structural changes; `removeSlot` also drops all TFs for that slot
- `body.getEffectiveTags(s)` — recomputes every call
- `body.getAllEffectiveTags()` — map of all slots
- `body.applyTransformation(tf)` — push instance; replaces if same id already present
- `body.removeTransformation(id)` / `hasTransformation(id)` / `getTransformation(id)`
- `body.getTransformations()` / `getTransformationsForSlot(s)`
- `body.applyPermanent(patch)` — dissolves into base; returns `ApplyResult`
- `body.tick(now)` — removes expired transformations; returns the expired list
- `body.toJSON()` / `Body.fromJSON(data)` — `source` back-references are dropped on serialize

## Gotchas

- `getEffectiveTags` returns a `clone` of the base then mutates it —
  the returned `TagSet` is safe to hold, but it reflects the state at
  call time, not live.
- `toJSON` strips `source` from each transformation instance (functions
  aren't serializable). `fromJSON` restores instances without `source`;
  call `applyTrajectories` (from `transformation.ts`) after restore if
  trajectories are needed.
