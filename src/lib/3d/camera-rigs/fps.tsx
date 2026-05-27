/*
 * fps.tsx — first-person camera rig with mouse-look + WASD.
 *
 * WHAT: A React Three Fiber component that wraps a PerspectiveCamera and
 *       installs pointer-lock + keyboard listeners. WASD translates in the
 *       camera's local horizontal plane; mouse rotates yaw/pitch around
 *       the camera's world Y axis (yaw) and local X (pitch, clamped).
 *
 * WHY: Dungeon-crawler/Walking-sim/Souls-shape stages need a first-person
 *      walker without each stage rolling its own pointer-lock dance.
 *
 * STAGEINTROSPECT: Publishes a "fire" verb (LMB while pointer-locked) and
 *      a "interact" verb (E key). The stage handles the gameplay effect
 *      via `onVerbInvoke`.
 *
 * Composes inside a `<ThreeScene cameraRig={<FPSRig …/>}>` slot.
 */

import {useEffect, useRef, type ReactElement} from "react";
import {useFrame, useThree} from "@react-three/fiber";
import {PerspectiveCamera} from "@react-three/drei";
import {Vector3, Euler, type PerspectiveCamera as PerspectiveCameraImpl} from "three";
import type {CameraRigVerbProps} from "./types";

export interface FPSRigProps extends CameraRigVerbProps {
  /** Initial position in world coords. Default [0, 1.7, 5]. */
  position?: [number, number, number];
  /** Movement speed in units per second. Default 5. */
  speed?: number;
  /** Mouse sensitivity in radians per pixel. Default 0.002. */
  sensitivity?: number;
  /** FOV in degrees. Default 75. */
  fov?: number;
  /** Pitch clamp in radians (symmetric). Default π/2 - 0.01. */
  pitchClamp?: number;
}

export function FPSRig(props: FPSRigProps): ReactElement {
  const {
    position = [0, 1.7, 5],
    speed = 5,
    sensitivity = 0.002,
    fov = 75,
    pitchClamp = Math.PI / 2 - 0.01,
    onVerbInvoke,
  } = props;

  const cameraRef = useRef<PerspectiveCameraImpl | null>(null);
  const gl = useThree((s) => s.gl);
  const keys = useRef<Record<string, boolean>>({});
  const euler = useRef(new Euler(0, 0, 0, "YXZ"));
  const tmpForward = useRef(new Vector3());
  const tmpRight = useRef(new Vector3());

  // Pointer-lock + mouse + keyboard listeners. Bound once on mount.
  useEffect(() => {
    const canvas = gl.domElement;

    const onClick = () => {
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return;
      euler.current.y -= e.movementX * sensitivity;
      euler.current.x -= e.movementY * sensitivity;
      euler.current.x = Math.max(-pitchClamp, Math.min(pitchClamp, euler.current.x));
    };

    const onMouseDown = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return;
      if (e.button === 0) onVerbInvoke?.("fps:fire");
    };

    const onKeyDown = (e: KeyboardEvent) => {
      keys.current[e.code] = true;
      if (e.code === "KeyE" && document.pointerLockElement === canvas) {
        onVerbInvoke?.("fps:interact");
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.current[e.code] = false;
    };

    canvas.addEventListener("click", onClick);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      canvas.removeEventListener("click", onClick);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, [gl, sensitivity, pitchClamp, onVerbInvoke]);

  useFrame((_, delta) => {
    const cam = cameraRef.current;
    if (!cam) return;
    cam.quaternion.setFromEuler(euler.current);

    // Build forward/right in the horizontal plane (ignore pitch for movement).
    const f = tmpForward.current.set(0, 0, -1).applyEuler(new Euler(0, euler.current.y, 0));
    const r = tmpRight.current.set(1, 0, 0).applyEuler(new Euler(0, euler.current.y, 0));

    let dx = 0, dz = 0;
    if (keys.current.KeyW) dz += 1;
    if (keys.current.KeyS) dz -= 1;
    if (keys.current.KeyA) dx -= 1;
    if (keys.current.KeyD) dx += 1;
    if (dx === 0 && dz === 0) return;

    const mag = Math.hypot(dx, dz);
    const step = speed * delta;
    cam.position.x += (f.x * dz + r.x * dx) * (step / mag);
    cam.position.z += (f.z * dz + r.z * dx) * (step / mag);
  });

  return <PerspectiveCamera ref={cameraRef} makeDefault position={position} fov={fov} />;
}
