/*
 * _3d-demo/SceneView.tsx — the actual R3F scene for the Wave 2F demo.
 *
 * Split out so Stage.tsx can lazy-load it (3D-SCENE.md "lazy import is
 * required" recipe). Mounts ThreeScene + Physics3DWorld + TileGrid3D +
 * ThirdPersonRig and runs a fixed-timestep physics loop in a useFrame
 * accumulator.
 */

import {useEffect, useRef, useState, type ReactElement} from "react";
import {useFrame} from "@react-three/fiber";
import {ThreeScene} from "../../src/lib/3d/scene";
import {ThirdPersonRig} from "../../src/lib/3d/camera-rigs/third-person";
import {TileGrid3D, type TileCell} from "../../src/lib/3d/ui/TileGrid3D";
import {initRapier, Physics3DWorld, type BodyId} from "../../src/lib/3d/physics";
import {defaultAssetCache} from "../../src/lib/3d/assets";
import {Mesh} from "three";

const ROWS = 3;
const COLS = 3;
const SPHERE_RADIUS = 0.4;
const FIXED_STEP = 1 / 60;

function tileIndexToXZ(idx: number): [number, number] {
  const r = Math.floor(idx / COLS);
  const c = idx % COLS;
  const stride = 1.02;
  return [(c - (COLS - 1) / 2) * stride, (r - (ROWS - 1) / 2) * stride];
}

interface SceneViewProps {
  tile: number;
  onTileClick: (n: number) => void;
}

export default function SceneView(props: SceneViewProps): ReactElement {
  const [ready, setReady] = useState(false);
  const worldRef = useRef<Physics3DWorld | null>(null);
  const sphereIdRef = useRef<BodyId | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await initRapier();
      if (cancelled) return;
      const w = new Physics3DWorld({gravity: {x: 0, y: -9.81, z: 0}});
      w.addStaticPlane({x: 0, y: 1, z: 0}, {x: 0, y: -0.1, z: 0});
      const [x, z] = tileIndexToXZ(props.tile);
      const id = w.addSphere(
        SPHERE_RADIUS,
        {position: {x, y: 3, z}, ccd: true},
        {restitution: 0.6, friction: 0.4},
      );
      worldRef.current = w;
      sphereIdRef.current = id;
      setReady(true);
    })();
    return () => {
      cancelled = true;
      worldRef.current?.dispose();
      worldRef.current = null;
      sphereIdRef.current = null;
      // Demo doesn't load real assets, but a real stage would call this on
      // unmount; included to document the pattern.
      defaultAssetCache.disposeAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to tile prop changes: respawn the sphere over the new tile.
  useEffect(() => {
    const w = worldRef.current;
    const id = sphereIdRef.current;
    if (!w || id == null) return;
    w.remove(id);
    const [x, z] = tileIndexToXZ(props.tile);
    const newId = w.addSphere(
      SPHERE_RADIUS,
      {position: {x, y: 3, z}, ccd: true},
      {restitution: 0.6, friction: 0.4},
    );
    sphereIdRef.current = newId;
  }, [props.tile, ready]);

  const cells: TileCell<{n: number}>[][] = Array.from({length: ROWS}, (_, r) =>
    Array.from({length: COLS}, (_, c) => {
      const n = r * COLS + c;
      return {
        data: {n},
        color: n === props.tile ? "#facc15" : (r + c) % 2 === 0 ? "#94a3b8" : "#475569",
      };
    }),
  );

  return (
    <ThreeScene frameloop="always">
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 8, 4]} intensity={0.7} />
      <TileGrid3D
        cells={cells}
        tileSize={1}
        onCellClick={(_r, _c, cell) => props.onTileClick(cell.data.n)}
      />
      {ready && <Sphere world={worldRef} bodyId={sphereIdRef} />}
      <ThirdPersonRig target={[0, 0.5, 0]} distance={6} initialAngles={[0.4, -0.3]} />
    </ThreeScene>
  );
}

/**
 * Sphere mesh synchronized from the Rapier body's transform each frame.
 * Also drives the physics step on a fixed-timestep accumulator.
 */
function Sphere(props: {
  world: React.MutableRefObject<Physics3DWorld | null>;
  bodyId: React.MutableRefObject<BodyId | null>;
}): ReactElement {
  const meshRef = useRef<Mesh | null>(null);
  const acc = useRef(0);

  useFrame((_, delta) => {
    const w = props.world.current;
    const id = props.bodyId.current;
    if (!w || id == null) return;
    acc.current += Math.min(delta, 0.1); // clamp to avoid spiral of death
    while (acc.current >= FIXED_STEP) {
      w.step(FIXED_STEP);
      acc.current -= FIXED_STEP;
    }
    const t = w.getTransform(id);
    if (t && meshRef.current) {
      meshRef.current.position.set(t.position.x, t.position.y, t.position.z);
      meshRef.current.quaternion.set(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w);
    }
  });

  return (
    <mesh ref={meshRef} castShadow>
      <sphereGeometry args={[SPHERE_RADIUS, 24, 16]} />
      <meshStandardMaterial color="#f97316" />
    </mesh>
  );
}
