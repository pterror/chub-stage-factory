/*
 * types.ts — shared types for synergy pattern composers.
 *
 * WHAT: `ComposedSubsystem<S>` is the conceptual return shape every
 *       synergy pattern produces per `COMPOSITION.md` / `SYNERGY-
 *       EXTENSIONS.md`: a persistent `state`, optional observation
 *       sources, optional lifecycle hooks, and optional persistence
 *       shards. Patterns may omit any field they don't populate.
 *
 *       This file holds the type only — no runtime behavior. Each
 *       pattern composer constructs a fresh `ComposedSubsystem<S>`
 *       value at call time.
 *
 * WHY: The shape is repeated across all 14 Wave 2I synergy pattern
 *      composers; a single import keeps the signatures honest and
 *      makes pattern-to-pattern composition (one pattern's hook
 *      consumes another pattern's state shard) type-checkable.
 */

import type { ContextContributor } from "../../context";

/** Marker shape for pattern persistence shards. Patterns produce these
 *  as opaque tokens; the stage author wires them into whatever
 *  persistence layer they're using. */
export interface PatternShard<T = unknown> {
  /** Stable id used as the shard key. */
  id: string;
  /** Current value snapshot. Patterns mutate via the returned hooks /
   *  observers; this field is informational at the point of
   *  composition. */
  value: T;
}

/** Common lifecycle hooks a pattern may expose. Each is optional.
 *  Stages register the ones they care about. */
export interface PatternHooks {
  /** Called once per turn before context assembly. */
  beforeAssemble?: () => void | Promise<void>;
  /** Called once per scheduler tick. */
  tick?: (now: number) => void | Promise<void>;
  /** Called after an LLM output has been produced. */
  afterOutput?: (output: string) => void | Promise<void>;
  /** Free-form named handlers. */
  [name: string]: ((...args: never[]) => unknown) | undefined;
}

/** The shape every Wave 2I synergy pattern composer returns. */
export interface ComposedSubsystem<S> {
  /** Persistent state owned by the pattern. Mutated in place by the
   *  pattern's own hooks. */
  state: S;
  /** Context contributors the pattern emits; stages register them
   *  with their `ContextAssembler`. */
  contributors?: ContextContributor[];
  /** Lifecycle hooks. */
  hooks?: PatternHooks;
  /** Persistence shard descriptors. */
  shards?: PatternShard[];
}
