/*
 * third-person.tsx — orbital follow camera for a target object.
 *
 * WHAT: Camera orbits a target position (player capsule, vehicle, etc.) at
 *       a configurable distance. Drag with the mouse to rotate yaw/pitch;
 *       scroll to zoom (min/max distance clamped). The camera lerps toward
 *       the desired position each frame so motion feels weighty.
 *
 * WHY: Souls-shape, ARPG-shape (when not strictly top-down), and any
 *      character-focused stage want this rig without rolling their own
 *      orbit math.
 *
 * STAGEINTROSPECT: Publishes "third-person:lock-on" (right-click or L key)
 *      so stages with lock-on combat can wire to the standard verb.
 *
 * The target is supplied as a ref or as a static Vector3; if the target ref
 * is null, the camera orbits the origin.
 */

import {useEffect, useRef, type ReactElement, type MutableRefObject} from "react";
import {useFrame, useThree} from "@react-three/fiber";
import {PerspectiveCamera} from "@react-three/drei";
import {Vector3, type PerspectiveCamera as PerspectiveCameraImpl, type Object3D} from "three";
import type {CameraRigVerbProps} from "./types";

export interface ThirdPersonRigProps extends CameraRigVerbProps {
  /** Target to follow. Ref takes precedence over static. */
  targetRef?: MutableRefObject<Object3D | null>;
  target?: [number, number, number];
  /** Default 5. */
  distance?: number;
  /** Default 2; minimum zoom distance. */
  minDistance?: number;
  /** Default 15; maximum zoom distance. */
  maxDistance?: number;
  /** Default 8 (rad/s); how fast the camera converges. */
  followSpeed?: number;
  /** Default 0.005; mouse drag sensitivity. */
  sensitivity?: number;
  /** Initial yaw/pitch. Default [0, -0.4]. */
  initialAngles?: [number, number];
}

export function ThirdPersonRig(props: ThirdPersonRigProps): ReactElement {
  const {
    targetRef,
    target = [0, 0, 0],
    distance = 5,
    minDistance = 2,
    maxDistance = 15,
    followSpeed = 8,
    sensitivity = 0.005,
    initialAngles = [0, -0.4],
    onVerbInvoke,
  } = props;

  const cameraRef = useRef<PerspectiveCameraImpl | null>(null);
  const yaw = useRef(initialAngles[0]);
  const pitch = useRef(initialAngles[1]);
  const dist = useRef(distance);
  const dragging = useRef(false);
  const tmpDesired = useRef(new Vector3());
  const tmpTarget = useRef(new Vector3());
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const canvas = gl.domElement;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 0) dragging.current = true;
      if (e.button === 2) onVerbInvoke?.("third-person:lock-on");
    };
    const onPointerUp = () => {
      dragging.current = false;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      yaw.current -= e.movementX * sensitivity;
      pitch.current -= e.movementY * sensitivity;
      pitch.current = Math.max(-1.4, Math.min(1.4, pitch.current));
    };
    const onWheel = (e: WheelEvent) => {
      dist.current = Math.max(
        minDistance,
        Math.min(maxDistance, dist.current + e.deltaY * 0.005),
      );
    };
    const onContextMenu = (e: Event) => e.preventDefault();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "KeyL") onVerbInvoke?.("third-person:lock-on");
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("wheel", onWheel, {passive: true});
    document.addEventListener("keydown", onKeyDown);
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("wheel", onWheel);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [gl, sensitivity, minDistance, maxDistance, onVerbInvoke]);

  useFrame((_, delta) => {
    const cam = cameraRef.current;
    if (!cam) return;
    const t = tmpTarget.current;
    if (targetRef?.current) {
      t.copy(targetRef.current.position);
    } else {
      t.set(target[0], target[1], target[2]);
    }
    const cy = Math.cos(yaw.current), sy = Math.sin(yaw.current);
    const cp = Math.cos(pitch.current), sp = Math.sin(pitch.current);
    const desired = tmpDesired.current.set(
      t.x + dist.current * cp * sy,
      t.y + dist.current * sp + 1.5,
      t.z + dist.current * cp * cy,
    );
    const alpha = Math.min(1, followSpeed * delta);
    cam.position.lerp(desired, alpha);
    cam.lookAt(t.x, t.y + 1, t.z);
  });

  return <PerspectiveCamera ref={cameraRef} makeDefault fov={60} />;
}
