/**
 * voronoi-influence-map.tsx — VoronoiInfluenceMap<E> UI primitive.
 *
 * Renders a weighted Voronoi diagram where each entity's influence radius
 * determines its territory. The final cell shape is the entity's circle
 * polygon clipped to its power-diagram Voronoi cell — circles bleed up to
 * their radius, then the Voronoi boundary becomes the dividing line.
 *
 * Animation pipeline (three-stage rAF loop):
 *   Stage 1 — targetPoints: raw entities (updates on props change only)
 *   Stage 2 — animatedPoints: cubic-ease entry lerp + hover radius boost
 *   Stage 3 — pulsedPoints: per-entity sine-wave radius modulation
 *
 * Hover hit-testing: ray-cast (isPointInsidePolygon) with 26px fallback
 * for touch-target safety near thin cells.
 *
 * Optional expand transition: lerps a single cell to fill the viewport
 * (520ms cubic-ease), fades all others.
 */

import {
  useRef,
  useEffect,
  useCallback,
  useState,
  type ReactNode,
  type PointerEvent,
} from "react";
import { weightedVoronoi } from "d3-weighted-voronoi";
import {
  type Polygon,
  createCirclePolygon,
  clipPolygonWithConvex,
  isPointInsidePolygon,
  toPolygonPath,
  hashPhase,
  lerp,
  cubicEase,
} from "./voronoi-utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { Polygon };

export interface VoronoiEntity<E> {
  id: string;
  x: number;
  y: number;
  radius: number;
  data: E;
  themeColor?: string;
  imageUrl?: string;
}

export interface VoronoiInfluenceMapProps<E> {
  entities: VoronoiEntity<E>[];
  viewBox?: { width: number; height: number };
  segments?: number;
  animations?: {
    pulse?: boolean | { period: number; amplitude: number };
    hoverBoost?: boolean | { boostPx: number; durationMs: number };
    entryLerp?: boolean | { durationMs: number };
  };
  onEntityClick?: (e: VoronoiEntity<E>) => void;
  onEntityHover?: (e: VoronoiEntity<E> | null) => void;
  onEntityActivate?: (e: VoronoiEntity<E>) => void;
  onEntityDeactivate?: () => void;
  renderCell?: (e: VoronoiEntity<E>, polygon: Polygon) => ReactNode;
}

// Internal animated state per entity
interface AnimatedEntity<E> {
  entity: VoronoiEntity<E>;
  x: number;
  y: number;
  radius: number;
  entryProgress: number; // 0 → 1 over entryLerp.durationMs
  hoverIntensity: number; // 0 → 1 over hoverBoost.durationMs
}

// Expand-transition state
interface ExpandState {
  entityId: string;
  startTime: number;
  progress: number; // 0 → 1
  reversing: boolean;
}

// d3-weighted-voronoi site type
interface WVSite {
  x: number;
  y: number;
  weight: number;
  _idx: number; // attached so we can map output polygons back to inputs
}

// ---------------------------------------------------------------------------
// Config defaults
// ---------------------------------------------------------------------------

const DEFAULT_WIDTH = 1000;
const DEFAULT_HEIGHT = 700;
const DEFAULT_SEGMENTS = 32;
const DEFAULT_PULSE_PERIOD = 3000;
const DEFAULT_PULSE_AMPLITUDE = 4;
const DEFAULT_HOVER_BOOST_PX = 30;
const DEFAULT_HOVER_DURATION_MS = 240;
const DEFAULT_ENTRY_DURATION_MS = 700;
const DEFAULT_EXPAND_DURATION_MS = 520;
const TOUCH_FALLBACK_RADIUS = 26;
const RAF_SETTLE_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VoronoiInfluenceMap<E>(
  props: VoronoiInfluenceMapProps<E>,
): ReactNode {
  const {
    entities,
    viewBox = { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
    segments = DEFAULT_SEGMENTS,
    animations = {},
    onEntityClick,
    onEntityHover,
    onEntityActivate,
    onEntityDeactivate,
    renderCell,
  } = props;

  const svgRef = useRef<SVGSVGElement>(null);
  const rafRef = useRef<number | null>(null);
  const prevTimeRef = useRef<number | null>(null);
  const animatedRef = useRef<Map<string, AnimatedEntity<E>>>(new Map());
  const hoveredIdRef = useRef<string | null>(null);
  const expandRef = useRef<ExpandState | null>(null);
  const [renderTick, setRenderTick] = useState(0);

  // Parse animation config
  const pulseEnabled = animations.pulse !== false;
  const pulseConfig = typeof animations.pulse === "object"
    ? animations.pulse
    : { period: DEFAULT_PULSE_PERIOD, amplitude: DEFAULT_PULSE_AMPLITUDE };
  const hoverEnabled = animations.hoverBoost !== false;
  const hoverConfig = typeof animations.hoverBoost === "object"
    ? animations.hoverBoost
    : { boostPx: DEFAULT_HOVER_BOOST_PX, durationMs: DEFAULT_HOVER_DURATION_MS };
  const entryEnabled = animations.entryLerp !== false;
  const entryConfig = typeof animations.entryLerp === "object"
    ? animations.entryLerp
    : { durationMs: DEFAULT_ENTRY_DURATION_MS };

  // Sync entity targets into animatedRef on prop change
  useEffect(() => {
    const map = animatedRef.current;
    const incoming = new Set(entities.map((e) => e.id));

    // Add or update
    for (const entity of entities) {
      if (!map.has(entity.id)) {
        map.set(entity.id, {
          entity,
          x: entity.x,
          y: entity.y,
          radius: entryEnabled ? 0 : entity.radius,
          entryProgress: entryEnabled ? 0 : 1,
          hoverIntensity: 0,
        });
      } else {
        const a = map.get(entity.id)!;
        a.entity = entity;
      }
    }

    // Remove departed
    for (const id of map.keys()) {
      if (!incoming.has(id)) map.delete(id);
    }
  }, [entities, entryEnabled]);

  // rAF loop
  const tick = useCallback(
    (now: number) => {
      const dt = prevTimeRef.current != null ? now - prevTimeRef.current : 16;
      prevTimeRef.current = now;
      const map = animatedRef.current;
      const t = now; // absolute time in ms for sine waves

      let anyMotion = false;

      for (const [id, a] of map.entries()) {
        const target = a.entity;
        const isHovered = hoveredIdRef.current === id;

        // --- Entry lerp ---
        if (a.entryProgress < 1) {
          a.entryProgress = Math.min(
            1,
            a.entryProgress + dt / entryConfig.durationMs,
          );
          anyMotion = true;
        }
        const easedEntry = cubicEase(a.entryProgress);
        a.radius = lerp(0, target.radius, easedEntry);
        a.x = lerp(0, target.x, easedEntry);
        a.y = lerp(0, target.y, easedEntry);

        // After entry: snap to target
        if (a.entryProgress >= 1) {
          a.x = target.x;
          a.y = target.y;
          a.radius = target.radius;
        }

        // --- Hover intensity lerp ---
        const hoverTarget = isHovered ? 1 : 0;
        const hoverDelta = dt / hoverConfig.durationMs;
        if (Math.abs(a.hoverIntensity - hoverTarget) > 0.01) {
          a.hoverIntensity = isHovered
            ? Math.min(1, a.hoverIntensity + hoverDelta)
            : Math.max(0, a.hoverIntensity - hoverDelta);
          anyMotion = true;
        } else {
          a.hoverIntensity = hoverTarget;
        }
      }

      // Pulse is always "motion" when enabled
      if (pulseEnabled) anyMotion = true;

      // Expand transition
      const expand = expandRef.current;
      if (expand) {
        const elapsed = now - expand.startTime;
        const raw = Math.min(1, elapsed / DEFAULT_EXPAND_DURATION_MS);
        expand.progress = expand.reversing ? 1 - raw : raw;
        if (raw >= 1) {
          if (expand.reversing) expandRef.current = null;
        }
        anyMotion = true;
      }

      // Trigger re-render
      setRenderTick((n) => n + 1);

      // Continue loop or settle
      if (anyMotion && document.visibilityState !== "hidden") {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        prevTimeRef.current = null;
      }
    },
    [entryConfig, hoverConfig, pulseEnabled],
  );

  // Start/restart rAF when deps or entities change
  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    prevTimeRef.current = null;
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [tick, entities]);

  // Visibility change — pause/resume
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "hidden") {
        if (!rafRef.current) {
          prevTimeRef.current = null;
          rafRef.current = requestAnimationFrame(tick);
        }
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [tick]);

  // Build pulsed points for current frame
  const now = performance.now();
  const animatedEntries = Array.from(animatedRef.current.values());

  const pulsedPoints = animatedEntries.map((a) => {
    let pulsedRadius = a.radius;
    if (pulseEnabled && a.entryProgress >= 1) {
      const phase = hashPhase(a.entity.id);
      pulsedRadius +=
        pulseConfig.amplitude *
        Math.sin((2 * Math.PI * now) / pulseConfig.period + phase * 2 * Math.PI);
    }
    if (hoverEnabled) {
      pulsedRadius += a.hoverIntensity * hoverConfig.boostPx;
    }
    return { ...a, pulsedRadius: Math.max(1, pulsedRadius) };
  });

  // Build Voronoi polygons
  // Build sites with index attached for output-to-input mapping
  const sites: WVSite[] = pulsedPoints.map((p, i) => ({
    x: p.x,
    y: p.y,
    weight: p.pulsedRadius * p.pulsedRadius,
    _idx: i,
  }));

  let voronoiPolygons: (Polygon | null)[] = pulsedPoints.map(() => null);

  if (sites.length > 0) {
    try {
      // d3-weighted-voronoi returns an array of polygon arrays (not index-aligned
      // with input). Each polygon has a `.site` property whose `.originalObject.orig`
      // is the original datum we passed in (which carries `_idx`).
      const rawPolygons = weightedVoronoi<WVSite>()
        .x((d) => d.x)
        .y((d) => d.y)
        .weight((d) => d.weight)
        .clip([
          [0, 0],
          [viewBox.width, 0],
          [viewBox.width, viewBox.height],
          [0, viewBox.height],
        ])(sites);

      for (const rawPoly of rawPolygons) {
        // Recover the input index via the datum's `_idx` field.
        // site.originalObject is the input WVSite datum.
        const idx = rawPoly.site?.originalObject?._idx;
        if (idx == null || idx < 0 || idx >= pulsedPoints.length) continue;
        const p = pulsedPoints[idx];
        if (!p || rawPoly.length < 3) continue;
        const circlePoly = createCirclePolygon(p.x, p.y, p.pulsedRadius, segments);
        const clipped = clipPolygonWithConvex(circlePoly, rawPoly as Polygon);
        voronoiPolygons[idx] = clipped.length >= 3 ? clipped : null;
      }
    } catch {
      // Degenerate diagram (all points identical, etc.) — skip frame
    }
  }

  // Pointer handling
  const svgToLogical = useCallback(
    (clientX: number, clientY: number): [number, number] => {
      const svg = svgRef.current;
      if (!svg) return [clientX, clientY];
      const rect = svg.getBoundingClientRect();
      const sx = viewBox.width / rect.width;
      const sy = viewBox.height / rect.height;
      return [(clientX - rect.left) * sx, (clientY - rect.top) * sy];
    },
    [viewBox],
  );

  const handlePointerMove = useCallback(
    (ev: PointerEvent<SVGSVGElement>) => {
      const [lx, ly] = svgToLogical(ev.clientX, ev.clientY);

      // Tier 1: ray-cast
      let hit: string | null = null;
      for (let i = 0; i < voronoiPolygons.length; i++) {
        const poly = voronoiPolygons[i];
        if (poly && isPointInsidePolygon(lx, ly, poly)) {
          hit = pulsedPoints[i]?.entity.id ?? null;
          break;
        }
      }

      // Tier 2: nearest seed within 26px fallback
      if (!hit) {
        let best = TOUCH_FALLBACK_RADIUS * TOUCH_FALLBACK_RADIUS;
        for (const p of pulsedPoints) {
          const dx = p.x - lx, dy = p.y - ly;
          const d2 = dx * dx + dy * dy;
          if (d2 < best) {
            best = d2;
            hit = p.entity.id;
          }
        }
      }

      if (hit !== hoveredIdRef.current) {
        hoveredIdRef.current = hit;
        const entity = hit
          ? animatedRef.current.get(hit)?.entity ?? null
          : null;
        onEntityHover?.(entity);
        if (!rafRef.current) {
          prevTimeRef.current = null;
          rafRef.current = requestAnimationFrame(tick);
        }
      }
    },
    [voronoiPolygons, pulsedPoints, svgToLogical, onEntityHover, tick],
  );

  const handlePointerLeave = useCallback(() => {
    if (hoveredIdRef.current !== null) {
      hoveredIdRef.current = null;
      onEntityHover?.(null);
      if (!rafRef.current) {
        prevTimeRef.current = null;
        rafRef.current = requestAnimationFrame(tick);
      }
    }
  }, [onEntityHover, tick]);

  const handleClick = useCallback(
    (ev: React.MouseEvent<SVGSVGElement>) => {
      const [lx, ly] = svgToLogical(ev.clientX, ev.clientY);
      let hit: VoronoiEntity<E> | null = null;

      for (let i = 0; i < voronoiPolygons.length; i++) {
        const poly = voronoiPolygons[i];
        if (poly && isPointInsidePolygon(lx, ly, poly)) {
          hit = pulsedPoints[i]?.entity ?? null;
          break;
        }
      }

      if (!hit) {
        let best = TOUCH_FALLBACK_RADIUS * TOUCH_FALLBACK_RADIUS;
        for (const p of pulsedPoints) {
          const dx = p.x - lx, dy = p.y - ly;
          const d2 = dx * dx + dy * dy;
          if (d2 < best) {
            best = d2;
            hit = p.entity;
          }
        }
      }

      if (hit) {
        onEntityClick?.(hit);
        if (onEntityActivate) {
          expandRef.current = {
            entityId: hit.id,
            startTime: performance.now(),
            progress: 0,
            reversing: false,
          };
          onEntityActivate(hit);
          if (!rafRef.current) {
            prevTimeRef.current = null;
            rafRef.current = requestAnimationFrame(tick);
          }
        }
      }
    },
    [voronoiPolygons, pulsedPoints, svgToLogical, onEntityClick, onEntityActivate, tick],
  );

  // Expand-transition derived state
  const expand = expandRef.current;
  const expandEntityId = expand?.entityId ?? null;
  const expandProgress = expand ? cubicEase(Math.min(1, expand.progress)) : 0;

  // Suppress TS unused-var warning for renderTick — it drives re-renders
  void renderTick;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
      style={{ width: "100%", height: "100%", overflow: "hidden" }}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onClick={handleClick}
    >
      <defs>
        {pulsedPoints.map((p, i) => {
          const poly = voronoiPolygons[i];
          if (!poly || !p.entity.imageUrl) return null;
          const pathId = `vci-clip-${p.entity.id}`;
          return (
            <clipPath key={pathId} id={pathId}>
              <path d={toPolygonPath(poly)} />
            </clipPath>
          );
        })}
      </defs>

      {pulsedPoints.map((p, i) => {
        const poly = voronoiPolygons[i];
        if (!poly) return null;

        const id = p.entity.id;
        const isExpanding = expandEntityId === id;
        const isOther = expandEntityId !== null && expandEntityId !== id;

        // Compute opacity for expand transition
        const opacity = isOther ? 1 - expandProgress : 1;

        // Compute scale/translate for expanding cell
        let transform: string | undefined;
        if (isExpanding && expandProgress > 0) {
          // Lerp from cell center to viewport center, scale to fill
          const cx = p.x, cy = p.y;
          const vcx = viewBox.width / 2, vcy = viewBox.height / 2;
          const tx = lerp(0, vcx - cx, expandProgress);
          const ty = lerp(0, vcy - cy, expandProgress);
          // Scale so bounding box fills viewport — simplified: scale by progress
          const scale = lerp(1, Math.max(viewBox.width, viewBox.height) / (p.pulsedRadius * 2), expandProgress);
          transform = `translate(${tx} ${ty}) scale(${scale}) translate(${-cx + cx / scale} ${-cy + cy / scale})`;
        }

        const pathD = toPolygonPath(poly);
        const color = p.entity.themeColor ?? "#6366f1";
        const isHovered = hoveredIdRef.current === id;

        if (renderCell) {
          return (
            <g
              key={id}
              opacity={opacity}
              transform={transform}
              style={{ transition: "none" }}
            >
              {renderCell(p.entity, poly)}
            </g>
          );
        }

        return (
          <g
            key={id}
            opacity={opacity}
            transform={transform}
            style={{ cursor: "pointer" }}
          >
            {/* Cell fill */}
            <path
              d={pathD}
              fill={color}
              fillOpacity={isHovered ? 0.55 : 0.35}
              stroke={color}
              strokeWidth={isHovered ? 2.5 : 1.5}
              strokeOpacity={0.85}
              style={{ filter: isHovered ? `drop-shadow(0 0 6px ${color})` : undefined }}
            />

            {/* Image fill via clipPath */}
            {p.entity.imageUrl && (
              <image
                href={p.entity.imageUrl}
                x={p.x - p.pulsedRadius}
                y={p.y - p.pulsedRadius}
                width={p.pulsedRadius * 2}
                height={p.pulsedRadius * 2}
                preserveAspectRatio="xMidYMid slice"
                clipPath={`url(#vci-clip-${id})`}
                opacity={0.6}
              />
            )}

            {/* Seed point label — entity id (truncated) */}
            <text
              x={p.x}
              y={p.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={12}
              fill={color}
              fillOpacity={0.9}
              pointerEvents="none"
              style={{ userSelect: "none" }}
            >
              {id.length > 12 ? id.slice(0, 12) + "…" : id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default VoronoiInfluenceMap;
