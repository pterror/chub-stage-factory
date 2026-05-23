/*
 * tag-parser.ts — extract <tag>…</tag> blocks from LLM responses.
 *
 * WHAT: A configurable schema declares which tags to extract, their type, and
 *       optional max length / required flag. `parseTags(text, schema)` returns
 *       a Result with `parsed`, `stripped` (the text minus the matched tag
 *       blocks), and `errors`. Tags absent from the schema are left in
 *       `stripped` unchanged — the parser is permissive, not greedy.
 *
 * WHY: The classic LLM contract is "answer in plain text, then emit
 *       <intent>flee</intent>". The stage wants both the plain narrative
 *       and the structured fields without coupling the LLM to JSON. This
 *       module is the seam.
 *
 * SHAPE:
 *   type FieldKind = "string" | "int" | "float" | "bool" | "list"   // list is comma-sep
 *   interface FieldSpec { kind: FieldKind; required?: boolean; max?: number;
 *     enum?: string[]; default?: unknown }
 *   type Schema = Record<tagName, FieldSpec>
 *   interface ParseError { tag: string; reason: string }
 *   interface ParseResult<T = Record<string, unknown>> {
 *     ok: boolean; parsed: T; stripped: string; errors: ParseError[]
 *   }
 *   parseTags(text, schema, opts?: { stripUnknown?: boolean }): ParseResult
 *   parseTagsBatch(text, schemas, opts?): ParseResult[]  — single pass, one result per schema
 */

export type FieldKind = "string" | "int" | "float" | "bool" | "list";

export interface FieldSpec {
  kind: FieldKind;
  required?: boolean;
  max?: number;
  enum?: string[];
  default?: unknown;
}

export type Schema = Record<string, FieldSpec>;

export interface ParseError {
  tag: string;
  reason: string;
}

export interface ParseResult<T = Record<string, unknown>> {
  ok: boolean;
  parsed: T;
  stripped: string;
  errors: ParseError[];
}

function coerce(raw: string, spec: FieldSpec): { value: unknown; error?: string } {
  const trimmed = raw.trim();
  if (spec.max !== undefined && trimmed.length > spec.max) {
    return { value: trimmed.slice(0, spec.max), error: `exceeds max length ${spec.max}` };
  }
  switch (spec.kind) {
    case "string": {
      if (spec.enum && !spec.enum.includes(trimmed))
        return { value: trimmed, error: `not in enum [${spec.enum.join(", ")}]` };
      return { value: trimmed };
    }
    case "int": {
      const n = parseInt(trimmed, 10);
      if (Number.isNaN(n)) return { value: 0, error: "not an int" };
      return { value: n };
    }
    case "float": {
      const f = parseFloat(trimmed);
      if (Number.isNaN(f)) return { value: 0, error: "not a float" };
      return { value: f };
    }
    case "bool": {
      const t = trimmed.toLowerCase();
      if (["true", "yes", "1", "on"].includes(t)) return { value: true };
      if (["false", "no", "0", "off"].includes(t)) return { value: false };
      return { value: false, error: "not a bool" };
    }
    case "list": {
      const items = trimmed
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (spec.enum) {
        const bad = items.filter((x) => !spec.enum!.includes(x));
        if (bad.length) return { value: items, error: `items not in enum: ${bad.join(", ")}` };
      }
      return { value: items };
    }
  }
}

export function parseTags<T = Record<string, unknown>>(
  text: string,
  schema: Schema,
  opts: { stripUnknown?: boolean } = {},
): ParseResult<T> {
  const parsed: Record<string, unknown> = {};
  const errors: ParseError[] = [];
  let stripped = text;

  for (const [tag, spec] of Object.entries(schema)) {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "gi");
    const matches: string[] = [];
    stripped = stripped.replace(re, (_full, body: string) => {
      matches.push(body);
      return "";
    });
    if (matches.length === 0) {
      if (spec.required) errors.push({ tag, reason: "missing" });
      else if (spec.default !== undefined) parsed[tag] = spec.default;
      continue;
    }
    const { value, error } = coerce(matches[matches.length - 1], spec);
    parsed[tag] = value;
    if (error) errors.push({ tag, reason: error });
  }

  if (opts.stripUnknown) {
    stripped = stripped.replace(/<([a-zA-Z][\w-]*)>[\s\S]*?<\/\1>/g, "");
  }

  return {
    ok: errors.length === 0,
    parsed: parsed as T,
    stripped: stripped.trim(),
    errors,
  };
}

/**
 * Parse multiple schemas against the same text in a single pass.
 * Each schema is applied independently to the original text; the stripped
 * text from the previous schema is fed into the next, so each schema sees
 * whatever tags the previous schemas did not consume. Returns one ParseResult
 * per schema in input order.
 *
 * Use this in place of chained `parseTags` calls to collapse boilerplate.
 */
export function parseTagsBatch<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  schemas: Schema[],
  opts: { stripUnknown?: boolean } = {},
): ParseResult<T>[] {
  const results: ParseResult<T>[] = [];
  let current = text;
  for (const schema of schemas) {
    const r = parseTags<T>(current, schema, opts);
    results.push(r);
    current = r.stripped;
  }
  return results;
}
