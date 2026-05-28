/*
 * ui/GraphView.tsx — Nodes + edges; force-directed or fixed layout.
 *
 * WHAT: Renders a graph of `GraphNode` + `GraphEdge` onto an SVG canvas.
 *       Supports two layout modes:
 *         - "force" (default): lightweight spring-charge simulation.
 *         - "fixed": nodes must supply `x`/`y`; no simulation.
 *       Clicking an interactive node invokes `node.verb` with
 *       `{ target: node.id }`. Clicking an interactive edge invokes
 *       `edge.verb` with `{ target: edge.id }`.
 *
 * WHY: Wave 2E Batch B. Intended for world.ts room graphs (rooms as nodes,
 *      exits as edges), faction-relation graphs, dialogue trees, family
 *      trees. Rated L-cost in the design: heaviest leaf in Batch B.
 *
 * Layout algorithm choice: the design leaves it open for the "force" case.
 *   This file ships a zero-dependency, from-scratch Verlet-integration
 *   force simulation suited for the ≤30-node graphs the design targets.
 *   Rationale: d3-force is not in the project's deps and the design doc
 *   explicitly notes "if it brings a heavy transitive, ship a small
 *   from-scratch force impl instead."
 *
 *   Forces applied: repulsion (charge ~1800), attraction along edges
 *   (spring rest-length ~120 px), centering (weak, keeps graph visible).
 *   The simulation runs for a fixed burn-in of 120 ticks on mount/node
 *   change and then freezes — no continuous rAF loop — so the layout is
 *   deterministic and stable after the initial placement. Stage authors
 *   who want animated layout can pass a custom `useForceLayout` via a
 *   future hook slot (not in this wave).
 *
 * SHAPE:
 *   interface GraphNode { id; label?; x?; y?; verb?; data? }
 *   interface GraphEdge { id; source; target; label?; verb?; directed?; data? }
 *   interface GraphViewProps<N, E> extends IntrospectAware {
 *     nodes; edges; layout?; renderNode?; renderEdge?;
 *     onNodeClick?; onEdgeClick?; width?; height?; style?
 *   }
 *   GraphView<N, E>(props): ReactElement
 */

import {
  ReactElement,
  CSSProperties,
  useMemo,
  useEffect,
  useRef,
  useState,
} from "react";
import type { IntrospectAware } from "./introspect-aware";

// ---------------------------------------------------------------------------
// GraphNode / GraphEdge
// ---------------------------------------------------------------------------

export interface GraphNode {
  id: string;
  /** Display label. Shown inside the default renderer. */
  label?: string;
  /** Optional fixed X position (used when `layout === "fixed"`). When both
   *  x and y are provided on all nodes the component auto-selects "fixed". */
  x?: number;
  /** Optional fixed Y position. */
  y?: number;
  /** Verb to invoke on node click. */
  verb?: string;
  /** Free-form data the custom renderer may use. */
  data?: unknown;
}

export interface GraphEdge {
  id: string;
  /** Source node id. */
  source: string;
  /** Target node id. */
  target: string;
  /** Optional display label drawn at the edge midpoint. */
  label?: string;
  /** Verb to invoke on edge click. */
  verb?: string;
  /** When true, the edge renders an arrowhead at the target end. Default false. */
  directed?: boolean;
  /** Free-form data the custom renderer may use. */
  data?: unknown;
}

// ---------------------------------------------------------------------------
// GraphViewProps
// ---------------------------------------------------------------------------

export interface GraphViewProps<N extends GraphNode, E extends GraphEdge>
  extends IntrospectAware {
  nodes: N[];
  edges: E[];
  /** Layout mode. "force" (default) runs the built-in spring simulation.
   *  "fixed" requires all nodes to have x/y; no simulation is run.
   *  When "force" is selected but all nodes carry x/y, the component
   *  short-circuits to fixed layout. */
  layout?: "force" | "fixed";
  /** Custom node renderer. Rendered into an SVG `<foreignObject>` centred
   *  on the node. When omitted a default box-with-label is used. */
  renderNode?: (node: N, interactive: boolean) => ReactElement;
  /** Custom edge renderer. Receives the edge and an `interactive` flag. The
   *  default renders a plain line with an optional arrowhead. */
  renderEdge?: (edge: E, interactive: boolean) => ReactElement;
  onNodeClick?: (node: N) => void;
  onEdgeClick?: (edge: E) => void;
  /** SVG canvas width in px. Default 400. */
  width?: number;
  /** SVG canvas height in px. Default 300. */
  height?: number;
  style?: CSSProperties;
}

// ---------------------------------------------------------------------------
// Force simulation (from-scratch, no deps)
//
// Algorithm: Verlet integration. Each tick:
//   1. Apply repulsion (O(n²) — fine for n≤30).
//   2. Apply spring attraction along edges.
//   3. Apply weak centering force.
//   4. Damp velocities.
//   5. Clamp to canvas.
// ---------------------------------------------------------------------------

interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const REPULSION = 1800;
const SPRING_LENGTH = 120;
const SPRING_K = 0.04;
const CENTER_K = 0.008;
const DAMPING = 0.85;
const BURN_IN_TICKS = 120;

function runSimulation(
  nodes: SimNode[],
  edges: Array<{ source: string; target: string }>,
  width: number,
  height: number,
  ticks: number,
): void {
  const idxOf = new Map<string, number>(nodes.map((n, i) => [n.id, i]));
  const cx = width / 2;
  const cy = height / 2;

  for (let t = 0; t < ticks; t++) {
    // 1. Repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy || 0.01;
        const d = Math.sqrt(d2);
        const force = REPULSION / d2;
        const fx = (force * dx) / d;
        const fy = (force * dy) / d;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // 2. Spring attraction
    for (const edge of edges) {
      const si = idxOf.get(edge.source);
      const ti = idxOf.get(edge.target);
      if (si == null || ti == null) continue;
      const a = nodes[si]!;
      const b = nodes[ti]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const stretch = d - SPRING_LENGTH;
      const fx = SPRING_K * stretch * (dx / d);
      const fy = SPRING_K * stretch * (dy / d);
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // 3. Centering
    for (const n of nodes) {
      n.vx += CENTER_K * (cx - n.x);
      n.vy += CENTER_K * (cy - n.y);
    }

    // 4. Integrate + damp
    for (const n of nodes) {
      n.vx *= DAMPING;
      n.vy *= DAMPING;
      n.x += n.vx;
      n.y += n.vy;
      // 5. Clamp
      n.x = Math.max(30, Math.min(width - 30, n.x));
      n.y = Math.max(20, Math.min(height - 20, n.y));
    }
  }
}

/** Initialise positions with jittered circle layout so repulsion spreads them. */
function initPositions(
  nodes: GraphNode[],
  width: number,
  height: number,
): SimNode[] {
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) * 0.35;
  return nodes.map((n, i) => {
    if (n.x != null && n.y != null) {
      return { id: n.id, x: n.x, y: n.y, vx: 0, vy: 0 };
    }
    const angle = (2 * Math.PI * i) / nodes.length;
    return {
      id: n.id,
      x: cx + r * Math.cos(angle) + (Math.random() - 0.5) * 20,
      y: cy + r * Math.sin(angle) + (Math.random() - 0.5) * 20,
      vx: 0,
      vy: 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Default renderers
// ---------------------------------------------------------------------------

const DEFAULT_NODE_W = 64;
const DEFAULT_NODE_H = 28;

function DefaultNode({ label, interactive }: { label?: string; interactive: boolean }): ReactElement {
  return (
    <div
      style={{
        width: DEFAULT_NODE_W,
        height: DEFAULT_NODE_H,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "ui-monospace, monospace",
        fontSize: 11,
        background: interactive ? "rgba(100,200,100,0.18)" : "rgba(255,255,255,0.08)",
        border: `1px solid ${interactive ? "rgba(100,200,100,0.5)" : "rgba(255,255,255,0.18)"}`,
        borderRadius: 3,
        color: interactive ? "#9f9" : "#bbb",
        cursor: interactive ? "pointer" : "default",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        padding: "0 4px",
        boxSizing: "border-box",
      }}
    >
      {label ?? ""}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GraphView<N extends GraphNode, E extends GraphEdge>(
  props: GraphViewProps<N, E>,
): ReactElement {
  const {
    nodes,
    edges,
    layout = "force",
    renderNode,
    renderEdge,
    onNodeClick,
    onEdgeClick,
    availableVerbs,
    onVerbInvoke,
    verbFilter,
    pending = false,
    width = 400,
    height = 300,
    style,
  } = props;

  // Enabled verb set.
  const enabledVerbs = useMemo<Set<string>>(() => {
    if (!availableVerbs) return new Set();
    const verbs = verbFilter ? availableVerbs.filter(verbFilter) : availableVerbs;
    return new Set(
      verbs.filter((v) => v.enabled !== false).map((v) => v.name),
    );
  }, [availableVerbs, verbFilter]);

  // Detect whether all nodes have fixed coords — if so skip simulation.
  const allFixed = useMemo(
    () =>
      nodes.length > 0 &&
      nodes.every((n) => n.x != null && n.y != null),
    [nodes],
  );
  const effectiveLayout = allFixed ? "fixed" : layout;

  // Compute positions. For "force" we run the simulation once on mount
  // and whenever nodes/edges change (re-keyed by node id set).
  const nodeKey = nodes.map((n) => n.id).join(",");
  const edgeKey = edges.map((e) => e.id).join(",");

  // Mutable ref holds sim nodes; state holds the committed positions.
  const simRef = useRef<SimNode[]>([]);
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());

  useEffect(() => {
    if (effectiveLayout === "fixed") {
      const m = new Map<string, { x: number; y: number }>();
      for (const n of nodes) {
        m.set(n.id, { x: n.x ?? width / 2, y: n.y ?? height / 2 });
      }
      setPositions(m);
      return;
    }

    // Force layout — run burn-in.
    simRef.current = initPositions(nodes, width, height);
    runSimulation(simRef.current, edges, width, height, BURN_IN_TICKS);
    const m = new Map<string, { x: number; y: number }>();
    for (const sn of simRef.current) m.set(sn.id, { x: sn.x, y: sn.y });
    setPositions(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveLayout, nodeKey, edgeKey, width, height]);

  // Build edge path data.
  const edgeElements = edges.map((edge) => {
    const sp = positions.get(edge.source);
    const tp = positions.get(edge.target);
    if (!sp || !tp) return null;

    const verbName = edge.verb;
    const interactive =
      !pending && verbName != null && enabledVerbs.has(verbName);

    const mx = (sp.x + tp.x) / 2;
    const my = (sp.y + tp.y) / 2;

    const handleEdgeClick = () => {
      if (!interactive) return;
      if (onEdgeClick) { onEdgeClick(edge); return; }
      if (onVerbInvoke && edge.verb) {
        void onVerbInvoke(edge.verb, { target: edge.id });
      }
    };

    // Arrowhead direction vector (for directed edges)
    const dx = tp.x - sp.x;
    const dy = tp.y - sp.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = dx / d;
    const ny = dy / d;
    // Offset end point so the arrowhead tip sits at node edge (approx).
    const endX = tp.x - nx * (DEFAULT_NODE_W / 2 + 4);
    const endY = tp.y - ny * (DEFAULT_NODE_H / 2 + 4);
    const arrowSize = 8;

    // When a custom edge renderer is supplied, defer the visible geometry to
    // it (still wrapped in the clickable <g>, with a transparent hit line so
    // bridged-mode clicks keep working). Otherwise render the default line +
    // arrowhead + label.
    if (renderEdge) {
      return (
        <g
          key={edge.id}
          onClick={interactive ? handleEdgeClick : undefined}
          style={{ cursor: interactive ? "pointer" : "default" }}
        >
          {renderEdge(edge, interactive)}
          {interactive && (
            <line
              x1={sp.x}
              y1={sp.y}
              x2={endX}
              y2={endY}
              stroke="transparent"
              strokeWidth={10}
            />
          )}
        </g>
      );
    }

    return (
      <g
        key={edge.id}
        onClick={interactive ? handleEdgeClick : undefined}
        style={{ cursor: interactive ? "pointer" : "default" }}
      >
        <line
          x1={sp.x}
          y1={sp.y}
          x2={endX}
          y2={endY}
          stroke={interactive ? "rgba(100,200,100,0.5)" : "rgba(255,255,255,0.2)"}
          strokeWidth={interactive ? 2 : 1.5}
        />
        {/* Transparent wider line for easier clicking */}
        {interactive && (
          <line
            x1={sp.x}
            y1={sp.y}
            x2={endX}
            y2={endY}
            stroke="transparent"
            strokeWidth={10}
          />
        )}
        {edge.directed && (
          <polygon
            points={[
              `${endX},${endY}`,
              `${endX - arrowSize * nx + arrowSize * 0.5 * ny},${endY - arrowSize * ny - arrowSize * 0.5 * nx}`,
              `${endX - arrowSize * nx - arrowSize * 0.5 * ny},${endY - arrowSize * ny + arrowSize * 0.5 * nx}`,
            ].join(" ")}
            fill={interactive ? "rgba(100,200,100,0.5)" : "rgba(255,255,255,0.2)"}
          />
        )}
        {edge.label && (
          <text
            x={mx}
            y={my - 4}
            textAnchor="middle"
            fontSize={10}
            fill="rgba(255,255,255,0.45)"
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            {edge.label}
          </text>
        )}
      </g>
    );
  });

  // Build node elements.
  const nodeElements = nodes.map((node) => {
    const pos = positions.get(node.id);
    if (!pos) return null;

    const verbName = node.verb;
    const interactive =
      !pending && verbName != null && enabledVerbs.has(verbName);

    const handleNodeClick = () => {
      if (!interactive) return;
      if (onNodeClick) { onNodeClick(node); return; }
      if (onVerbInvoke && node.verb) {
        void onVerbInvoke(node.verb, { target: node.id });
      }
    };

    const hw = DEFAULT_NODE_W / 2;
    const hh = DEFAULT_NODE_H / 2;

    return (
      <g
        key={node.id}
        onClick={interactive ? handleNodeClick : undefined}
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        onKeyDown={
          interactive
            ? (e) => { if (e.key === "Enter" || e.key === " ") handleNodeClick(); }
            : undefined
        }
        style={{ cursor: interactive ? "pointer" : "default" }}
      >
        <foreignObject
          x={pos.x - hw}
          y={pos.y - hh}
          width={DEFAULT_NODE_W}
          height={DEFAULT_NODE_H}
          style={{ overflow: "visible", pointerEvents: "none" }}
        >
          <div
            // @ts-expect-error — xmlns is valid in SVG foreignObject
            xmlns="http://www.w3.org/1999/xhtml"
            style={{ width: "100%", height: "100%" }}
          >
            {renderNode
              ? renderNode(node, interactive)
              : <DefaultNode label={node.label ?? node.id} interactive={interactive} />}
          </div>
        </foreignObject>
        {/* Transparent click target over the node box */}
        <rect
          x={pos.x - hw}
          y={pos.y - hh}
          width={DEFAULT_NODE_W}
          height={DEFAULT_NODE_H}
          fill="transparent"
        >
          {interactive && node.verb && <title>{node.verb}</title>}
        </rect>
      </g>
    );
  });

  return (
    <svg
      style={{ display: "block", overflow: "visible", ...style }}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      {/* Arrowhead marker def for directed edges */}
      <defs>
        <marker
          id="gv-arrow"
          markerWidth="6"
          markerHeight="6"
          refX="3"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L6,3 L0,6 Z" fill="rgba(255,255,255,0.3)" />
        </marker>
      </defs>
      <g className="gv-edges">{edgeElements}</g>
      <g className="gv-nodes">{nodeElements}</g>
    </svg>
  );
}

export default GraphView;
