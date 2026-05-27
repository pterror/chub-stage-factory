# Tags — tag-based identity and query DSL

`TagSet` is a `Set<string>` with a small query language. It is the
universal identity primitive: every body slot, item, actor, and effect
expresses what it is as a set of string tags rather than hard-coded
enums or class hierarchies.

Used in `body.ts`, `transformation.ts`, `equipment.ts`, `effects.ts`,
`inventory.ts`, and `predicate.ts`. Most callers never construct
`TagSet` directly — they receive one from `body.getEffectiveTags()` or
similar.

## Concepts

A **term** is either `"tag"` (must have) or `"!tag"` (must not have).
`matches(query[])` ANDs all terms; `matchesAny(query[])` ORs them.

`parseTerm("!claw")` → `{ negate: true, tag: "claw" }` — exposed for
callers building their own query evaluation.

## API [`src/lib/tags.ts`](./tags.ts#L25-L101)

- `parseTerm(term)` — split a term string into `{ negate, tag }`
- `new TagSet(initial?)` — from any iterable of strings
- `set.add(tag)` / `set.remove(tag)` — chainable; return `this`
- `set.has(tag)` — boolean
- `set.hasAll(tags[])` / `set.hasAny(tags[])` — bulk membership
- `set.matchesTerm(term)` — single term including negation
- `set.matches(query[])` — AND over all terms
- `set.matchesAny(query[])` — OR over all terms
- `set.size()`, `set.toArray()`, `set.clone()`, `set.toJSON()`
