# GraphView

Wave 2E Batch B · Affordance type: **navigational + gestural + command** · Tier 1 leaf.

## Purpose

Nodes + edges rendered onto an SVG canvas. Intended for world.ts room
graphs (rooms as nodes, exits as edges), faction-relation graphs, dialogue
trees, family/lineage trees. Clicking an interactive node invokes
`node.verb` with `{ target: node.id }`; clicking an interactive edge
invokes `edge.verb` with `{ target: edge.id }`.

## Props

```ts
interface GraphNode {
  id: string;
  label?: string;
  x?: number;         // fixed layout only
  y?: number;
  verb?: string;      // verb to invoke on node click
  data?: unknown;
}

interface GraphEdge {
  id: string;
  source: string;     // node id
  target: string;     // node id
  label?: string;
  verb?: string;      // verb to invoke on edge click
  directed?: boolean; // renders arrowhead, default false
  data?: unknown;
}

interface GraphViewProps<N extends GraphNode, E extends GraphEdge>
  extends IntrospectAware {
  nodes: N[];
  edges: E[];
  layout?: "force" | "fixed";   // default "force"
  renderNode?: (node: N, interactive: boolean) => ReactElement;
  renderEdge?: (edge: E, interactive: boolean) => ReactElement;
  onNodeClick?: (node: N) => void;
  onEdgeClick?: (edge: E) => void;
  width?: number;      // default 400
  height?: number;     // default 300
  style?: CSSProperties;
}
```

`IntrospectAware`: `availableVerbs?`, `onVerbInvoke?`, `verbFilter?`, `pending?`.

## Layout algorithm

**Force mode (default):** zero-dependency Verlet-integration spring-charge
simulation. Applied forces: repulsion (charge ≈ 1800), spring attraction
along edges (rest-length 120 px, k = 0.04), weak centering (k = 0.008).
Velocity damped at 0.85 per tick. Runs for 120 burn-in ticks on
mount/node-change; then freezes (no continuous rAF loop). Layout is
deterministic after burn-in and does not animate continuously.

Rationale for from-scratch: d3-force is not in the project's deps; the
design doc explicitly says "if it brings a heavy transitive, ship a small
from-scratch force impl instead" — the target graph size is ≤30 nodes.

**Fixed mode:** nodes must carry `x`/`y`. If all nodes supply both
coordinates the component auto-selects fixed layout regardless of the
`layout` prop.

## Usage

```tsx
<GraphView
  nodes={Object.values(world.rooms).map(r => ({
    id: r.id, label: r.name, verb: "go",
  }))}
  edges={world.exits.map(e => ({
    id: `${e.from}-${e.to}`, source: e.from, target: e.to,
    directed: e.oneWay,
  }))}
  availableVerbs={verbs}
  onVerbInvoke={this.invokeVerb}
  width={500}
  height={350}
/>
```

## Affordance type

**Navigational** (graph topology) + **gestural** (node/edge as spatial
targets) + **command** (click-to-invoke).

## Opacity profile

- **Visible:** graph topology, node labels, edge directionality,
  interactivity state (color differentiation in default renderer).
- **Hidden:** edge weights, node metadata beyond `label`,
  force simulation parameters, underlying room/exit data structures.

## Deviations / gaps

- `renderEdge` prop is accepted but not called in the default path; custom
  edge rendering is not yet wired through (the default line renderer handles
  the common case). A future wave should thread `renderEdge` into the SVG
  `<g>` per edge.
- Zoom/pan ("gestural" in the design's affordance type description) is not
  implemented. The design says "if implemented"; it is out of scope for
  this batch.
- The `renderNode` foreignObject approach requires nodes to render as HTML.
  For SVG-native node rendering, stage authors should use `onNodeClick` +
  SVG primitives directly.
