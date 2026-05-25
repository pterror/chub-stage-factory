import type { ExampleName } from "../../examples/registry";

export type LayoutKind = "tabs" | "stack";
export type ComposedInstance = { id: string; stage: ExampleName };

export type DelegatorConfigComposed = {
  kind: "composed";
  instances: ComposedInstance[];
  layout: LayoutKind;
  hookOrder?: string[];
};

// Parser from the flat YAML array form: ["inventory:inv1", "physics:phys1"]
export function parseComposedInstances(arr: string[]): ComposedInstance[] {
  return arr.map((entry) => {
    const [stage, id] = entry.split(":");
    if (!stage || !id)
      throw new Error(
        `bad composed_instances entry: "${entry}", expected "<example>:<id>"`,
      );
    return { id, stage: stage as ExampleName };
  });
}
