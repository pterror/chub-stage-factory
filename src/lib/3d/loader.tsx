import {ReactElement} from "react";

/**
 * Default fallback rendered by `ThreeScene`'s root `<Suspense>` boundary
 * when no asset-loading component supplies its own nested fallback.
 *
 * Pure DOM overlay (no Drei `<Html>`) so it works outside the Canvas tree as
 * well, and so it carries no Three.js cost on the loading path.
 */
export function DefaultLoader(): ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading 3D scene"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.35)",
        color: "rgba(255, 255, 255, 0.85)",
        font: "14px/1.4 system-ui, sans-serif",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          border: "3px solid rgba(255, 255, 255, 0.2)",
          borderTopColor: "rgba(255, 255, 255, 0.85)",
          borderRadius: "50%",
          animation: "three-scene-spin 0.9s linear infinite",
        }}
      />
      <style>{`@keyframes three-scene-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
