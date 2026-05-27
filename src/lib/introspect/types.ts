/*
 * introspect/types.ts — StageIntrospect: queryable affordance surface.
 *
 * WHAT: An optional interface stages may implement to expose their
 *       interaction graph as queryable data, rather than only via
 *       rendered DOM. Three calls:
 *
 *         - `availableVerbs()`  → VerbDescriptor[]   (what can be done now)
 *         - `describe()`        → StageDescriptor    (where am I, what state)
 *         - `invokeVerb(name, args?)` → Promise<InvocationResult>
 *
 * WHY: UX audit 2026-05-27 §R1 / triage #35. The most ambitious example
 *      (world-primary) renders verb buttons that wire to no-ops because
 *      stages had no canonical place to expose their verb namespace.
 *      Same gap blocked agent-driven Phase 5 verification (audit
 *      §"Mock-stage navigation tooling proposal").
 *
 *      Modelling the affordance graph at the stage level solves both:
 *      the UI renders `availableVerbs()`, and a CLI driver
 *      (`scripts/explore-stage.mjs`) loops over the same surface.
 *
 * SHAPE:
 *   interface VerbDescriptor { name; label?; description?; args?; enabled?; group? }
 *   interface VerbArg        { name; type; required?; description?; enum? }
 *   interface StageDescriptor { summary; details?; verbCount? }
 *   interface InvocationResult { ok; message?; prose?; error?; messageState?; chatState? }
 *   interface StageIntrospect { availableVerbs; describe; invokeVerb }
 *
 * Optionality: stages do not have to implement this. Use the type-guard
 * `hasIntrospect(stage)` from `./index` to check at runtime.
 */

/** One argument the verb expects. Type names are advisory — the stage
 *  parses `args` however it likes. `enum` provides choices for UIs/CLIs. */
export interface VerbArg {
  name: string;
  type: "string" | "number" | "boolean" | "enum";
  required?: boolean;
  description?: string;
  /** When `type === "enum"`, the allowed values. */
  enum?: string[];
}

/** A verb the stage can invoke right now (or "right now" given current state). */
export interface VerbDescriptor {
  /** Stable id used by `invokeVerb`. */
  name: string;
  /** Human-readable label for UI rendering. Defaults to `name`. */
  label?: string;
  /** Long-form hint / tooltip. */
  description?: string;
  /** Args the verb accepts. Omit for nullary verbs. */
  args?: VerbArg[];
  /** When false, the UI should disable / the driver should refuse. Default true. */
  enabled?: boolean;
  /** Optional grouping hint ("move", "talk", "item", …). */
  group?: string;
}

/** Snapshot of where the player is. Free-form — stages choose what to surface. */
export interface StageDescriptor {
  /** One-line summary suitable for an agent prompt. */
  summary: string;
  /** Optional structured details (location, inventory, NPCs present, …). */
  details?: Record<string, unknown>;
  /** Convenience: number of verbs available right now. */
  verbCount?: number;
}

/** Result of an invocation. `prose` is the user-facing text, if any. */
export interface InvocationResult {
  ok: boolean;
  /** Short status line for the CLI / log. */
  message?: string;
  /** User-facing prose produced this turn, if the verb produced any. */
  prose?: string;
  /** Error string when `ok === false`. */
  error?: string;
  /** Post-invocation state snapshot (if the stage chose to surface it). */
  messageState?: unknown;
  chatState?: unknown;
}

/**
 * Optional interface for stages that expose their interaction graph.
 *
 * Implementation contract:
 *   - `availableVerbs()` may return zero verbs (e.g. while processing).
 *   - `invokeVerb` must route through the stage's normal lifecycle so
 *     state changes are real and persistable (typically by synthesizing a
 *     `Message` and calling `beforePrompt` internally).
 *   - All three methods may be called between turns; none mutate stage
 *     state except `invokeVerb`.
 */
export interface StageIntrospect {
  availableVerbs(): VerbDescriptor[];
  describe(): StageDescriptor;
  invokeVerb(name: string, args?: Record<string, unknown>): Promise<InvocationResult>;
}

/** Symbol used by `hasIntrospect` so adapters can opt in without inheritance. */
export const INTROSPECT_BRAND: unique symbol = Symbol.for("chub-stage-factory.introspect");
