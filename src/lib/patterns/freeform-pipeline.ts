/*
 * patterns/freeform-pipeline.ts — freeform text → intent → oracle → delta
 *                                  → render.
 *
 * WHAT: `freeformPipeline(opts)` wires the full escape-hatch loop from
 *       FRONTEND-SHAPE.md:
 *
 *         1. `parseIntent(text, scope, options?)` — deterministic grammar;
 *            on miss, routes to the oracle via `quietCall` fallback.
 *         2. If a grammar `Intent` is found: caller's `applyDelta` decides
 *            how to mutate state from the intent; `render` produces prose.
 *         3. If no grammar match (intent is null): LLM oracle proposes
 *            `{ delta, stub }` via `generate()` with a schema parser.
 *         4. `policy` validates the delta:
 *            - `strict` — reject deltas that fail `validateDelta`.
 *            - `coerce` — remap invalid delta fields to their nearest
 *              legal values via `coerceDelta`, then apply.
 *            - `extend` — not implemented; throws with a TODO.
 *         5. `applyDelta(delta)` mutates state.
 *         6. `render(stub?)` produces prose (stub from oracle or null).
 *
 *       Returns `FreeformResult { prose, intent, delta?, policyOutcome }`.
 *
 * WHY: Named in FRONTEND-SHAPE.md §"Gaps":
 *      "`patterns/freeform-pipeline.ts` — freeform text → intent parse →
 *      (on miss) oracle proposes delta+stub → policy validates → apply →
 *      render." First use in `examples/world-primary/`.
 *
 *      Rule 2 (patterns = 90% wiring): all state lives in the primitives
 *      composed here. This file has no state of its own.
 *
 * SHAPE:
 *   type SandboxPolicy = "strict" | "coerce" | "extend"
 *   interface OracleDelta<D> { delta: D; stub?: RenderStub }
 *   interface FreeformPipelineOptions<S, D>
 *     { text; scope; parseOptions?; oracle; validateDelta?;
 *       coerceDelta?; applyDelta; render; policy?; generator; }
 *   interface FreeformResult<D>
 *     { prose; intent; delta?; policyOutcome }
 *   freeformPipeline<S, D>(opts): Promise<FreeformResult<D>>
 */

import type { GenerationService } from "@chub-ai/stages-ts";
import { generate, type SchemaParser } from "../generate";
import { parseIntent, type Intent, type ParseIntentOptions } from "../intent";
import type { RenderStub } from "./render-trigger";

export type SandboxPolicy = "strict" | "coerce" | "extend";

export type PolicyOutcome = "grammar-hit" | "oracle-applied" | "oracle-coerced" | "rejected" | "error";

/**
 * Oracle-proposed state mutation. The oracle LLM proposes BOTH:
 * - `delta` — structured state change the stage author validates.
 * - `stub?` — optional render directive for the follow-up prose call.
 *
 * This is the renderer/oracle split from FRONTEND-SHAPE.md: the oracle
 * never emits user-facing prose; it emits structured proposals the
 * renderer then works from.
 */
export interface OracleDelta<D> {
  delta: D;
  stub?: RenderStub;
}

export interface FreeformPipelineOptions<D> {
  /** Raw freeform text from the player. */
  text: string;
  /** Current scope — objects/exits/NPCs visible to the player. */
  scope: ReadonlySet<string>;
  /** Forwarded to `parseIntent`. Includes synonym table + LLM fallback. */
  parseOptions?: ParseIntentOptions;
  /**
   * Called when the grammar/intent layer misses completely (returns null).
   * Receives the full player text; returns a prompt string for `generate`.
   * The `generate` call uses `oracleSchema` to parse the result.
   */
  oraclePrompt: (text: string, scope: ReadonlySet<string>) => string;
  /**
   * Parses the oracle LLM response into `OracleDelta<D>`. Standard
   * `SchemaParser<T>` signature — return null to reject the response.
   */
  oracleSchema: SchemaParser<OracleDelta<D>>;
  /**
   * `GenerationService` used for the oracle call. The oracle is a quiet
   * side-call; no output enters the transcript.
   */
  generator: GenerationService;
  /**
   * Called with an `OracleDelta<D>` to check whether the proposed delta
   * is legal against the current world constraints. Return true to accept.
   * When omitted, all deltas are accepted under `coerce` policy, or
   * rejected under `strict` if `coerceDelta` is also absent.
   */
  validateDelta?: (d: D) => boolean;
  /**
   * Called under `coerce` policy when `validateDelta` returns false.
   * Remaps the delta to the nearest legal form. When omitted under
   * `coerce` policy, the delta is applied as-is (liberal coerce).
   */
  coerceDelta?: (d: D) => D;
  /**
   * Apply a validated (or coerced) delta to world state. The stage author
   * mutates their state object here.
   */
  applyDelta: (d: D) => void;
  /**
   * Produce the final prose string. Called after delta application.
   * `stub` is the render directive from the oracle (may be undefined when
   * the grammar layer handled the intent or when the oracle omitted it).
   */
  render: (stub?: RenderStub, intent?: Intent | null) => Promise<string>;
  /** Oracle delta sandbox policy. Default "coerce". */
  policy?: SandboxPolicy;
  /** Retries for the oracle `generate` call. Default 2. */
  oracleRetries?: number;
}

export interface FreeformResult<D> {
  prose: string;
  intent: Intent | null;
  delta?: D;
  policyOutcome: PolicyOutcome;
}

/**
 * Run the freeform escape-hatch loop:
 *   text → intent parse → (on miss) oracle delta → policy → apply → render.
 *
 * Grammar path (intent returned): `applyDelta` is not called directly —
 * that is the stage's responsibility (the grammar intent tells the stage
 * *what* the player wants; the stage applies its own deterministic rules).
 * Only the oracle path calls `applyDelta` here, because the oracle
 * proposes an explicit delta.
 *
 * If the oracle call itself fails (network error, exhausted retries),
 * `policyOutcome` is "error" and prose is an empty string.
 */
export async function freeformPipeline<D>(
  opts: FreeformPipelineOptions<D>,
): Promise<FreeformResult<D>> {
  const policy = opts.policy ?? "coerce";

  if (policy === "extend") {
    throw new Error(
      "freeformPipeline: sandbox policy 'extend' is not implemented (TODO: Wave 2B+).",
    );
  }

  // 1. Intent parse (grammar + optional LLM fallback within parseIntent).
  const intent = await parseIntent(opts.text, opts.scope, opts.parseOptions);

  if (intent !== null) {
    // Grammar hit: render without calling oracle.
    const prose = await opts.render(undefined, intent);
    return { prose, intent, policyOutcome: "grammar-hit" };
  }

  // 2. Grammar miss: call oracle for a structured delta proposal.
  let oracleDelta: OracleDelta<D>;
  try {
    oracleDelta = await generate<OracleDelta<D>>({
      prompt: opts.oraclePrompt(opts.text, opts.scope),
      generator: opts.generator,
      schema: opts.oracleSchema,
      retries: opts.oracleRetries ?? 2,
    });
  } catch (err) {
    console.error("[freeform-pipeline] oracle call failed:", err);
    return { prose: "", intent: null, policyOutcome: "error" };
  }

  let delta = oracleDelta.delta;
  let policyOutcome: PolicyOutcome;

  // 3. Policy gate.
  const valid = opts.validateDelta ? opts.validateDelta(delta) : true;

  if (valid) {
    policyOutcome = "oracle-applied";
  } else if (policy === "strict") {
    return { prose: "", intent: null, delta, policyOutcome: "rejected" };
  } else {
    // coerce
    delta = opts.coerceDelta ? opts.coerceDelta(delta) : delta;
    policyOutcome = "oracle-coerced";
  }

  // 4. Apply delta.
  opts.applyDelta(delta);

  // 5. Render.
  const prose = await opts.render(oracleDelta.stub, null);
  return { prose, intent: null, delta, policyOutcome };
}
