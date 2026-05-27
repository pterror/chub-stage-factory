/*
 * GraphView3D.tsx — 3D graph layout (nodes + edges in space).
 *
 * WHAT: Renders a graph of `nodes` (positioned spheres) and `edges`
 *       (cylinders between node centers). Layout is consumer-provided —
 *       the component does not run force-directed simulation; pre-compute
 *       node positions (procgen, 3D-force-graph, dagre, etc.) and pass
 *       them in.
 *
 * WHY: 3D variant of the (still pending) 2D GraphView UI primitive. Used
 *      for 3D world.ts room graphs, faction-relation graphs in space,
 *      dialogue trees with depth, family/lineage trees in 3D, etc.
 *
 *      Layout-as-separate-concern keeps the primitive lean and lets
 *      stages pick the layout best matching their data shape (force-dir
 *      for relationships, hierarchical for lineage, hand-positioned for
 *      authored content).
 *
 * Interaction: click a node → onNodeClick(node).
 */

import {Fragment, useMemo, type ReactElement} from "react";
import {Vector3, Quaternion} from "three";
import type {ThreeEvent} from "@react-three/fiber";

export interface GraphNode3D<N> {
  id: string;
  position: [number, number, number];
  data: N;
  /** Sphere radius. Default 0.3. */
  radius?: number;
  color?: string;
}

export interface GraphEdge3D<E> {
  from: string;
  to: string;
  data?: E;
  /** Cylinder radius. Default 0.04. */
  width?: number;
  color?: string;
}

export interface GraphView3DProps<N, E> {
  nodes: GraphNode3D<N>[];
  edges: GraphEdge3D<E>[];
  onNodeClick?: (node: GraphNode3D<N>) => void;
  onNodeHover?: (node: GraphNode3D<N> | null) => void;
}

const DEFAULT_NODE_COLOR = "#3b82f6";
const DEFAULT_EDGE_COLOR = "#666";
const UP = new Vector3(0, 1, 0);

export function GraphView3D<N, E>(props: GraphView3DProps<N, E>): ReactElement {
  const {nodes, edges, onNodeClick, onNodeHover} = props;

  // Lookup map for edge endpoints
  const nodeById = useMemo(() => {
    const m = new Map<string, GraphNode3D<N>>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  return (
    <group>
      {edges.map((edge, i) => {
        const a = nodeById.get(edge.from);
        const b = nodeById.get(edge.to);
        if (!a || !b) return null;

        const pa = new Vector3(...a.position);
        const pb = new Vector3(...b.position);
        const mid = pa.clone().add(pb).multiplyScalar(0.5);
        const dir = pb.clone().sub(pa);
        const len = dir.length();
        if (len < 1e-6) return null;
        dir.normalize();
        // Cylinder is created along Y by default. Rotate Y → dir.
        const quat = new Quaternion().setFromUnitVectors(UP, dir);

        return (
          <mesh
            key={`e:${i}`}
            position={mid.toArray()}
            quaternion={[quat.x, quat.y, quat.z, quat.w]}
          >
            <cylinderGeometry args={[edge.width ?? 0.04, edge.width ?? 0.04, len, 8]} />
            <meshStandardMaterial color={edge.color ?? DEFAULT_EDGE_COLOR} />
          </mesh>
        );
      })}

      {nodes.map((node) => (
        <Fragment key={`n:${node.id}`}>
          <mesh
            position={node.position}
            onClick={
              onNodeClick
                ? (e: ThreeEvent<MouseEvent>) => {
                    e.stopPropagation();
                    onNodeClick(node);
                  }
                : undefined
            }
            onPointerOver={
              onNodeHover
                ? (e: ThreeEvent<PointerEvent>) => {
                    e.stopPropagation();
                    onNodeHover(node);
                  }
                : undefined
            }
            onPointerOut={onNodeHover ? () => onNodeHover(null) : undefined}
          >
            <sphereGeometry args={[node.radius ?? 0.3, 16, 12]} />
            <meshStandardMaterial color={node.color ?? DEFAULT_NODE_COLOR} />
          </mesh>
        </Fragment>
      ))}
    </group>
  );
}
