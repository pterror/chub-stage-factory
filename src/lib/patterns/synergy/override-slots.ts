/*
 * override-slots.ts — SillyTavern character-card Main-Prompt /
 * Post-History Instructions / NovelAI Memory composer. Named slots
 * (e.g. `"system-prompt"`) replace the contributor under the same id
 * rather than appending; implemented as a `beforeAssemble` hook that
 * `unregister`s the existing contributor then `register`s the
 * override.
 *
 * Composes: ContextContributor with very high priority +
 * non-optional + assembler.unregister(slotId) + register(newOne) in
 * a contextModifier-style hook.
 *
 * Source: SillyTavern character card Main Prompt override + Post-
 * History Instructions; NovelAI Memory.
 */

import type { ContextAssembler, ContextContributor, SectionRole } from "../../context";
import { estimateTokens } from "../../context";
import type { ComposedSubsystem } from "./types";

export interface OverrideSlot {
  id: string;
  content: string;
  priority?: number;
  role?: SectionRole;
}

export interface OverrideSlotsOptions {
  slots: OverrideSlot[];
}

export interface OverrideSlotsState {
  overrides: Map<string, string>;
}

export function overrideSlotsPattern(
  opts: OverrideSlotsOptions,
): ComposedSubsystem<OverrideSlotsState> & {
  apply: (assembler: ContextAssembler) => void;
} {
  const state: OverrideSlotsState = { overrides: new Map() };
  for (const s of opts.slots) state.overrides.set(s.id, s.content);

  function apply(assembler: ContextAssembler): void {
    for (const s of opts.slots) {
      assembler.unregister(s.id);
      const contributor: ContextContributor = {
        id: s.id,
        priority: s.priority ?? 1000,
        contribute() {
          const content = state.overrides.get(s.id) ?? s.content;
          return {
            id: s.id,
            content,
            tokens: estimateTokens(content),
            optional: false,
            role: s.role,
          };
        },
      };
      assembler.register(contributor);
    }
  }

  return {
    state,
    apply,
    hooks: { beforeAssemble: () => {} },
    shards: [{ id: "override-slots", value: state }],
  };
}
