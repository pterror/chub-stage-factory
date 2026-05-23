/*
 * chub-adapters.ts — small glue helpers for composing primitives into a Stage.
 *
 * WHAT: Helpers that compose multiple beforePrompt/afterResponse handlers,
 *       emit observation payloads as stageDirections, and apply parsed tags
 *       back into state. The Stage still extends StageBase from
 *       @chub-ai/stages-ts; these are utilities, not a framework.
 *
 * WHY: Each Stage hook returns one StageResponse object. Real stages compose
 *       several concerns (observation emission + cooldown ticking + parser
 *       reducers). Without these helpers, the stage's hook bodies grow into
 *       imperative tangles. With them, the hook body is `composeBefore(...)`.
 *
 * SHAPE:
 *   type Hook<C, M> = (msg: Message, ctx: HookCtx<C, M>) =>
 *     Promise<Partial<StageResponse<C, M>>>
 *   composeBeforePrompt(...hooks): Hook
 *   composeAfterResponse(...hooks): Hook
 *   emitStageDirections({observations, register?, prose?, prefix?}): string
 *   parseAndApply(text, parsers, reducers, ctx): { stripped, results }
 */

import type { Message, StageResponse } from "@chub-ai/stages-ts";
import { AssembledObservation, formatObservations } from "./observation";
import { ArchitectureName, RegisterSpec, RegisterPreset, proseInstructions } from "./prose-register";
import { ParseResult, Schema, parseTags } from "./tag-parser";

export interface HookCtx<C, M> {
  /** Mutable state object the stage hands the hooks. */
  state: M;
  chatState?: C | null;
  now: number;
}

export type Hook<C, M> = (
  msg: Message,
  ctx: HookCtx<C, M>,
) => Promise<Partial<StageResponse<C, M>>>;

/** Merge two partial StageResponse objects; later overrides earlier on scalars,
 *  concatenates on string fields when both present, and recursively merges
 *  messageState / chatState shallowly. */
function mergeResp<C, M>(
  a: Partial<StageResponse<C, M>>,
  b: Partial<StageResponse<C, M>>,
): Partial<StageResponse<C, M>> {
  const out: Partial<StageResponse<C, M>> = { ...a, ...b };
  if (a.stageDirections && b.stageDirections)
    out.stageDirections = `${a.stageDirections}\n${b.stageDirections}`;
  if (a.systemMessage && b.systemMessage)
    out.systemMessage = `${a.systemMessage}\n${b.systemMessage}`;
  if (a.error && b.error) out.error = `${a.error}; ${b.error}`;
  if (a.messageState && b.messageState && typeof a.messageState === "object" && typeof b.messageState === "object") {
    out.messageState = { ...(a.messageState as object), ...(b.messageState as object) } as M;
  }
  if (a.chatState && b.chatState && typeof a.chatState === "object" && typeof b.chatState === "object") {
    out.chatState = { ...(a.chatState as object), ...(b.chatState as object) } as C;
  }
  return out;
}

export function composeBeforePrompt<C, M>(...hooks: Hook<C, M>[]): Hook<C, M> {
  return async (msg, ctx) => {
    let acc: Partial<StageResponse<C, M>> = {};
    for (const h of hooks) acc = mergeResp(acc, await h(msg, ctx));
    return acc;
  };
}

export function composeAfterResponse<C, M>(...hooks: Hook<C, M>[]): Hook<C, M> {
  return composeBeforePrompt(...hooks);
}

/**
 * Build the `stageDirections` string that pairs a prose-instruction block
 * with an observation payload. Stages should call this in beforePrompt.
 */
export function emitStageDirections(opts: {
  observations: readonly AssembledObservation[];
  architectures?: readonly ArchitectureName[];
  register?: RegisterSpec | RegisterPreset;
  prefix?: string;
}): string {
  const parts: string[] = [];
  if (opts.prefix) parts.push(opts.prefix);
  if (opts.architectures?.length && opts.register)
    parts.push(proseInstructions({ architectures: opts.architectures, register: opts.register }));
  if (opts.observations.length) parts.push(formatObservations(opts.observations));
  return parts.join("\n");
}

export type Reducer<S, T> = (state: S, parsed: T, errors: ParseResult<T>["errors"]) => void;

/**
 * Run each parser/schema against `text`; for each, call its reducer with the
 * parsed values and any errors. Reducers mutate the supplied state. Returns
 * the cumulatively-stripped text (each parser's match removed) so the stage
 * can hand the cleaned narrative to the user.
 */
export function parseAndApply<S>(
  text: string,
  pairs: { schema: Schema; reduce: Reducer<S, Record<string, unknown>> }[],
  state: S,
): { stripped: string; results: ParseResult[] } {
  let stripped = text;
  const results: ParseResult[] = [];
  for (const { schema, reduce } of pairs) {
    const r = parseTags(stripped, schema);
    results.push(r);
    stripped = r.stripped;
    reduce(state, r.parsed, r.errors);
  }
  return { stripped, results };
}
