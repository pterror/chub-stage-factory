/*
 * registry.ts — central index of all built-in example stages.
 *
 * Each entry pairs a Chub StageBase factory with the InitialData fixture used
 * by the dev TestStageRunner (and a label/description for the picker UI).
 *
 * To add a new example: create examples/<name>/Stage.tsx + test-init.json,
 * import the factory here, and append an entry. Build/deploy scripts read
 * this file to enumerate examples.
 */

import { InitialData, StageBase } from "@chub-ai/stages-ts";

import { InventoryStage } from "./inventory/Stage";
import inventoryInit from "./inventory/test-init.json";
import { EffectsStage } from "./effects/Stage";
import effectsInit from "./effects/test-init.json";
import { TurnCombatStage } from "./turn-combat/Stage";
import turnCombatInit from "./turn-combat/test-init.json";
import { TitsBodyStage } from "./tits-body/Stage";
import titsBodyInit from "./tits-body/test-init.json";
import { CyberSlotsStage } from "./cyber-slots/Stage";
import cyberSlotsInit from "./cyber-slots/test-init.json";
import { PhysicsStage } from "./physics/Stage";
import physicsInit from "./physics/test-init.json";
import { RealtimeCombatStage } from "./realtime-combat/Stage";
import realtimeCombatInit from "./realtime-combat/test-init.json";
import { CompositeShowcaseStage } from "./composite-showcase/Stage";
import compositeInit from "./composite-showcase/test-init.json";
import { WorldPrimaryStage } from "./world-primary/Stage";
import worldPrimaryInit from "./world-primary/test-init.json";

export interface ExampleEntry {
  name: string;
  label: string;
  description: string;
  primitives: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  factory: (data: InitialData<any, any, any, any>) => StageBase<any, any, any, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  testInit: any;
}

export const EXAMPLES: ExampleEntry[] = [
  {
    name: "inventory",
    label: "Inventory — Pak the pack-rat shopkeeper",
    description: "Spot-based stacks, accessibility, carry-class on scene change.",
    primitives: ["inventory", "observation", "chub-adapters", "prose-register"],
    factory: (d) => new InventoryStage(d),
    testInit: inventoryInit,
  },
  {
    name: "effects",
    label: "Effects — Klio the apothecary",
    description: "Tinctures as effects; stacking, trajectories, dispel-by-tag.",
    primitives: ["effects", "stats", "scheduler", "tag-parser", "chub-adapters"],
    factory: (d) => new EffectsStage(d),
    testInit: effectsInit,
  },
  {
    name: "turn-combat",
    label: "Turn combat — duel on the steps",
    description: "Initiative-ordered rounds + damage pipeline.",
    primitives: ["action", "combat-turn", "effects", "stats", "rng", "tag-parser"],
    factory: (d) => new TurnCombatStage(d),
    testInit: turnCombatInit,
  },
  {
    name: "tits-body",
    label: "TiTS body — Vey the alchemist",
    description: "Part-tracked body, gradual TF trajectories, snapshots.",
    primitives: ["body", "transformation", "tags", "snapshots", "observation"],
    factory: (d) => new TitsBodyStage(d),
    testInit: titsBodyInit,
  },
  {
    name: "cyber-slots",
    label: "Cyber-slots — Dr. Cull the ripperdoc",
    description: "Equipment×TF tag interop; violations surfaced, not auto-resolved.",
    primitives: ["equipment", "body", "transformation", "constraints", "observation"],
    factory: (d) => new CyberSlotsStage(d),
    testInit: cyberSlotsInit,
  },
  {
    name: "physics",
    label: "Physics — throw-objects sandbox",
    description: "AABB / SpatialHash / resolvePositional with bouncing projectile.",
    primitives: ["physics", "rng", "observation"],
    factory: (d) => new PhysicsStage(d),
    testInit: physicsInit,
  },
  {
    name: "realtime-combat",
    label: "Realtime combat — arena drone fight",
    description: "RealtimeWorld with bullet attacks and spawning drone wave.",
    primitives: ["combat-realtime", "physics", "rng"],
    factory: (d) => new RealtimeCombatStage(d),
    testInit: realtimeCombatInit,
  },
  {
    name: "composite-showcase",
    label: "Composite — Maven's clinic",
    description: "Cyberpunk shop + ripperdoc + duel; body+equipment+inventory+combat.",
    primitives: [
      "body", "transformation", "equipment", "inventory",
      "combat-turn", "effects", "observation", "prose-register",
      "tag-parser", "chub-adapters", "rng",
    ],
    factory: (d) => new CompositeShowcaseStage(d),
    testInit: compositeInit,
  },
  {
    name: "world-primary",
    label: "World-primary — the just-good RP frontend",
    description: "State-first RP frontend: structured verbs + freeform escape hatch + renderer/oracle split.",
    primitives: [
      "intent", "context", "llm-pipeline", "trigger", "predicate",
      "patterns/render-trigger", "patterns/freeform-pipeline",
      "ui/WorldStatePanel", "ui/ActionSurface", "ui/ScenePane",
      "ui/ChatLogSidebar", "ui/FreeformInput",
    ],
    factory: (d) => new WorldPrimaryStage(d),
    testInit: worldPrimaryInit,
  },
];

export type ExampleName = (typeof EXAMPLES)[number]["name"];

export function getExample(name: string): ExampleEntry | undefined {
  return EXAMPLES.find((e) => e.name === name);
}
