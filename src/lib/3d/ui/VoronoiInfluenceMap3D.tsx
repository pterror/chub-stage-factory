/*
 * VoronoiInfluenceMap3D.tsx — 3D influence map (spheres of influence) on
 *                              the XZ plane.
 *
 * WHAT: Renders each entity as a translucent sphere of radius=`radius`,
 *       positioned at `(x, 0, z)`. Where spheres intersect, the GPU's
 *       additive blending visually communicates overlap (closer = brighter).
 *       This is the 3D analogue of `ui/voronoi-influence-map.tsx`'s 2D
 *       Voronoi cells — same conceptual primitive (entity-with-radius
 *       territory map), different rendering substrate.
 *
 *       True 3D weighted Voronoi diagrams are expensive and add no value
 *       for the common case (faction territory, threat zones, NPC awareness
 *       radii); the sphere overlap is the right primitive at this level.
 *
 * WHY: Strategy-map and tactical-RPG 3D stages want this; the 2D version
 *      handles the screen-overlay case, this handles the in-world case.
 *
 * Interaction: click a sphere → onEntityClick(entity).
 */

import {Fragment, type ReactElement} from "react";
import type {ThreeEvent} from "@react-three/fiber";

export interface VoronoiEntity3D<E> {
  id: string;
  x: number;
  z: number;
  /** Sphere radius in world units. */
  radius: number;
  data: E;
  /** Hex color. Defaults to a generated color from id. */
  color?: string;
  /** Optional Y elevation. Default 0. */
  y?: number;
}

export interface VoronoiInfluenceMap3DProps<E> {
  entities: VoronoiEntity3D<E>[];
  /** Material opacity per sphere. Default 0.35. */
  opacity?: number;
  /** When true, sphere is rendered as a flattened disc (Y-thin) suitable
   *  for top-down strategy maps. Default false. */
  flat?: boolean;
  onEntityClick?: (entity: VoronoiEntity3D<E>) => void;
  onEntityHover?: (entity: VoronoiEntity3D<E> | null) => void;
}

function colorFromId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

export function VoronoiInfluenceMap3D<E>(
  props: VoronoiInfluenceMap3DProps<E>,
): ReactElement {
  const {entities, opacity = 0.35, flat = false, onEntityClick, onEntityHover} = props;

  return (
    <group>
      {entities.map((entity) => {
        const color = entity.color ?? colorFromId(entity.id);
        const y = entity.y ?? 0;
        const scaleY = flat ? 0.05 : 1;
        return (
          <Fragment key={entity.id}>
            <mesh
              position={[entity.x, y, entity.z]}
              scale={[1, scaleY, 1]}
              onClick={
                onEntityClick
                  ? (e: ThreeEvent<MouseEvent>) => {
                      e.stopPropagation();
                      onEntityClick(entity);
                    }
                  : undefined
              }
              onPointerOver={
                onEntityHover
                  ? (e: ThreeEvent<PointerEvent>) => {
                      e.stopPropagation();
                      onEntityHover(entity);
                    }
                  : undefined
              }
              onPointerOut={onEntityHover ? () => onEntityHover(null) : undefined}
            >
              <sphereGeometry args={[entity.radius, 24, 16]} />
              <meshStandardMaterial
                color={color}
                transparent
                opacity={opacity}
                depthWrite={false}
              />
            </mesh>
          </Fragment>
        );
      })}
    </group>
  );
}
