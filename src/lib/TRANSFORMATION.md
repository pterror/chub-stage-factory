# Transformation — blueprints for body modifications

A `TransformationDef` is the authored blueprint: which slot, which tags
to add/remove, how long it lasts, what tags it requires or forbids, and
how it relates to other active transformations. `apply` creates a
`TransformationInstance` and pushes it onto a `Body`.

Used by stage authors to express spells, status effects on body parts,
TF sequences, and any time-limited physical change. `body.ts` stores
the instances; this module supplies the policy (can it apply? what
conflicts exist?).

## Concepts

**`canApply`** checks slot existence, required tags, and
`conflictsWithTags` on the slot. It returns `{ ok }` — it does not
modify state.

**`getConflicts`** walks all existing transformations and asks both sides
(incoming and existing) what relationship they declare. The result is
data; resolution is the stage's policy (remove the conflict, block the
incoming TF, etc.).

**Trajectories** (`def.trajectory(elapsedFraction, elapsed) →
TrajectoryStep`) let a TF vary its add/removeTags over its lifetime.
Body does not invoke trajectories automatically — call
`applyTrajectories(body, now)` each tick to rewrite instance tags.

## API [`src/lib/transformation.ts`](./transformation.ts#L83-L196)

- `getRelationship(def, otherId)` — look up the relationship label from `def.conflicts`; falls back to `"*"` entry
- `canApply(def, body)` — `CanApply` result; does not modify body
- `getConflicts(def, body)` — two-perspective `ConflictRecord[]`
- `apply(def, body, now, durationOverride?)` — create instance and push; returns `null` if `canApply` fails
- `applyTrajectories(body, now)` — rewrite all instance tags from their def's trajectory
- `fromDict(data)` — fill defaults for optional fields

## Gotchas

- `apply` calls `canApply` internally and returns `null` on failure
  without throwing. Call `canApply` first if you need the reason.
- `applyTrajectories` mutates instance `addTags`/`removeTags` in place.
  If you serialize body state, call it before `toJSON` if you want
  trajectory-resolved tags in the snapshot, or after `fromJSON` to
  rehydrate them.
- `conflicts` keys use the *other TF's id* (or `"*"` as wildcard), not
  slot names. The relationship label string is user-defined; the module
  assigns no semantics to specific labels.
