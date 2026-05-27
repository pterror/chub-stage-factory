/*
 * introspect/index.ts — public entry + type guards for StageIntrospect.
 *
 * See ./types.ts for the interface and ./INTROSPECT.md for the contract.
 */

import type { StageIntrospect } from "./types";

export type {
  StageIntrospect,
  VerbDescriptor,
  VerbArg,
  StageDescriptor,
  InvocationResult,
} from "./types";

export { INTROSPECT_BRAND } from "./types";

/**
 * True when `stage` implements `StageIntrospect`. Checked structurally:
 * any object exposing all three methods is treated as an implementer.
 */
export function hasIntrospect(stage: unknown): stage is StageIntrospect {
  if (stage == null || typeof stage !== "object") return false;
  const s = stage as Record<string, unknown>;
  return (
    typeof s.availableVerbs === "function" &&
    typeof s.describe === "function" &&
    typeof s.invokeVerb === "function"
  );
}

/**
 * Adapter: prefix every verb name with `prefix + ":"`. Useful for
 * composed stages where child verb namespaces collide.
 */
export function namespaceVerbs(
  prefix: string,
  introspect: StageIntrospect,
): StageIntrospect {
  return {
    availableVerbs() {
      return introspect.availableVerbs().map((v) => ({
        ...v,
        name: `${prefix}:${v.name}`,
        group: v.group ?? prefix,
      }));
    },
    describe() {
      const d = introspect.describe();
      return { ...d, summary: `[${prefix}] ${d.summary}` };
    },
    async invokeVerb(name, args) {
      const p = `${prefix}:`;
      if (!name.startsWith(p)) {
        return { ok: false, error: `verb "${name}" is not in namespace "${prefix}"` };
      }
      return introspect.invokeVerb(name.slice(p.length), args);
    },
  };
}
