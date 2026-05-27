# Tag Parser — extract structured fields from LLM responses

`parseTags` strips `<tagname>…</tagname>` blocks from an LLM response
and coerces the content to typed values according to a schema. The
leftover text is returned as `stripped`, preserving the narrative prose
while handing mechanical fields to the stage.

Used in `afterResponse` hooks and `patterns/scene.ts` to pull intent
signals, arousal deltas, and state mutations out of model output without
coupling the LLM to JSON.

## Concepts

A **schema** maps tag names to `FieldSpec`. The parser is permissive:
unknown tags (not in the schema) are left in `stripped` unless
`opts.stripUnknown` is set. If a tag appears multiple times, only the
last occurrence is used.

`parseTagsBatch` applies multiple schemas in a single pass. Each schema
receives the `stripped` output of the previous one, so schemas compose
without re-scanning the same text.

## API [`src/lib/tag-parser.ts`](./tag-parser.ts#L93-L153)

- `parseTags(text, schema, opts?)` — returns `{ ok, parsed, stripped, errors }`
- `parseTagsBatch(text, schemas[], opts?)` — one result per schema; schemas chain on `stripped`

`FieldKind` values: `"string"`, `"int"`, `"float"`, `"bool"`, `"list"`
(list is comma-separated).

## Example

```ts
const { parsed, stripped } = parseTags(llmOutput, {
  intent:  { kind: "string", enum: ["flee", "attack", "talk"] },
  arousal: { kind: "float", default: 0 },
});
// stripped is the prose without the tag blocks
// parsed.intent / parsed.arousal are typed
```

## Gotchas

- `required` fields that are absent add a `{ tag, reason: "missing" }` to
  `errors` and set `ok = false`. The `parsed` object still contains any
  fields that were found; partial results are usable.
- `enum` violations are soft: the value is coerced and stored, but an
  error is also emitted.
- `bool` coercion maps `"true"`, `"yes"`, `"1"`, `"on"` → `true`;
  everything else → `false`.
