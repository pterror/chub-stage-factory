# Constraints — tag-query violation detection

`constraints.ts` is a small module of pure functions. It checks tag
queries against a `TagSet` and returns `Violation` records. Resolution
policy (unequip, degrade, adapt, …) is left to the stage; two example
resolvers are included.

## API

- `interface Violation { source, constraint, failedTerms, context? }` (`src/lib/constraints.ts:22-26`)
- `check(source, constraint, tags, context?): Violation | null` — returns null on pass, a `Violation` with the failing terms on fail (`src/lib/constraints.ts:28-38`)
- `checkAll(constraintsBySource, tags): Violation[]` — checks every source entry; collects all violations (`src/lib/constraints.ts:40-50`)
- `resolveUnequip(violations): string[]` — returns the `source` id of every violation (items to remove) (`src/lib/constraints.ts:52-54`)
- `resolveDegrade(violations): Record<source, failedTerms>` — maps each source to its failing terms for penalty application (`src/lib/constraints.ts:56-60`)

## Gotchas

- `constraint` is a term array interpreted as AND. Each term may be
  negated (`"!tag"`); `TagSet.matchesTerm` handles negation. There is no
  built-in OR; compose multiple constraints if needed.
- `resolveUnequip` and `resolveDegrade` are thin convenience functions,
  not policy. Stages with `onConflict: "adapt"` or `"prompt"` write their
  own resolver over the same `Violation[]`.
