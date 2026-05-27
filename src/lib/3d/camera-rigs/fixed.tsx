/*
 * fixed.tsx — static positioned camera (scene-set).
 *
 * WHAT: A PerspectiveCamera placed at a fixed position looking at a fixed
 *       point. No interactivity; the stage sets it and forgets it.
 *
 * WHY: Cutscenes, "establishing shot" intros, splash screens, and any 3D
 *      panel where the user shouldn't be able to move the view.
 *
 * STAGEINTROSPECT: Publishes "fixed:advance" (click anywhere on the
 *      canvas), suitable for "tap to continue" interactions.
 */

import {useEffect, useRef, type ReactElement} from "react";
import {useThree} from "@react-three/fiber";
import {PerspectiveCamera} from "@react-three/drei";
import type {PerspectiveCamera as PerspectiveCameraImpl} from "three";
import type {CameraRigVerbProps} from "./types";

export interface FixedRigProps extends CameraRigVerbProps {
  position: [number, number, number];
  lookAt?: [number, number, number];
  fov?: number;
}

export function FixedRig(props: FixedRigProps): ReactElement {
  const {position, lookAt = [0, 0, 0], fov = 50, onVerbInvoke} = props;
  const cameraRef = useRef<PerspectiveCameraImpl | null>(null);
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const cam = cameraRef.current;
    if (!cam) return;
    cam.position.set(position[0], position[1], position[2]);
    cam.lookAt(lookAt[0], lookAt[1], lookAt[2]);
  }, [position, lookAt]);

  useEffect(() => {
    const canvas = gl.domElement;
    const onClick = () => onVerbInvoke?.("fixed:advance");
    canvas.addEventListener("click", onClick);
    return () => canvas.removeEventListener("click", onClick);
  }, [gl, onVerbInvoke]);

  return <PerspectiveCamera ref={cameraRef} makeDefault fov={fov} />;
}
