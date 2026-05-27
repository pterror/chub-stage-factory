/*
 * patterns/lineage.ts — procgen.buildGraph + Actor.affinity for parent-child
 *                        + graph queries. Enables Breeding-sim (#18).
 *
 * WHAT: `lineagePattern(init)` wires a directed lineage graph over an
 *       `ActorPool`. Parent-child edges are stored both in the graph and as
 *       `Actor.affinity` entries (tag `"parent"` direction). The bundle
 *       exposes:
 *         - `addChild(parentId, childActor)` — register a new offspring and
 *           record the parent-child edge in both graph and affinity.
 *         - `parentsOf(id)` — ids of direct parents.
 *         - `childrenOf(id)` — ids of direct children.
 *         - `ancestorsOf(id)` — all ancestors via BFS.
 *         - `descendantsOf(id)` — all descendants via BFS.
 *         - `commonAncestors(a, b)` — shared ancestors (inbreeding check).
 *         - `inbreedingCoefficient(a, b)` — proportion of shared ancestors
 *           over total distinct ancestors of both actors.
 *         - `buildFounderGraph(opts)` — calls `procgen.buildGraph` to
 *           generate a founder graph; each node becomes an Actor via
 *           `actorFromNode`. The graph starts with this generation.
 *
 *       Composes: `procgen.buildGraph` + `ActorPool` + `Actor.affinity`.
 *
 * WHY: ROADMAP lineagePattern spec: "composer over `procgen.buildGraph`
 *      (tree connectivity) + Actor.affinity-with-'parent'-tag for
 *      parent-child relationships. Operations like 'list descendants,'
 *      'find common ancestor,' 'compute inbreeding coefficient' fall out as
 *      graph queries." This file is that composer. No new primitives — the
 *      graph lives in ActorPool + affinity; procgen supplies the topology.
 *
 * SHAPE:
 *   interface LineageBundleInit
 *     { pool: ActorPool;
 *       actorFromNode?: (node: GraphNode, rng: RngStream) => Actor }
 *   interface LineageBundle
 *     { pool; graph: Map<ActorId, Set<ActorId>>;
 *       addChild(parentId, child): void;
 *       parentsOf(id): ActorId[];
 *       childrenOf(id): ActorId[];
 *       ancestorsOf(id): ActorId[];
 *       descendantsOf(id): ActorId[];
 *       commonAncestors(a, b): ActorId[];
 *       inbreedingCoefficient(a, b): number;
 *       buildFounderGraph(opts): Actor[] }
 *   function lineagePattern(init): LineageBundle
 */

import { type ActorId, ActorPool, type Actor } from "../actor";
import { buildGraph, type BuildGraphOptions, type GraphNode } from "../procgen";
import type { RngStream } from "../rng";

/** Affinity key used for parent→child direction on Actor.affinity. */
const PARENT_AFFINITY_KEY = "__lineage_parent__";

export interface LineageBundleInit {
  pool: ActorPool;
  /**
   * Converts a `GraphNode` from `buildFounderGraph` into an `Actor`.
   * Required if you call `buildFounderGraph`; optional otherwise.
   */
  actorFromNode?: (node: GraphNode, rng: RngStream) => Actor;
}

export interface LineageBundle {
  pool: ActorPool;
  /**
   * Adjacency map: parent → Set<child ids>. Kept in sync with `addChild`.
   * Read-only by convention; mutate via `addChild` only.
   */
  graph: Map<ActorId, Set<ActorId>>;
  /** Register `child` in the pool and record the parent-child edge. */
  addChild(parentId: ActorId, child: Actor): void;
  /** Direct parent ids. May be 0 (founder), 1, or 2 for sexual reproduction. */
  parentsOf(id: ActorId): ActorId[];
  /** Direct child ids. */
  childrenOf(id: ActorId): ActorId[];
  /** All ancestors (BFS); excludes the actor itself. */
  ancestorsOf(id: ActorId): ActorId[];
  /** All descendants (BFS); excludes the actor itself. */
  descendantsOf(id: ActorId): ActorId[];
  /** Ids present in both ancestor sets of `a` and `b`. */
  commonAncestors(a: ActorId, b: ActorId): ActorId[];
  /**
   * |common ancestors| / |union of all ancestors|.
   * Returns 0 when either has no ancestors (both are founders).
   */
  inbreedingCoefficient(a: ActorId, b: ActorId): number;
  /**
   * Generate a founder-generation actor set from `procgen.buildGraph`.
   * Requires `actorFromNode` to have been supplied at construction.
   * Adds actors to `pool` and initialises the graph edges from the topology.
   */
  buildFounderGraph(
    opts: Omit<BuildGraphOptions, "rng"> & { rng: RngStream },
  ): Actor[];
}

export function lineagePattern(init: LineageBundleInit): LineageBundle {
  const pool = init.pool;
  // parent → children
  const graph = new Map<ActorId, Set<ActorId>>();
  // child → parents (reverse)
  const parentMap = new Map<ActorId, Set<ActorId>>();

  function ensureNode(id: ActorId): void {
    if (!graph.has(id)) graph.set(id, new Set());
    if (!parentMap.has(id)) parentMap.set(id, new Set());
  }

  function bfs(start: ActorId, next: (id: ActorId) => Iterable<ActorId>): ActorId[] {
    const visited = new Set<ActorId>();
    const queue = [start];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const n of next(cur)) {
        if (!visited.has(n)) {
          visited.add(n);
          queue.push(n);
        }
      }
    }
    visited.delete(start);
    return [...visited];
  }

  return {
    pool,
    graph,
    addChild(parentId: ActorId, child: Actor): void {
      pool.add(child);
      ensureNode(parentId);
      ensureNode(child.id);
      graph.get(parentId)!.add(child.id);
      parentMap.get(child.id)!.add(parentId);
      // Record on Actor.affinity so it's serializable.
      const parent = pool.get(parentId);
      if (parent) {
        // positive affinity = "is parent of"
        parent.affinity.set(PARENT_AFFINITY_KEY + child.id, 1);
      }
    },
    parentsOf(id: ActorId): ActorId[] {
      return [...(parentMap.get(id) ?? [])];
    },
    childrenOf(id: ActorId): ActorId[] {
      return [...(graph.get(id) ?? [])];
    },
    ancestorsOf(id: ActorId): ActorId[] {
      return bfs(id, (cur) => parentMap.get(cur) ?? []);
    },
    descendantsOf(id: ActorId): ActorId[] {
      return bfs(id, (cur) => graph.get(cur) ?? []);
    },
    commonAncestors(a: ActorId, b: ActorId): ActorId[] {
      const setA = new Set(bfs(a, (cur) => parentMap.get(cur) ?? []));
      return bfs(b, (cur) => parentMap.get(cur) ?? []).filter((id) => setA.has(id));
    },
    inbreedingCoefficient(a: ActorId, b: ActorId): number {
      const ancsA = new Set(bfs(a, (cur) => parentMap.get(cur) ?? []));
      const ancsB = new Set(bfs(b, (cur) => parentMap.get(cur) ?? []));
      if (ancsA.size === 0 && ancsB.size === 0) return 0;
      const union = new Set([...ancsA, ...ancsB]);
      let shared = 0;
      for (const id of ancsA) if (ancsB.has(id)) shared++;
      return shared / union.size;
    },
    buildFounderGraph(opts): Actor[] {
      if (!init.actorFromNode) {
        throw new Error("lineagePattern: actorFromNode is required to call buildFounderGraph");
      }
      const nodes = buildGraph(opts);
      const actors: Actor[] = [];
      for (const node of nodes) {
        const actor = init.actorFromNode(node, opts.rng);
        pool.add(actor);
        ensureNode(actor.id);
        actors.push(actor);
      }
      // Wire topology edges from the graph as sibling/cohort affinity (not parent-child).
      // Founder generation has no parents; topology edges are peer relationships.
      for (const node of nodes) {
        const actor = pool.get(node.id);
        if (!actor) continue;
        for (const neighborId of node.neighbors) {
          actor.affinity.set(neighborId, (actor.affinity.get(neighborId) ?? 0) + 0.5);
        }
      }
      return actors;
    },
  };
}
