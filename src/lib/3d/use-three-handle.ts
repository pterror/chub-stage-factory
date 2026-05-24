import {Ref, useImperativeHandle} from "react";
import {useThree} from "@react-three/fiber";
import {PerspectiveCamera as PerspectiveCameraImpl} from "three";

/**
 * Narrow imperative surface exposed by `ThreeScene` via `imperativeRef`.
 *
 * Intentionally avoids leaking the renderer / scene / camera Three.js objects;
 * those handles couple stage code to R3F internals and break across version
 * bumps. Extend this interface only with intent-level operations.
 */
export interface ThreeSceneHandle {
  /** Force a single render. No-op if `frameloop === 'always'`. */
  invalidate(): void;
  /** Reset the default camera to its initial position/quaternion. */
  resetCamera(): void;
  /** Capture the canvas as a PNG blob (after the next render). */
  getSnapshot(): Promise<Blob>;
}

const DEFAULT_CAMERA_POSITION: [number, number, number] = [0, 0, 5];

/**
 * Inside-the-Canvas hook that wires the imperative handle. Must be rendered
 * as a child of `<Canvas>` so `useThree` resolves the active root state.
 */
export function useThreeHandle(handleRef: Ref<ThreeSceneHandle> | undefined): null {
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  useImperativeHandle(
    handleRef,
    (): ThreeSceneHandle => ({
      invalidate: () => invalidate(),
      resetCamera: () => {
        camera.position.set(...DEFAULT_CAMERA_POSITION);
        camera.quaternion.identity();
        if (camera instanceof PerspectiveCameraImpl) camera.updateProjectionMatrix();
        camera.lookAt(0, 0, 0);
        invalidate();
      },
      getSnapshot: () =>
        new Promise<Blob>((resolve, reject) => {
          invalidate();
          requestAnimationFrame(() => {
            gl.domElement.toBlob((blob) => {
              if (blob) resolve(blob);
              else reject(new Error("ThreeScene.getSnapshot: canvas.toBlob returned null"));
            }, "image/png");
          });
        }),
    }),
    [invalidate, camera, gl],
  );

  return null;
}
