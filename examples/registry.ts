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
];

export function getExample(name: string): ExampleEntry | undefined {
  return EXAMPLES.find((e) => e.name === name);
}
