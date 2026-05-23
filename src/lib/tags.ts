/*
 * tags.ts — tag-based identity and query DSL.
 *
 * WHAT: A TagSet is a Set<string> with a small query language layered on top.
 *       Queries are arrays of terms; each term is either "tag" (must have) or "!tag"
 *       (must not have). `matches` ANDs the terms; `matchesAny` ORs them.
 *
 * WHY: Rule #1 — identity is user-defined string tags, not hardcoded enums. Every
 *      primitive that asks a body / item / actor "what are you?" routes through here.
 *
 * SHAPE:
 *   class TagSet
 *     constructor(initial?: Iterable<string>)
 *     add(tag), remove(tag), has(tag): chainable, boolean for has
 *     hasAll(tags[]), hasAny(tags[]): boolean
 *     matchesTerm(term): boolean  // "tag" or "!tag"
 *     matches(query[]): boolean   // AND
 *     matchesAny(query[]): boolean// OR
 *     toArray(): string[]
 *     clone(): TagSet
 *     toJSON(): string[]
 *   parseTerm(term): { negate: boolean, tag: string }
 */

export interface ParsedTerm {
  negate: boolean;
  tag: string;
}

export function parseTerm(term: string): ParsedTerm {
  if (term.startsWith("!")) return { negate: true, tag: term.slice(1) };
  return { negate: false, tag: term };
}

export class TagSet {
  private _tags: Set<string>;

  constructor(initial?: Iterable<string>) {
    this._tags = new Set(initial ?? []);
  }

  add(tag: string): TagSet {
    this._tags.add(tag);
    return this;
  }

  remove(tag: string): TagSet {
    this._tags.delete(tag);
    return this;
  }

  has(tag: string): boolean {
    return this._tags.has(tag);
  }

  hasAll(tags: readonly string[]): boolean {
    for (const t of tags) if (!this._tags.has(t)) return false;
    return true;
  }

  hasAny(tags: readonly string[]): boolean {
    for (const t of tags) if (this._tags.has(t)) return true;
    return false;
  }

  matchesTerm(term: string): boolean {
    const { negate, tag } = parseTerm(term);
    const has = this._tags.has(tag);
    return negate ? !has : has;
  }

  matches(query: readonly string[]): boolean {
    for (const term of query) if (!this.matchesTerm(term)) return false;
    return true;
  }

  matchesAny(query: readonly string[]): boolean {
    for (const term of query) if (this.matchesTerm(term)) return true;
    return false;
  }

  size(): number {
    return this._tags.size;
  }

  toArray(): string[] {
    return [...this._tags];
  }

  clone(): TagSet {
    return new TagSet(this._tags);
  }

  toJSON(): string[] {
    return this.toArray();
  }

  toString(): string {
    return `Tags(${this.toArray().join(", ")})`;
  }
}
