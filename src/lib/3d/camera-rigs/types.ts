/*
 * camera-rigs/types.ts — shared types + verb-descriptor constants.
 *
 * Each rig component accepts `availableVerbs` + `onVerbInvoke` props for
 * StageIntrospect interop. The static `*RigVerbs` constants here are what
 * each rig publishes — stages merge them into their own
 * `StageIntrospect.availableVerbs()` return.
 *
 * (Constants live here rather than alongside their rig components so that
 * each .tsx file exports only React components, satisfying
 * react-refresh/only-export-components.)
 */

import type {VerbDescriptor} from "../../introspect/types";

export interface CameraRigVerbProps {
  availableVerbs?: VerbDescriptor[];
  onVerbInvoke?: (name: string, args?: Record<string, unknown>) => void;
}

export const fpsRigVerbs: VerbDescriptor[] = [
  {name: "fps:fire", label: "Fire", description: "Primary action (LMB)", group: "fps"},
  {name: "fps:interact", label: "Interact", description: "Activate (E key)", group: "fps"},
];

export const thirdPersonRigVerbs: VerbDescriptor[] = [
  {
    name: "third-person:lock-on",
    label: "Lock On",
    description: "Right-click or L",
    group: "third-person",
  },
];

export const topDownRigVerbs: VerbDescriptor[] = [
  {
    name: "top-down:select",
    label: "Select",
    description: "Click in the scene; stage raycasts at NDC coords",
    group: "top-down",
    args: [
      {name: "x", type: "number", required: true, description: "NDC x in [-1, 1]"},
      {name: "y", type: "number", required: true, description: "NDC y in [-1, 1]"},
    ],
  },
];

export const fixedRigVerbs: VerbDescriptor[] = [
  {name: "fixed:advance", label: "Advance", description: "Click to continue", group: "fixed"},
];
