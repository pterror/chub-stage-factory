/*
 * top-down.tsx — fixed-angle top-down camera (Hotline Miami / Diablo).
 *
 * WHAT: Camera hovers at a configurable height + angle above a follow
 *       target (or static point). No mouse rotation; WASD or arrow keys
 *       pan, scroll-wheel zooms the height.
 *
 * WHY: ARPG-shape, RTS-shape (when not full-RTS), and many turn-based
 *      tactical stages want this without rolling pan/zoom code.
 *
 * STAGEINTROSPECT: Publishes "top-down:select" (LMB on a 3D object).
 *      Hit-detection is the stage's job — the rig surfaces an
 *      `onVerbInvoke('top-down:select', { x, y })` with NDC coords so the
 *      stage can raycast itself.
 */

import {useEffect, useRef, type ReactElement, type MutableRefObject} from "react";
import {useFrame, useThree} from "@react-three/fiber";
import {PerspectiveCamera} from "@react-three/drei";
import {Vector3, type PerspectiveCamera as PerspectiveCameraImpl, type Object3D} from "three";
import type {CameraRigVerbProps} from "./types";

export interface TopDownRigProps extends CameraRigVerbProps {
  targetRef?: MutableRefObject<Object3D | null>;
  target?: [number, number, number];
  /** Camera Y offset above target. Default 10. */
  height?: number;
  /** Horizontal offset (Z back). Default 5; produces a slight tilt. */
  tilt?: number;
  /** Pan speed (units/sec). Default 8. */
  panSpeed?: number;
  /** Min/max height. */
  minHeight?: number;
  maxHeight?: number;
  followSpeed?: number;
}

export function TopDownRig(props: TopDownRigProps): ReactElement {
  const {
    targetRef,
    target = [0, 0, 0],
    height = 10,
    tilt = 5,
    panSpeed = 8,
    minHeight = 3,
    maxHeight = 30,
    followSpeed = 8,
    onVerbInvoke,
  } = props;

  const cameraRef = useRef<PerspectiveCameraImpl | null>(null);
  const h = useRef(height);
  const offset = useRef<[number, number]>([0, 0]); // pan offset (x, z)
  const keys = useRef<Record<string, boolean>>({});
  const tmpDesired = useRef(new Vector3());
  const tmpLookAt = useRef(new Vector3());
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const canvas = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      h.current = Math.max(minHeight, Math.min(maxHeight, h.current + e.deltaY * 0.01));
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      onVerbInvoke?.("top-down:select", {x, y});
    };
    const onKeyDown = (e: KeyboardEvent) => {
      keys.current[e.code] = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.current[e.code] = false;
    };
    canvas.addEventListener("wheel", onWheel, {passive: true});
    canvas.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, [gl, minHeight, maxHeight, onVerbInvoke]);

  useFrame((_, delta) => {
    const cam = cameraRef.current;
    if (!cam) return;
    let dx = 0, dz = 0;
    if (keys.current.KeyW || keys.current.ArrowUp) dz -= 1;
    if (keys.current.KeyS || keys.current.ArrowDown) dz += 1;
    if (keys.current.KeyA || keys.current.ArrowLeft) dx -= 1;
    if (keys.current.KeyD || keys.current.ArrowRight) dx += 1;
    if (dx !== 0 || dz !== 0) {
      const mag = Math.hypot(dx, dz);
      const step = panSpeed * delta;
      offset.current[0] += (dx / mag) * step;
      offset.current[1] += (dz / mag) * step;
    }

    const tx = (targetRef?.current?.position.x ?? target[0]) + offset.current[0];
    const tz = (targetRef?.current?.position.z ?? target[2]) + offset.current[1];
    const ty = targetRef?.current?.position.y ?? target[1];

    const desired = tmpDesired.current.set(tx, ty + h.current, tz + tilt);
    const alpha = Math.min(1, followSpeed * delta);
    cam.position.lerp(desired, alpha);
    cam.lookAt(tmpLookAt.current.set(tx, ty, tz));
  });

  return <PerspectiveCamera ref={cameraRef} makeDefault fov={50} />;
}
