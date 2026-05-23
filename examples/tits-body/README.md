# tits-body — Vey the alchemist

Stage exercising `src/lib/body.ts` + `transformation.ts` + `snapshots.ts`.
The body has slot-tag base state; tinctures are TransformationDefs with
trajectories that ramp `addTags` between checkpoints over the
baseDuration. `<drink>id</drink>` applies one; `<restore>baseline</restore>`
rolls back to the snapshot taken at scene start.

## Primitives

- `body` — Body holding base TagSets per slot.
- `transformation` — `apply`, `getConflicts`, `applyTrajectories` (called
  each turn so partial states surface to the LLM).
- `snapshots` — Snapshots.save("baseline") then .restore to undo.
- `tags` — TagSet underlies it all.
- `observation` — full effective tag map + in-progress TF list.

## PATTERNS.md recipe

`## 2. TiTS-style body transformation`.
