# Intent — player command extraction

`parseIntent(input, scope, options?)` extracts a structured
`Intent { verb, target?, instrument?, modifier? }` from raw player
text. Two-layer: deterministic grammar first, LLM oracle fallback on
miss.

Narrow first cut for Wave 2B. Full Wave 2B extends this with
`world.ts` scope integration (objects/exits in the visible room graph)
and richer grammar from Zork/CCA prior art. The surface stays the same.

## The shape

```ts
interface Intent {
  verb:        string;   // canonical: "go", "take", "examine", "use", "talk", ...
  target?:     string;   // primary noun, scope-resolved when possible
  instrument?: string;   // secondary noun ("use key WITH door")
  modifier?:   string;   // adverb ("quietly", "carefully", ...)
}
```

## Grammar layer

`parseIntentSync(input, scope, synonyms?)` — synchronous, zero async,
no LLM calls.

1. Tokenise and strip filler words (the, a, my, …).
2. First token is the verb; mapped through a built-in synonym table
   (80+ entries — "grab" → "take", "look" → "examine", etc.) merged
   with any stage-author synonyms.
3. Last token is matched against a known-modifier list ("quietly",
   "carefully", …); stripped from the noun phrase if matched.
4. Remaining tokens: if an instrument preposition ("with", "using",
   "to", "at", …) is present, the noun phrase before it is `target`
   and the phrase after is `instrument`; otherwise everything is
   `target`.
5. Noun phrases are joined with `-` and scope-resolved: if the phrase
   matches a scope member directly, or maps through the noun synonym
   table to one, the canonical scope id is returned.

Returns `Intent | null`. Returns `null` only if the token stream
has no verb (empty input, pure punctuation, etc.).

## Scope resolution

`scope: ReadonlySet<string>` is the set of noun ids visible to the
player at this moment — location exits, present objects, present
NPCs. Supplied by the stage author from whatever world representation
they use.

Resolution is advisory (not blocking): if the noun phrase does not
match any scope member, the raw resolved form is returned. Strict
scope enforcement (reject unrecognised nouns) is a policy decision
for the stage author, not the intent layer.

## LLM fallback

```ts
interface LlmFallback {
  quietCall(prompt: string): Promise<string>;
}
```

When `options.fallback` is supplied and the grammar returns `null`,
the fallback receives a structured prompt:

```
The player typed: "jump over the crate"
Available objects/exits: north, crate, merchant
...
Reply with ONLY the JSON object, no commentary.
```

The response is parsed as a JSON `Intent` object. On parse failure,
`null` is returned. The caller is responsible for any retry / escalation.

Wire via `LlmPipelineRunner.runQuiet` for the oracle role:

```ts
const fallback: LlmFallback = {
  quietCall: (prompt) => runner.runQuiet(prompt),
};

const intent = await parseIntent(playerInput, scope, { synonyms, fallback });
```

## North star 4 — provenance-neutral

The grammar layer works with no LLM dependency. `parseIntentSync` is
pure: same input + same scope + same synonyms → same output. The
fallback is additive. Stages that want fully deterministic intent
parsing pass no `fallback`.

## Synonym table

Built-in table covers ~80 common IF verb aliases. Stage authors extend
it via `options.synonyms.verbs` and `options.synonyms.nouns`:

```ts
parseIntent(input, scope, {
  synonyms: {
    verbs: { seduce: "talk", flirt: "talk" },
    nouns:  { barkeep: "innkeeper", barman: "innkeeper" },
  },
});
```

Stage-author entries take precedence over the built-in table for
nouns; for verbs they extend (the built-in table is merged first, then
stage entries overwrite).

## Related

- `patterns/freeform-pipeline.ts` — wires `parseIntent` into the
  full freeform text → delta → render loop.
- `trigger.ts` — `ConditionalTrigger` for event-driven scene firing
  (orthogonal to intent parsing).
- `world.ts` (Wave 2B) — will supply `scope` as `world.visibleObjects(location)`.
