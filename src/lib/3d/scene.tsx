import {
  CSSProperties,
  ReactElement,
  ReactNode,
  Ref,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {Canvas, RootState} from "@react-three/fiber";
import {PerspectiveCamera} from "@react-three/drei";

import {DefaultLoader} from "./loader";
import {ThreeSceneHandle, useThreeHandle} from "./use-three-handle";

export type {ThreeSceneHandle} from "./use-three-handle";

export interface ThreeSceneProps {
  /** Scene graph children. Mounted inside the Canvas tree. */
  children: ReactNode;
  /**
   * Slot for the active camera controller (OrbitControls, FPS rig, etc.).
   * Mounted inside the Canvas tree after the default `<PerspectiveCamera>`.
   */
  cameraRig?: ReactNode;
  /** Default `'demand'`. Switch to `'always'` for continuously-animated rigs. */
  frameloop?: "always" | "demand" | "never";
  /** Default `[1, 1.5]` to cap mobile Retina cost. */
  dpr?: number | [number, number];
  /** Default `false`. Shadows have non-trivial GPU cost; opt in explicitly. */
  shadows?: boolean;
  /** Escape hatch for imperative Three.js access at startup. */
  onCreated?: (state: RootState) => void;
  /**
   * Narrow imperative handle. Prefer this over reaching for renderer/scene/
   * camera directly; the handle insulates stage code from R3F internals.
   */
  imperativeRef?: Ref<ThreeSceneHandle>;
}

const WRAPPER_STYLE: CSSProperties = {
  width: "100%",
  height: "100%",
  position: "relative",
  // Canvas wrapper does NOT capture pointer events. Interactive meshes opt
  // back in via Three.js mesh event handlers (R3F's raycaster fires
  // regardless of CSS pointer-events).
  pointerEvents: "none",
};

const CANVAS_STYLE: CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
};

const GL_OPTIONS = {
  antialias: true,
  powerPreference: "high-performance" as const,
};

/**
 * R3F `<Canvas>` wrapper with footgun-mitigating defaults for embedded
 * (Chub-iframe) use. See `src/lib/3D-SCENE.md` for usage recipes and
 * `src/lib/design/R3F-SCENE.md` for the design rationale.
 *
 * NOTE on conditional unmount: do NOT mount/unmount `<ThreeScene>` with
 * `{cond && <ThreeScene>}` — that destroys the WebGL context and forces a
 * cold restart. Use `display: none` or `visibility: hidden` on a parent
 * instead. Browsers cap active WebGL contexts at ~8.
 */
export function ThreeScene(props: ThreeSceneProps): ReactElement {
  const {
    children,
    cameraRig,
    frameloop = "demand",
    dpr = [1, 1.5],
    shadows = false,
    onCreated,
    imperativeRef,
  } = props;

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [contextLost, setContextLost] = useState(false);
  const rootStateRef = useRef<RootState | null>(null);

  // Height-zero mount guard. R3F's ResizeObserver falls back to 300x150 if
  // the parent has no computed height at mount time and frequently fails to
  // recover. We can't fix the parent's CSS — warn loudly so the stage author
  // can.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const parent = wrapperRef.current?.parentElement;
    if (parent && parent.offsetHeight === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        "[ThreeScene] parentElement.offsetHeight === 0 at mount. The Canvas " +
          "will fall back to 300x150 and may not recover. Give the parent an " +
          "explicit height (100vh, aspect-ratio, etc.).",
      );
    }
  }, []);

  // Context-loss listener. We do not attempt auto-restore — the
  // `webglcontextrestored` path is unreliable and Three.js does not re-upload
  // GPU resources on restore. A manual reload via remount is the only path
  // that consistently recovers.
  const handleCreated = useCallback(
    (state: RootState) => {
      rootStateRef.current = state;
      const canvas = state.gl.domElement;
      const onLost = (e: Event) => {
        e.preventDefault();
        setContextLost(true);
      };
      canvas.addEventListener("webglcontextlost", onLost, false);
      // Stash the cleanup on the state for the unmount effect to pick up.
      // RootState is extensible; we attach a non-enumerable marker.
      (state as unknown as {__threeSceneCleanup?: () => void}).__threeSceneCleanup = () => {
        canvas.removeEventListener("webglcontextlost", onLost, false);
      };
      onCreated?.(state);
    },
    [onCreated],
  );

  // Renderer cleanup on unmount. R3F disposes of the renderer itself in
  // recent versions, but we still tear down our listener attachments.
  useEffect(() => {
    return () => {
      const state = rootStateRef.current as
        | (RootState & {__threeSceneCleanup?: () => void})
        | null;
      state?.__threeSceneCleanup?.();
      rootStateRef.current = null;
    };
  }, []);

  // Local "manual reload" — force a remount of the Canvas subtree by
  // bumping a key. This is the one place a key bump on Canvas is correct:
  // the context is already gone.
  const [reloadKey, setReloadKey] = useState(0);
  const handleReload = useCallback(() => {
    setContextLost(false);
    setReloadKey((k) => k + 1);
  }, []);

  return (
    <div ref={wrapperRef} style={WRAPPER_STYLE}>
      <Canvas
        key={reloadKey}
        frameloop={frameloop}
        dpr={dpr}
        shadows={shadows}
        gl={GL_OPTIONS}
        style={CANVAS_STYLE}
        onCreated={handleCreated}
      >
        <PerspectiveCamera makeDefault position={[0, 0, 5]} />
        <Suspense fallback={null}>
          {children}
          {cameraRig}
        </Suspense>
        <HandleBridge imperativeRef={imperativeRef} />
      </Canvas>
      {contextLost ? (
        <ContextLostOverlay onReload={handleReload} />
      ) : (
        <Suspense fallback={<DefaultLoader />}>
          {/* Empty fragment — the real Suspense work happens inside Canvas.
              This DOM-side boundary exists so that DefaultLoader can render
              as a plain DOM overlay (not a Three.js child) during the very
              first frame, before Canvas has paint output. R3F renders on
              demand; the wrapper renders synchronously. */}
          <></>
        </Suspense>
      )}
    </div>
  );
}

/**
 * Bridge component that lives inside the Canvas tree so `useThree` resolves,
 * and forwards the imperative handle through `useThreeHandle`.
 */
function HandleBridge(props: {
  imperativeRef: Ref<ThreeSceneHandle> | undefined;
}): null {
  useThreeHandle(props.imperativeRef);
  return null;
}

function ContextLostOverlay(props: {onReload: () => void}): ReactElement {
  return (
    <div
      role="alert"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        background: "rgba(0, 0, 0, 0.7)",
        color: "rgba(255, 255, 255, 0.9)",
        font: "14px/1.4 system-ui, sans-serif",
        pointerEvents: "auto",
      }}
    >
      <div>The 3D scene lost its WebGL context.</div>
      <button
        onClick={props.onReload}
        style={{
          padding: "8px 16px",
          border: "1px solid rgba(255, 255, 255, 0.4)",
          background: "transparent",
          color: "inherit",
          font: "inherit",
          cursor: "pointer",
          borderRadius: 4,
        }}
      >
        Reload 3D scene
      </button>
    </div>
  );
}
