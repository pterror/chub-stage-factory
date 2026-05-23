/*
 * constraints.ts — constraint detection (not resolution).
 *
 * WHAT: Pure-function predicates that check tag queries against a TagSet and
 *       return Violation records (or null on pass). Plus two example resolution
 *       helpers — `resolveUnequip` and `resolveDegrade` — that operate on those
 *       records. Stages can write their own resolvers.
 *
 * WHY: Rule #3 (detect-vs-resolve). The library detects; the stage decides.
 *
 * SHAPE:
 *   interface Violation { source, constraint, failedTerms, context? }
 *   check(source, constraint, tags, context?): Violation | null
 *   checkAll(constraintsBySource, tags): Violation[]
 *   resolveUnequip(violations): string[]                    // sources to unequip
 *   resolveDegrade(violations): Record<string, string[]>     // source -> failed terms
 */

import { TagSet } from "./tags";

export interface Violation {
  source: string;
  constraint: readonly string[];
  failedTerms: string[];
  context?: Record<string, unknown>;
}

export function check(
  source: string,
  constraint: readonly string[],
  tags: TagSet,
  context?: Record<string, unknown>,
): Violation | null {
  const failed: string[] = [];
  for (const term of constraint) if (!tags.matchesTerm(term)) failed.push(term);
  if (failed.length === 0) return null;
  return { source, constraint, failedTerms: failed, context };
}

export function checkAll(
  constraintsBySource: Record<string, readonly string[]>,
  tags: TagSet,
): Violation[] {
  const out: Violation[] = [];
  for (const source of Object.keys(constraintsBySource)) {
    const v = check(source, constraintsBySource[source], tags);
    if (v) out.push(v);
  }
  return out;
}

export function resolveUnequip(violations: readonly Violation[]): string[] {
  return violations.map((v) => v.source);
}

export function resolveDegrade(violations: readonly Violation[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const v of violations) out[v.source] = [...v.failedTerms];
  return out;
}
