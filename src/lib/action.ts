/*
 * action.ts — declarative actions (abilities) with cost/range/filter/effects.
 *
 * WHAT: An ActionDef declares a resource cost map, an optional range, a target
 *       filter `(actor, candidate, world) => bool`, a list of EffectDefs to
 *       apply on hit, a cooldown, and free-form tags. Pure-data; combat-turn
 *       and combat-realtime both consume these.
 *
 * WHY: Rule #2 (def with no behaviour beyond data; resolution lives in
 *       combat-*). Rule #3 (validation returns reasons; the stage decides
 *       whether to refuse, prompt, or auto-substitute).
 *
 * SHAPE:
 *   interface ActionDef<A, T, W> {
 *     id; costs: Record<resource, number>;
 *     range?: number;
 *     targetFilter?: (actor, target, world) => boolean;
 *     effects: EffectDef[];
 *     cooldown?: number;     // in stage time units
 *     tags?: string[];
 *     displayName?; description?;
 *   }
 *   type Resources = Record<string, number>
 *   interface ActorWithCooldowns { cooldowns?: Record<actionId, number> }
 *   validateAction(def, actor, target?, world?, now?): { ok: true } | { ok: false, reason }
 *   payCosts(actor, costs): boolean
 *   markCooldown(actor, def, now): void
 *   isOnCooldown(actor, def, now): boolean
 */

import { EffectDef } from "./effects";

export interface ActionDef<A = unknown, T = unknown, W = unknown> {
  id: string;
  costs: Record<string, number>;
  range?: number;
  targetFilter?: (actor: A, target: T, world: W) => boolean;
  effects: EffectDef[];
  cooldown?: number;
  tags?: string[];
  displayName?: string;
  description?: string;
}

export interface ActorWithResources {
  resources?: Record<string, number>;
  cooldowns?: Record<string, number>;
  position?: { x: number; y: number };
}

export type ValidateResult =
  | { ok: true }
  | { ok: false; reason: "on_cooldown"; until: number }
  | { ok: false; reason: "insufficient_resource"; resource: string; need: number; have: number }
  | { ok: false; reason: "out_of_range"; distance: number; range: number }
  | { ok: false; reason: "filter_failed" };

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function validateAction<A extends ActorWithResources, T extends ActorWithResources, W>(
  def: ActionDef<A, T, W>,
  actor: A,
  target?: T,
  world?: W,
  now = 0,
): ValidateResult {
  if (isOnCooldown(actor, def as unknown as { id: string }, now))
    return { ok: false, reason: "on_cooldown", until: (actor.cooldowns?.[def.id] ?? 0) };
  const have = actor.resources ?? {};
  for (const [r, n] of Object.entries(def.costs)) {
    const cur = have[r] ?? 0;
    if (cur < n) return { ok: false, reason: "insufficient_resource", resource: r, need: n, have: cur };
  }
  if (def.range !== undefined && actor.position && target?.position) {
    const d = distance(actor.position, target.position);
    if (d > def.range) return { ok: false, reason: "out_of_range", distance: d, range: def.range };
  }
  if (def.targetFilter && target !== undefined && world !== undefined) {
    if (!def.targetFilter(actor, target, world)) return { ok: false, reason: "filter_failed" };
  }
  return { ok: true };
}

export function payCosts(actor: ActorWithResources, costs: Record<string, number>): boolean {
  const have = actor.resources ?? (actor.resources = {});
  for (const [r, n] of Object.entries(costs)) if ((have[r] ?? 0) < n) return false;
  for (const [r, n] of Object.entries(costs)) have[r] = (have[r] ?? 0) - n;
  return true;
}

export function markCooldown(
  actor: ActorWithResources,
  def: { id: string; cooldown?: number },
  now: number,
): void {
  if (!def.cooldown || def.cooldown <= 0) return;
  (actor.cooldowns ??= {})[def.id] = now + def.cooldown;
}

export function isOnCooldown(
  actor: ActorWithResources,
  def: { id: string },
  now: number,
): boolean {
  const until = actor.cooldowns?.[def.id];
  return until !== undefined && now < until;
}
