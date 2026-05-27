export {ThreeScene} from "./scene";
export type {ThreeSceneHandle, ThreeSceneProps} from "./scene";
export {DefaultLoader} from "./loader";

// Wave 2F substrate
export {
  initRapier,
  isRapierReady,
  Physics3DWorld,
  type Vec3,
  type Quat,
  type BodyId,
  type BodyOptions,
  type ColliderOptions,
  type RayHit,
} from "./physics";
export {AssetCache, defaultAssetCache} from "./assets";

// Camera rigs
export {FPSRig, type FPSRigProps} from "./camera-rigs/fps";
export {ThirdPersonRig, type ThirdPersonRigProps} from "./camera-rigs/third-person";
export {TopDownRig, type TopDownRigProps} from "./camera-rigs/top-down";
export {FixedRig, type FixedRigProps} from "./camera-rigs/fixed";
export {
  fpsRigVerbs,
  thirdPersonRigVerbs,
  topDownRigVerbs,
  fixedRigVerbs,
  type CameraRigVerbProps,
} from "./camera-rigs/types";

// 3D UI primitives
export {TileGrid3D, type TileCell, type TileGrid3DProps} from "./ui/TileGrid3D";
export {
  VoronoiInfluenceMap3D,
  type VoronoiEntity3D,
  type VoronoiInfluenceMap3DProps,
} from "./ui/VoronoiInfluenceMap3D";
export {
  GraphView3D,
  type GraphNode3D,
  type GraphEdge3D,
  type GraphView3DProps,
} from "./ui/GraphView3D";
