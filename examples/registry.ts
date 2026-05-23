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
];

export function getExample(name: string): ExampleEntry | undefined {
  return EXAMPLES.find((e) => e.name === name);
}
