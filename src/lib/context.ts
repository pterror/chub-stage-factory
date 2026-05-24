/*
 * context.ts — composable prompt-assembly + ContextContributor protocol.
 *
 * WHAT: `ContextAssembler` owns a list of `ContextContributor`s and a token
 *       budget. On `assemble(ctx)` it calls each contributor's `contribute`
 *       to get a `Section { id, content, tokens, optional? }`, then runs
 *       the allocator:
 *
 *         1. Sort contributors by priority (high → low).
 *         2. Walk in priority order. Add every NON-optional section
 *            unconditionally — they are required regardless of budget.
 *         3. Then walk optional sections in priority order; include each
 *            only if the running budget still fits it.
 *         4. Emit sections in original (priority) order, joined by blank
 *            lines, with a final newline-trim.
 *
 *       This is "drop-then-allocate" optional-first: required sections
 *       always render, optional sections fill remaining budget in
 *       priority order. The behavior is predictable: a stage author
 *       knows that a `priority: 100, optional: false` section will
 *       always appear, even if it busts the budget; the budget governs
 *       only the optional layer.
 *
 *       Token counts are estimated via `estimateTokens(content)`, a
 *       coarse `Math.ceil(chars / 4)` heuristic. Contributors that need
 *       accuracy override their own `Section.tokens` field; the
 *       assembler trusts whatever it's given.
 *
 *       Built-in contributors ship alongside as factory functions:
 *         - `observationContributor(sources, options?)`
 *         - `timelineContributor(timeline, options)`
 *         - `chatWindowContributor(window)`  (identity — ChatWindow IS one)
 *         - `proseRegisterContributor(spec)`
 *         - `systemInstructionsContributor(text)`
 *         - `turnInputContributor()`
 *       (`worldStateContributor` deferred to Wave 2B.)
 *
 * WHY: Rule #6 of the north stars: composable context construction; the
 *      stage author never `string +`s a prompt. Every primitive that
 *      produces prompt-bound text gains a `ContextContributor`
 *      implementation, and the assembler handles priority allocation,
 *      drop-on-budget-pressure, and ordering. Stages compose
 *      contributors via `register` and call `assemble` once per turn.
 *
 * SHAPE:
 *   type SectionPosition = 'top' | 'bottom' | { depth: number }
 *   type SectionRole = 'system' | 'user' | 'assistant'
 *   interface Section { id; content; tokens; optional?; position?; role? }
 *   interface AssemblyContext { budget; turnInputMessage?; stage? }
 *   interface ContextContributor
 *     { id; priority; contribute(ctx): Section | null }
 *   class ContextAssembler
 *     contributors: ContextContributor[]; budget: number
 *     constructor({ budget, contributors? })
 *     register(c): this
 *     unregister(id): boolean
 *     assemble(ctx?): string
 *   estimateTokens(text): number              // chars / 4, ceiled
 *
 *   observationContributor(sources, options?): ContextContributor
 *   timelineContributor(timeline, options): ContextContributor
 *   chatWindowContributor(window): ContextContributor
 *   proseRegisterContributor(spec): ContextContributor
 *   systemInstructionsContributor(text, options?): ContextContributor
 *   turnInputContributor(options?): ContextContributor
 */

import type { Message } from "@chub-ai/stages-ts/dist/types/message";
import {
  assembleObservations,
  formatObservations,
  type AssembleOptions,
  type ObservationSource,
} from "./observation";
import { type ArchitectureName, proseInstructions, type RegisterSpec } from "./prose-register";
import { summarize, type Timeline, type TimelineEvent } from "./timeline";

/** Where a section is injected relative to other sections.
 *  `'top'` is sugar for `{ depth: 0 }` (very high effective priority);
 *  `'bottom'` is sugar for the default appending behaviour;
 *  `{ depth: n }` requests injection at depth n from the bottom of the
 *  optional layer (depth 0 = last, depth k = k sections from the end).
 *  Surfaced for `positionalInjectionDepthPattern`. */
export type SectionPosition = "top" | "bottom" | { depth: number };

/** Chat-role tagging for providers that surface role-tagged messages.
 *  The Chub host currently emits a single concatenated prompt string;
 *  the field is informational for now and reserved for future role-aware
 *  adapters. Carried through verbatim; never affects assembly order. */
export type SectionRole = "system" | "user" | "assistant";

export interface Section {
  id: string;
  content: string;
  /** Estimated tokens. Use `estimateTokens(content)` if you don't have a
   *  better number; contributors that wrap tokenizers should pass exact
   *  counts. */
  tokens: number;
  /** Droppable under budget pressure. Default false (required). */
  optional?: boolean;
  /** Where this section sits relative to other sections in the final
   *  output. Default `'bottom'` (legacy: priority-ordered, top-down).
   *  `'top'` floats the section to the start; `{ depth: n }` injects it
   *  n positions from the end. */
  position?: SectionPosition;
  /** Chat-role hint when the provider supports role-tagged messages.
   *  Informational; assembly does not reorder by role. */
  role?: SectionRole;
}

export interface AssemblyContext {
  /** Token budget for OPTIONAL sections only. Required sections always
   *  render. Default 4000 if not overridden by the assembler. */
  budget: number;
  /** The just-received player message; surfaced via `turnInputContributor`. */
  turnInputMessage?: Message;
  /** Opaque pass-through so contributors can reach stage-specific state
   *  without the assembler having to type it. */
  stage?: unknown;
}

export interface ContextContributor {
  id: string;
  /** Higher = allocated first. Conventional bands:
   *  100+: system instructions, hard rules
   *   80–99: chat window, turn input
   *   60–79: prose register, world state
   *   40–59: observations
   *   20–39: timeline / event history
   *    0–19: nice-to-have flavor */
  priority: number;
  contribute(ctx: AssemblyContext): Section | null;
}

/** Coarse char-count / 4 heuristic. Stages that need accuracy should
 *  override per-contributor — emit a `Section.tokens` from a real
 *  tokenizer count. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface ContextAssemblerOptions {
  /** Token budget for OPTIONAL sections. Required sections render
   *  regardless. Default 4000. */
  budget?: number;
  contributors?: ContextContributor[];
}

export class ContextAssembler {
  contributors: ContextContributor[] = [];
  budget: number;

  constructor(opts: ContextAssemblerOptions = {}) {
    this.budget = opts.budget ?? 4000;
    if (opts.contributors) for (const c of opts.contributors) this.register(c);
  }

  register(c: ContextContributor): this {
    // Replace existing by id; keeps registration idempotent.
    const i = this.contributors.findIndex((x) => x.id === c.id);
    if (i >= 0) this.contributors[i] = c;
    else this.contributors.push(c);
    return this;
  }

  unregister(id: string): boolean {
    const i = this.contributors.findIndex((c) => c.id === id);
    if (i < 0) return false;
    this.contributors.splice(i, 1);
    return true;
  }

  /** Walk contributors in priority order, gather sections, run the
   *  drop-then-allocate optional layer, emit joined output. */
  assemble(ctx: AssemblyContext = { budget: this.budget }): string {
    const budget = ctx.budget ?? this.budget;
    // Sort a copy; preserve original list ordering.
    const sorted = [...this.contributors].sort((a, b) => b.priority - a.priority);

    interface Slot {
      priority: number;
      section: Section;
    }
    const required: Slot[] = [];
    const optional: Slot[] = [];
    for (const c of sorted) {
      const sec = c.contribute(ctx);
      if (sec === null) continue;
      const slot = { priority: c.priority, section: sec };
      if (sec.optional) optional.push(slot);
      else required.push(slot);
    }

    // Required always render.
    const accepted: Slot[] = [...required];
    let used = required.reduce((n, s) => n + s.section.tokens, 0);

    // Optionals: priority order, include while budget remains.
    for (const slot of optional) {
      if (used + slot.section.tokens > budget) continue;
      accepted.push(slot);
      used += slot.section.tokens;
    }

    // Default emit order: priority descending. Stable across required /
    // optional partition because we resort the merged list.
    accepted.sort((a, b) => b.priority - a.priority);

    // Apply Section.position when present. Strategy:
    //   1. Partition into top / depth / default (no explicit position or
    //      'bottom') buckets.
    //   2. Emit `top` sections first (in priority order),
    //   3. then `default`,
    //   4. then splice each `depth` section into the resulting list at
    //      `length - depth` (0 = end, 1 = one before end, ...).
    const tops: Slot[] = [];
    const defaults: Slot[] = [];
    const depthed: { slot: Slot; depth: number }[] = [];
    for (const slot of accepted) {
      const pos = slot.section.position;
      if (pos === "top") tops.push(slot);
      else if (pos && typeof pos === "object" && "depth" in pos) {
        depthed.push({ slot, depth: Math.max(0, pos.depth) });
      } else {
        defaults.push(slot);
      }
    }
    const ordered: Slot[] = [...tops, ...defaults];
    // Insert depth-positioned sections from largest depth first so each
    // subsequent insertion's depth-from-end reading stays accurate.
    depthed.sort((a, b) => b.depth - a.depth);
    for (const { slot, depth } of depthed) {
      const idx = Math.max(0, ordered.length - depth);
      ordered.splice(idx, 0, slot);
    }
    return ordered.map((s) => s.section.content).join("\n\n").replace(/\n+$/, "");
  }
}

/* ---------------------------------------------------------------- *
 * Built-in contributors                                            *
 * ---------------------------------------------------------------- */

export interface ObservationContributorOptions<S> {
  id?: string;
  priority?: number;
  optional?: boolean;
  /** State to pass to observation evaluators. Defaults to undefined; many
   *  observation sources (Timeline included) ignore state entirely. */
  state?: S;
  /** Forwarded to assembleObservations; supplies `now`, `maxCount`,
   *  `lastEmittedAt`. */
  assembleOptions?: AssembleOptions;
}

export function observationContributor<S = unknown>(
  sources: readonly ObservationSource<S>[],
  options: ObservationContributorOptions<S> = {},
): ContextContributor {
  return {
    id: options.id ?? "observations",
    priority: options.priority ?? 50,
    contribute() {
      const opts = options.assembleOptions ?? { now: Date.now() };
      const observed = assembleObservations(sources, options.state as S, opts);
      if (observed.length === 0) return null;
      const content = formatObservations(observed);
      return {
        id: options.id ?? "observations",
        content,
        tokens: estimateTokens(content),
        optional: options.optional ?? true,
      };
    },
  };
}

export interface TimelineContributorOptions<E> {
  id?: string;
  priority?: number;
  optional?: boolean;
  /** Number of recent events to render. Required. */
  window: number;
  /** Per-event render — defaults to JSON.stringify of payload. */
  render?: (event: E, at: number) => string;
}

export function timelineContributor<E>(
  timeline: Timeline<E>,
  options: TimelineContributorOptions<E>,
): ContextContributor {
  return {
    id: options.id ?? "timeline",
    priority: options.priority ?? 30,
    contribute() {
      const events: readonly TimelineEvent<E>[] = timeline.window(options.window);
      if (events.length === 0) return null;
      const render = options.render ?? ((e: E, at: number) => `${at}: ${JSON.stringify(e)}`);
      const body = summarize(events, render);
      const content = `<recent-events>\n${body}\n</recent-events>`;
      return {
        id: options.id ?? "timeline",
        content,
        tokens: estimateTokens(content),
        optional: options.optional ?? true,
      };
    },
  };
}

/** Identity bridge — `ChatWindow` already implements `ContextContributor`.
 *  Exported for symmetry with the other built-ins. */
export function chatWindowContributor(window: ContextContributor): ContextContributor {
  return window;
}

export interface ProseRegisterContributorOptions {
  id?: string;
  priority?: number;
  optional?: boolean;
  architectures: readonly ArchitectureName[];
  register: RegisterSpec;
}

export function proseRegisterContributor(opts: ProseRegisterContributorOptions): ContextContributor {
  return {
    id: opts.id ?? "prose-register",
    priority: opts.priority ?? 70,
    contribute() {
      const content = proseInstructions({ architectures: opts.architectures, register: opts.register });
      return {
        id: opts.id ?? "prose-register",
        content,
        tokens: estimateTokens(content),
        optional: opts.optional ?? false,
      };
    },
  };
}

export interface SystemInstructionsContributorOptions {
  id?: string;
  priority?: number;
  optional?: boolean;
}

export function systemInstructionsContributor(
  text: string,
  options: SystemInstructionsContributorOptions = {},
): ContextContributor {
  const content = text;
  return {
    id: options.id ?? "system",
    priority: options.priority ?? 100,
    contribute() {
      if (!content) return null;
      return {
        id: options.id ?? "system",
        content,
        tokens: estimateTokens(content),
        optional: options.optional ?? false,
      };
    },
  };
}

export interface TurnInputContributorOptions {
  id?: string;
  priority?: number;
  optional?: boolean;
}

export function turnInputContributor(options: TurnInputContributorOptions = {}): ContextContributor {
  return {
    id: options.id ?? "turn-input",
    priority: options.priority ?? 90,
    contribute(ctx) {
      const msg = ctx.turnInputMessage;
      if (!msg) return null;
      const speaker = msg.isBot ? "assistant" : "user";
      const content = `<turn-input speaker="${speaker}">\n${msg.content}\n</turn-input>`;
      return {
        id: options.id ?? "turn-input",
        content,
        tokens: estimateTokens(content),
        optional: options.optional ?? false,
      };
    },
  };
}
