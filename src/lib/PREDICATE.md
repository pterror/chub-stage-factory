# Predicate — queryable, serializable conditional DSL

`Predicate<S>` is a tagged-union describing "is this true right now?" in
pure data. Branches cover the recurring conditions across every game
shape — tags, stat comparisons + tiers, inventory possession, location,
pairwise relations, time-since-event, world flags, boolean composition,
and a `custom` escape hatch. Targets resolve at evaluation time via a
`Refs` dict (`self`, `partner`, `player`, or `{ id }`); the evaluator
takes a small `Resolvers` hook bundle so predicates stay generic over
what an "actor" is.

Used by `trigger.ts` (gates ConditionalTriggers), pattern composers
that need predicate-gated content (faction unlocks, scene preconditions,
dialogue branches), and any "this is allowed when X" check.

## Combat trigger gate

```ts
import { type Predicate, P } from "./lib/predicate";

const opportunityAttack: Predicate = P.and(
  P.tagOn("self", "in-combat"),
  P.stat("self", "stamina", ">", 10),
  P.relation("self", "partner", "facing"),
);
```

## Social / relationship trigger

```ts
const factionApproaches: Predicate = P.and(
  P.stat("player", "arcology-rep", ">", 70),
  P.since("last-faction-encounter", ">", 7 * 24 * 60 * 60 * 1000),
  P.not(P.tagOn("player", "wanted")),
);
```

## Environmental / world-flag gate

```ts
const grueEats: Predicate = P.and(
  P.locatedAt("player", "maze-room-3"),
  P.flag("in-darkness", true),
  P.not(P.hasItem("player", "lantern")),
);
```

## Evaluating

```ts
import { evaluate } from "./lib/predicate";

const refs = { self: actor, partner: target, player: player };
const resolvers = {
  getTag: (a, tag) => a.tags.has(tag),
  getStat: (a, name) => a.getStat(name)?.effective(),
  getStatTier: (a, name) => a.getStat(name)?.tier(),
  hasItem: (a, item) => a.inventory.find(item).reduce((n, [, s]) => n + s.count, 0),
  getLocation: (a) => a.location,
  getRelation: (s, o, rel) => rel === "affinity" ? s.getAffinity(o.id) : undefined,
  sinceEvent: (event) => Date.now() - (this.lastSeen[event] ?? 0),
  getFlag: (flag) => this.flags[flag],
};

if (evaluate(opportunityAttack, this.state, refs, resolvers)) { /* ... */ }
```

The resolvers are stage-specific: predicates declare *what* to ask;
resolvers say *how* to read it from your concrete actors/state. Wire
them once at construction and reuse for every evaluate call.

## Serialization

Pure-data branches round-trip through JSON without ceremony:

```ts
JSON.stringify(opportunityAttack);
// {"kind":"and","clauses":[{"kind":"tag-on","target":"self","tag":"in-combat"}, ...]}
```

`{ kind: "custom"; id }` serializes only the id. On load, the stage
re-supplies the function body under the same id in
`resolvers.customs`. Predicates with custom branches survive saves
*structurally*; the function body must be re-attached by code at boot.
Prefer pure-data branches when possible.

## Composition with TriggerSet

The predicate is the gate; `ConditionalTrigger.when` references it
directly. See TRIGGER.md.

## Related

- `trigger.ts` — predicate-gated probabilistic firing.
- `tags.ts` — the existing tag-query DSL; `tag-on` predicates are the
  predicate-DSL bridge into tag-based content.
- `actor.ts` — supplies `getTag` / `getStat` / `getAffinity` resolvers
  off the shelf.
