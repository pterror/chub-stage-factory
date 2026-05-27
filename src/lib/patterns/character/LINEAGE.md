# lineagePattern

**File:** `src/lib/patterns/lineage.ts`
**Composes:** `procgen.buildGraph` + `ActorPool` + `Actor.affinity`
**Enables:** Breeding-sim (#18)

## Purpose

Tracks parent-child lineage as a directed graph over an `ActorPool`. Parent-child edges are stored in both an internal adjacency map and `Actor.affinity` (so they survive `toJSON`/`fromJSON`). Graph queries — ancestors, descendants, common ancestors, inbreeding coefficient — are implemented as BFS over the adjacency map.

`buildFounderGraph` generates a procgen-topology founder generation via `procgen.buildGraph` and adds actors to the pool.

## API

```ts
lineagePattern({ pool, actorFromNode? }): LineageBundle
```

### `LineageBundle`

| Method/Field | Description |
|---|---|
| `pool` | The `ActorPool` |
| `graph` | `Map<ActorId, Set<ActorId>>` — parent → children |
| `addChild(parentId, child)` | Add offspring to pool; record parent-child edge |
| `parentsOf(id)` | Direct parent ids (0–2 for sexual reproduction) |
| `childrenOf(id)` | Direct child ids |
| `ancestorsOf(id)` | All ancestors via BFS |
| `descendantsOf(id)` | All descendants via BFS |
| `commonAncestors(a, b)` | Ids present in ancestor sets of both a and b |
| `inbreedingCoefficient(a, b)` | `|shared| / |union of ancestors|`; 0 when both are founders |
| `buildFounderGraph(opts)` | Generate founder actors from `procgen.buildGraph` topology |

## Example

```ts
const lineage = lineagePattern({
  pool,
  actorFromNode: (node, rng) =>
    new Actor({ id: node.id, name: pickName(nameTable, rng) }),
});

// Generate 10 founders with sparse connectivity.
const founders = lineage.buildFounderGraph({
  nodeCount: 10, connectivity: "sparse", rng,
});

// Register offspring.
const offspring = new Actor({ id: "gen2_01", name: "Fern" });
lineage.addChild(founders[0].id, offspring);

// Query.
const ancestors = lineage.ancestorsOf("gen2_01");
const coeff = lineage.inbreedingCoefficient(founders[0].id, founders[1].id);
```

## Gotchas

- `buildFounderGraph` wires founder-generation topology edges as peer affinity (not parent-child) — founders have no parents.
- The `PARENT_AFFINITY_KEY` stored on `Actor.affinity` is a convention for serialization. You can recover parent edges from affinity on `fromJSON` by scanning keys with the prefix `__lineage_parent__`.
- BFS for `ancestorsOf`/`descendantsOf` is O(n) — fine for breeding-sim scale (~100s of actors). For 10k+ actors, cache results.
- `actorFromNode` is required if `buildFounderGraph` is called; optional otherwise.
