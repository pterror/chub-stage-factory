# Actor — bundled entity + ActorPool bulk-collection

`Actor` is the named-thing-in-the-world primitive: a single object
that owns a `Body`, `Inventory`, per-stat `Map<string, Stat>`,
optional `location` string, optional `owner: ActorId`, sparse
`affinity: Map<ActorId, number>`, and a free-form `TagSet`. Methods
are intentionally thin — most behavior lives on the composed
primitives. `ActorPool` is the bulk-collection form for stages that
scale to 100+ actors (FC, FS, LT shapes).

## Construction

```ts
import { Actor, ActorPool } from "./lib/actor";
import { Body } from "./lib/body";
import { Inventory } from "./lib/inventory";
import { Stat, thresholdTiers } from "./lib/stats";

const alice = new Actor({
  id: "alice",
  name: "Alice",
  body: new Body({ torso: ["human"], head: ["human"] }),
  inventory: new Inventory().ensureSpot("pocket"),
  stats: {
    hp: new Stat({ base: 100, tiers: thresholdTiers([{ below: 25, label: "critical" }], "ok") }),
    morale: new Stat({ base: 50 }),
  },
  location: "town-square",
  tags: ["pc", "human"],
});
```

`body`, `inventory`, `stats`, `affinity`, `tags` are all optional and
default-construct sensibly. `id` and `name` are required.

## Affinity (sparse)

```ts
alice.setAffinity("bob", 10);
alice.adjustAffinity("bob", -3);   // 7
alice.getAffinity("carol");        // 0 — unrecorded pairs default to 0
alice.setAffinity("bob", 0);       // removes the entry; sparse
```

The `affinity` map IS the `RelationshipScore<Subject, Object>`
primitive that was ruled out in ROADMAP — it lives on the actor as a
sparse Map, not as a separate module.

## Ownership

```ts
const slave = new Actor({ id: "iris", name: "Iris", owner: "alice" });
pool.byOwner("alice");             // [iris, ...]
```

`owner` is a string id, deliberately opaque — the same field unifies
slavery (LT/FC), pets (CoC/TiTS), and familiars/summons (anywhere).

## ActorPool — bulk-first

```ts
const pool = new ActorPool([alice, bob, iris]);

pool.byLocation("town-square");    // location-based scope
pool.byTag("hostile");             // tag-based query
pool.byOwner("alice");             // ownership query
pool.forEach((a) => a.body.tick(now));  // bulkTick pattern (Wave 2C)
pool.filter((a) => a.getStat("hp")!.effective() > 0);
```

`forEach` / `filter` / `map` mirror Array; `add` / `get` / `require` /
`has` / `delete` mirror Map. `actors: Map<ActorId, Actor>` is exposed
for cases the helpers don't cover.

## Persistence

Actor and ActorPool ship `toJSON`/`fromJSON` symmetric to other
primitives. Restoring an Actor needs an optional `ActorDeps` dict for
stat-tier functions (functions can't survive JSON):

```ts
import { shardOf, chubTreeHistory } from "./lib/persistence";

actors: shardOf(
  "actors", this.pool,
  (d) => ActorPool.fromJSON(d, {
    statTiers: {
      hp: thresholdTiers([{ below: 25, label: "critical" }], "ok"),
    },
  }),
  this.layers.messageStateBackend, chubTreeHistory(),
),
```

Pick the persistence paradigm per stage: `messageStateBackend +
chubTreeHistory()` for branchy actors (swipe undoes the encounter);
`chatStateBackend + forbidBranching(snapshotHistory())` for canon
actors that survive swipes (introduced NPCs, slave roster).

## When NOT to use Actor

- One-off entities with only stats and no body/inventory: use a `Stat`
  map directly.
- Pure data records (item defs, faction defs): those are Defs, not
  Actors. Use `Registry<Def>`.
- Player vs. NPC distinction: an Actor doesn't care. Tag with `"pc"`
  if it matters to your stage.
