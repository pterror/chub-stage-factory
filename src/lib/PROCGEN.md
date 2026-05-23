# Procgen — deterministic content helpers over RngStream

`procgen.ts` is the layer between `rng.ts` (entropy) and the
content-shaped things every Wave 3 example needs: weighted tables,
topology graphs, template instantiation, and name/id helpers. Pure
functions; determinism inherits from the RngStream you pass in.

Convention: pass `rng.mechanical` so cosmetic LLM reruns cannot
perturb world generation.

## Weighted tables

```ts
import { weightedPick, weightedPickN } from "./lib/procgen";

const LOOT = [
  { value: "gold", weight: 50 },
  { value: "potion", weight: 20 },
  { value: "scroll", weight: 5 },
];

weightedPick(LOOT, rng.mechanical);             // "gold" most often
weightedPickN(LOOT, 3, rng.mechanical);         // with replacement
weightedPickN(LOOT, 2, rng.mechanical, false);  // without replacement
```

## Topology — graphs and grids

`buildGraph` produces a `GraphNode[]` with one of five connectivity
shapes. Same primitive serves room graphs (Wave 2B world.ts), faction
networks (LT-shape), and family lineages (FC-shape).

```ts
import { buildGraph, buildGrid } from "./lib/procgen";

// 12-room dungeon, spanning tree
const rooms = buildGraph({
  nodeCount: 12,
  connectivity: "tree",
  idPrefix: "room",
  rng: rng.mechanical,
});

// Faction network, ensure each faction touches at least 2 others
const factions = buildGraph({
  nodeCount: 6,
  connectivity: "mesh",
  constraints: { minDegree: 2, maxDegree: 4 },
  rng: rng.mechanical,
});

// Must-include named nodes (entrance + boss room)
const map = buildGraph({
  nodeCount: 10,
  connectivity: "mesh",
  constraints: {
    mustInclude: [
      { id: "entrance", tags: ["safe"] },
      { id: "boss", tags: ["danger"] },
    ],
  },
  rng: rng.mechanical,
});

// Tile grid (arcology layout, FC overworld, walking-sim plot)
const grid = buildGrid({ width: 8, height: 6, wrap: false });
```

Connectivity shapes:

| Shape | Description |
|---|---|
| `tree` | Spanning tree only; min edges, fully connected |
| `mesh` | Tree backbone + ~0.5N extra edges; balanced |
| `ring` | Cycle through all nodes; degree 2 each |
| `sparse` | Synonym for tree (semantic alias) |
| `dense` | Complete graph attempt, clipped by maxDegree |

`minDegree` enforces a floor by adding random edges where needed;
`maxDegree` clips during construction so neither shape can blow out.

## Template instantiation

Tagged-union FieldSpec: `pick`, `range` (float), `int`, `compose`
(nested template), `literal`.

```ts
import { instantiate, type Template } from "./lib/procgen";

interface Monster {
  species: string;
  hp: number;
  damage: number;
  loot: string;
}

const monsterTpl: Template<Monster> = {
  fields: {
    species: { kind: "pick", from: [
      { value: "goblin", weight: 50 },
      { value: "orc", weight: 20 },
      { value: "troll", weight: 5 },
    ]},
    hp: { kind: "int", min: 10, max: 50 },
    damage: { kind: "range", min: 1, max: 6 },
    loot: { kind: "pick", from: [{ value: "gold", weight: 1 }] },
  },
};

const goblin = instantiate(monsterTpl, rng.mechanical);
```

Compose nested templates for richer objects (`{ kind: "compose", from: subTpl }`).

The reference for "this is enough" is PARC's `MODULE_TEMPLATES`
pattern — anything richer is a code generator, not a template.

## Names + identifiers

```ts
import { randomId, pickName } from "./lib/procgen";

randomId(rng.mechanical);                  // "id_a3f...b2c1"
randomId(rng.mechanical, "npc");           // "npc_..."

const FIRST_NAMES = ["Alice", "Bjorn", "Carol", "Daichi"];
pickName(FIRST_NAMES, rng.cosmetic);       // cosmetic stream is fine for names
```

`randomId` consumes 2 uint32s from the stream; deterministic given
stream state.

## Composing with persistence

Procgen helpers are pure functions; persist their *output*, not the
helpers themselves. The pattern: generate once at stage init (or on
first need), commit the generated structure into a Shard, replay it
from the shard thereafter.

```ts
// At stage init:
this.rooms = buildGraph({ nodeCount: 12, connectivity: "mesh", rng: rng.mechanical });

// In the store:
rooms: shardOf(
  "rooms", { value: this.rooms },
  (d: { value: GraphNode[] }) => d,
  this.layers.chatStateBackend, forbidBranching(snapshotHistory()),
),
```

`chatStateBackend + forbidBranching` is the right default — once the
world is generated, it stays generated across swipes.
