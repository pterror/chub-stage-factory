# Error-handling convention

**Adopted 2026-05-25. Forward-looking — some existing modules violate this rule; see note below.**

## The rule

| Situation | Response |
|-----------|----------|
| Programmer error — bad input, invariant violation, missing required definition, impossible state | **throw** |
| Absent data — optional lookup, item that may not exist, field that is legitimately null | **return null** (or empty array / `[]` where a collection is expected) |
| True developer-facing warning (unusual but not broken) | `console.warn` |

`console.warn` is not a control-flow primitive. It must never be used to signal "this call
returned nothing useful" — that is either a throw (if the call should never have been made) or
a null return (if the caller should handle absence).

## Examples drawn from actual code

### Throw — programmer error

```ts
// rng.ts
weightedPick(items: readonly { value: T; weight: number }[]): T {
  let total = 0;
  for (const it of items) total += Math.max(0, it.weight);
  if (total <= 0) throw new Error("weightedPick: total weight <= 0");
  // ...
}
```

Calling `rng.weightedPick([])` with an empty distribution is a programming mistake — there is
no valid return value and no recovery a caller could reasonably attempt. Throwing surfaces the
bug immediately.

```ts
// rng.ts
pick<T>(arr: readonly T[]): T {
  if (arr.length === 0) throw new Error("pick: empty array");
  // ...
}
```

Same logic: picking from an empty array has no valid answer.

```ts
// rng.ts
pickN<T>(arr: readonly T[], n: number, replace = false): T[] {
  if (n > arr.length) throw new Error("pickN: n > arr.length without replacement");
  // ...
}
```

Requesting more items than exist (without replacement) violates a precondition.

### Return null / empty — absent data

```ts
// inventory.ts
find(defId: string): { spot: string; count: number }[] {
  // Returns [] when the item is not in this inventory.
  // The item may simply not be here — that is normal.
}
```

An item not being in inventory is expected runtime state, not a bug. Returning `[]` lets the
caller decide what to do (render "empty," skip an action, prompt the player).

The same rule applies to any "look up by id" helper across the library. If a Registry lookup
returns `undefined`, the correct primitive response is `null` or `undefined`, not a throw — the
id may be valid but the entry not yet populated (especially relevant for `PlaceholderRegistry`).

### `console.warn` — true developer warning

```ts
// Correct use: warn about a configuration that will work but is unusual.
if (contributors.length === 0) {
  console.warn("ContextAssembler: no contributors registered; output will be empty.");
}
```

This is not an error (the assembler can still run) and not an absent-data case (the stage author
may be mid-setup). A warning is appropriate.

## Note on existing violations

Some modules in `src/lib/` predate this convention and handle errors inconsistently — for
example, returning `null` in places that should throw, or logging and continuing where a throw
would be safer. This convention is **not retroactively enforced in this pass**. Fix violations
opportunistically when touching a file for another reason; do not refactor solely to comply.

When writing new code or reviewing PRs, apply the rule above.
