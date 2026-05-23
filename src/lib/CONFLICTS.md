# Two-perspective conflict model

When two transformations want to coexist on the same body (or two effects on
the same target, or two equipment items on the same slot), the library does
not pick a winner. It reports the disagreement as data:

```ts
interface ConflictRecord {
  existingId: string;
  existingTf: TransformationInstance;
  incomingSays: RelationKind | null;
  existingSays: RelationKind | null;
}
```

Two perspectives. Either side may have an opinion; either side may not. The
labels (`"stack"`, `"replace"`, `"block"`, `"merge"`, `"annihilate"`, or any
custom string) are not interpreted by the library — they are passed through.

## Why both sides?

A `"horns"` TF may consider `"crown"` a `"replace"` relationship (the horns
push the crown off). The `"crown"` TF may consider `"horns"` a `"block"`
relationship (the crown is sacrosanct; horns may not grow). These are not
the same statement. The library reports both; the stage's policy decides
whose opinion wins:

```ts
function resolve(c: ConflictRecord): "apply" | "skip" | "remove_existing" {
  if (c.incomingSays === "block" || c.existingSays === "block") return "skip";
  if (c.incomingSays === "replace") return "remove_existing";
  if (c.existingSays === "replace") return "skip";
  return "apply"; // both sides agree to coexist (or neither has an opinion)
}
```

This is the only place the stage gets to legislate. The rest of the system
just describes the world.

## Default reading when only one side speaks

Conventional resolution policies (you may write your own):

| `incomingSays` | `existingSays` | Default |
|----------------|----------------|---------|
| `"replace"`    | `null`         | remove existing, apply incoming |
| `null`         | `"replace"`    | skip (existing claims dominance) |
| `"block"`      | anything       | skip |
| anything       | `"block"`      | skip |
| `"stack"`      | `"stack"`      | apply both (additive) |
| `"merge"`      | `"merge"`      | apply incoming with `addTags`/`removeTags` unioned with existing |
| `null`         | `null`         | not a conflict — record won't be emitted |

## Anti-pattern: hardcoding in the library

A first attempt usually wants `applyTransformation` to "just handle"
conflicts. Don't. The stage knows things the library never will: that this
chat is in a permissive mood, that the user just said "make it stick," that
two normally-conflicting TFs are part of a scripted sequence and should both
apply. Conflict resolution is conversation context; the library is not.

`getConflicts` exists so that the stage can hand the records to the LLM as
part of an observation, ask for a decision, parse the response, and act —
or use a fast deterministic policy when no judgment is needed. Either way,
the library produces evidence; the stage produces a verdict.
