/*
 * procgen.ts — deterministic procgen helpers over RngStream.
 *
 * WHAT: Pure functions that consume an RngStream and produce content:
 *         - weighted tables (`weightedPick`, `weightedPickN`)
 *         - topology generators (`buildGraph` for tree/mesh/ring/sparse/
 *           dense connectivities; `buildGrid` for tile grids)
 *         - template instantiation (tagged-union FieldSpec: pick / range
 *           / int / compose / literal)
 *         - name + id helpers (`randomId`, `pickName`)
 *
 * WHY: Every Wave 3 example needs to fabricate things — rooms, names,
 *      faction graphs, families, drops. `rng.ts` ships the entropy
 *      primitive; this file ships the next layer up, the recurrent
 *      patterns that show up across game shapes. Kept pure-functional
 *      (no state) so stages compose freely; determinism is inherited
 *      from the passed-in RngStream.
 *
 *      Use the `mechanical` stream for procgen so cosmetic LLM rerolls
 *      can't perturb world generation.
 *
 * SHAPE:
 *   interface WeightedEntry<T> { value, weight }
 *   weightedPick(table, rng): T
 *   weightedPickN(table, n, rng, replace?): T[]
 *
 *   interface GraphNode { id, neighbors, tags? }
 *   type Connectivity = "tree" | "mesh" | "ring" | "sparse" | "dense"
 *   interface BuildGraphOptions { nodeCount, connectivity, constraints?, idPrefix?, rng }
 *   buildGraph(opts): GraphNode[]
 *   buildGrid(opts: { width, height, wrap?, idPrefix? }): GraphNode[]
 *
 *   type FieldSpec =
 *     | { kind: "pick"; from: WeightedEntry<any>[] }
 *     | { kind: "range"; min, max }      // float
 *     | { kind: "int"; min, max }        // integer inclusive
 *     | { kind: "compose"; from: Template<any> }
 *     | { kind: "literal"; value: any }
 *   interface Template<T> { fields: Record<keyof T, FieldSpec> }
 *   instantiate<T>(template, rng): T
 *
 *   randomId(rng, prefix?): string
 *   pickName(table, rng): string
 */

import { RngStream } from "./rng";
import { TagSet } from "./tags";

// ─── Weighted tables ─────────────────────────────────────────────────

export interface WeightedEntry<T> {
  value: T;
  weight: number;
}

export function weightedPick<T>(table: readonly WeightedEntry<T>[], rng: RngStream): T {
  if (table.length === 0) throw new Error("weightedPick: empty table");
  return rng.weightedPick(table as { value: T; weight: number }[]);
}

export function weightedPickN<T>(
  table: readonly WeightedEntry<T>[],
  n: number,
  rng: RngStream,
  replace = true,
): T[] {
  if (n < 0) throw new Error("weightedPickN: n must be >= 0");
  if (replace) {
    const out: T[] = [];
    for (let i = 0; i < n; i++) out.push(weightedPick(table, rng));
    return out;
  }
  if (n > table.length) {
    throw new Error("weightedPickN: n > table.length without replacement");
  }
  const pool: WeightedEntry<T>[] = table.map((e) => ({ ...e }));
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    const v = weightedPick(pool, rng);
    out.push(v);
    const idx = pool.findIndex((e) => e.value === v);
    if (idx >= 0) pool.splice(idx, 1);
  }
  return out;
}

// ─── Topology ────────────────────────────────────────────────────────

export interface GraphNode {
  id: string;
  neighbors: string[];
  tags?: TagSet;
}

export type Connectivity = "tree" | "mesh" | "ring" | "sparse" | "dense";

export interface NodeSpec {
  id: string;
  tags?: string[];
}

export interface GraphConstraints {
  minDegree?: number;
  maxDegree?: number;
  mustInclude?: NodeSpec[];
}

export interface BuildGraphOptions {
  nodeCount: number;
  connectivity: Connectivity;
  constraints?: GraphConstraints;
  idPrefix?: string;
  rng: RngStream;
}

function makeNodes(count: number, prefix: string, mustInclude?: NodeSpec[]): GraphNode[] {
  const nodes: GraphNode[] = [];
  const used = new Set<string>();
  for (const spec of mustInclude ?? []) {
    nodes.push({ id: spec.id, neighbors: [], tags: spec.tags ? new TagSet(spec.tags) : undefined });
    used.add(spec.id);
  }
  let i = 0;
  while (nodes.length < count) {
    let id = `${prefix}${i++}`;
    while (used.has(id)) id = `${prefix}${i++}`;
    nodes.push({ id, neighbors: [] });
    used.add(id);
  }
  return nodes;
}

function connect(a: GraphNode, b: GraphNode): void {
  if (a.id === b.id) return;
  if (!a.neighbors.includes(b.id)) a.neighbors.push(b.id);
  if (!b.neighbors.includes(a.id)) b.neighbors.push(a.id);
}

export function buildGraph(opts: BuildGraphOptions): GraphNode[] {
  const { nodeCount, connectivity, constraints, rng } = opts;
  if (nodeCount <= 0) return [];
  const prefix = opts.idPrefix ?? "n";
  const nodes = makeNodes(nodeCount, prefix, constraints?.mustInclude);
  const minDeg = constraints?.minDegree ?? 0;
  const maxDeg = constraints?.maxDegree ?? Number.POSITIVE_INFINITY;
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const ids = nodes.map((n) => n.id);

  const tryConnect = (aId: string, bId: string): boolean => {
    const a = byId.get(aId)!;
    const b = byId.get(bId)!;
    if (a.neighbors.length >= maxDeg || b.neighbors.length >= maxDeg) return false;
    if (a.neighbors.includes(b.id)) return false;
    connect(a, b);
    return true;
  };

  switch (connectivity) {
    case "ring": {
      for (let i = 0; i < nodes.length; i++) {
        tryConnect(ids[i], ids[(i + 1) % nodes.length]);
      }
      break;
    }
    case "tree": {
      // Spanning tree: each node attaches to a random earlier node.
      const order = rng.shuffle(ids);
      for (let i = 1; i < order.length; i++) {
        const parent = order[rng.range(0, i - 1)];
        tryConnect(order[i], parent);
      }
      break;
    }
    case "mesh": {
      // Tree backbone + ~0.5N extra edges; balanced connectivity.
      const order = rng.shuffle(ids);
      for (let i = 1; i < order.length; i++) {
        tryConnect(order[i], order[rng.range(0, i - 1)]);
      }
      const extras = Math.floor(nodes.length * 0.5);
      for (let i = 0; i < extras; i++) {
        const a = rng.pick(ids);
        const b = rng.pick(ids);
        tryConnect(a, b);
      }
      break;
    }
    case "sparse": {
      // Spanning tree only (= minimum connected graph).
      const order = rng.shuffle(ids);
      for (let i = 1; i < order.length; i++) {
        tryConnect(order[i], order[rng.range(0, i - 1)]);
      }
      break;
    }
    case "dense": {
      // Complete-graph attempt, clipped by maxDegree.
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          tryConnect(ids[i], ids[j]);
        }
      }
      break;
    }
  }

  // Enforce minDegree by adding random edges where needed.
  if (minDeg > 0) {
    for (const n of nodes) {
      let attempts = nodes.length * 2;
      while (n.neighbors.length < minDeg && attempts-- > 0) {
        const other = rng.pick(ids);
        if (other === n.id) continue;
        tryConnect(n.id, other);
      }
    }
  }

  return nodes;
}

export interface BuildGridOptions {
  width: number;
  height: number;
  wrap?: boolean;
  idPrefix?: string;
}

export function buildGrid(opts: BuildGridOptions): GraphNode[] {
  const { width, height, wrap = false } = opts;
  const prefix = opts.idPrefix ?? "g";
  const id = (x: number, y: number) => `${prefix}_${x}_${y}`;
  const nodes: GraphNode[] = [];
  const byId = new Map<string, GraphNode>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const n: GraphNode = { id: id(x, y), neighbors: [] };
      nodes.push(n);
      byId.set(n.id, n);
    }
  }
  const neighbor = (x: number, y: number): GraphNode | undefined => {
    if (wrap) {
      const xx = ((x % width) + width) % width;
      const yy = ((y % height) + height) % height;
      return byId.get(id(xx, yy));
    }
    if (x < 0 || x >= width || y < 0 || y >= height) return undefined;
    return byId.get(id(x, y));
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const here = byId.get(id(x, y))!;
      for (const [dx, dy] of [[1, 0], [0, 1]] as [number, number][]) {
        const other = neighbor(x + dx, y + dy);
        if (other) connect(here, other);
      }
      if (wrap) {
        // Edge-of-grid wrap (already handled when dx=1/dy=1 wraps).
        // Ring edges in width=1 / height=1 are deduped by connect().
      }
    }
  }
  return nodes;
}

// ─── Template instantiation ──────────────────────────────────────────

export type FieldSpec =
  | { kind: "pick"; from: WeightedEntry<unknown>[] }
  | { kind: "range"; min: number; max: number }
  | { kind: "int"; min: number; max: number }
  | { kind: "compose"; from: Template<unknown> }
  | { kind: "literal"; value: unknown };

export interface Template<T> {
  fields: { [K in keyof T]: FieldSpec };
}

function resolveField(spec: FieldSpec, rng: RngStream): unknown {
  switch (spec.kind) {
    case "pick":
      return weightedPick(spec.from, rng);
    case "range":
      return spec.min + rng.float() * (spec.max - spec.min);
    case "int":
      return rng.range(spec.min, spec.max);
    case "compose":
      return instantiate(spec.from, rng);
    case "literal":
      return spec.value;
  }
}

export function instantiate<T>(template: Template<T>, rng: RngStream): T {
  const out: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(template.fields) as [string, FieldSpec][]) {
    out[name] = resolveField(spec, rng);
  }
  return out as T;
}

// ─── Names + identifiers ─────────────────────────────────────────────

/** Stable-shape random id derived from the rng stream. Format: `${prefix}_${hex}`. */
export function randomId(rng: RngStream, prefix = "id"): string {
  const a = rng.next().toString(16).padStart(8, "0");
  const b = rng.next().toString(16).padStart(8, "0");
  return `${prefix}_${a}${b}`;
}

export function pickName(table: readonly string[], rng: RngStream): string {
  if (table.length === 0) throw new Error("pickName: empty table");
  return rng.pick(table);
}
