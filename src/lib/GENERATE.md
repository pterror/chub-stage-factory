# Generate — LLM-call primitive with schema, retry, cache

`generate(opts)` is the single surface for "ask the LLM for
structured content." Wraps `GenerationService.textGen` with a schema
parser, retry-on-parse-failure with a self-correcting augmented
prompt, and optional caching into a caller-supplied
`PlaceholderRegistry`. `generativeRegistry(opts)` bundles the
cache-by-key + auto-generate-on-miss flow.

The library does NOT own a global cache. The cache lives in a
stage-supplied Registry which the stage shards however it likes
(chat-state, message-state, or none).

## One-shot generation

```ts
import { generate } from "./lib/generate";

interface Cyberware {
  name: string;
  slot: string;
  effect: string;
}

const def = await generate<Cyberware>({
  prompt: "Invent a piece of cyberware for the eye slot. Reply as JSON: {\"name\":\"\",\"slot\":\"eye\",\"effect\":\"\"}",
  generator: this.generator,
  schema: (text) => {
    const m = /\{[\s\S]*\}/.exec(text);
    if (!m) return null;
    try {
      const o = JSON.parse(m[0]);
      if (typeof o.name === "string" && typeof o.effect === "string") return o;
      return null;
    } catch { return null; }
  },
  retries: 3,
});
```

On schema-parse failure, the next attempt re-prompts with:

```
<original prompt>

Your previous response could not be parsed.
Reason: response did not match expected schema (attempt N).
Please try again, following the requested format exactly.
```

After `retries` exhausted, throws. Stage code wraps with try/catch
and decides whether to placeholder, retry later, or surface the
failure.

## Cache by key

```ts
import { generate } from "./lib/generate";
import { PlaceholderRegistry } from "./lib/registry";

cyberware = new PlaceholderRegistry<Cyberware>();

const def = await generate<Cyberware>({
  prompt: promptForCyberware("cw_optic_3"),
  generator: this.generator,
  schema: cyberwareSchema,
  cacheKey: "cw_optic_3",
  cache: this.cyberware,
});
```

Lookup before call; store on success. If `cacheKey` is set and the
registry already has a real (non-placeholder) entry for that id, the
LLM call is skipped entirely.

## generativeRegistry — the headline pattern

The "LLM generates content on demand, persisted thereafter" flow that
shows up in every Wave 3 stage:

```ts
import { generativeRegistry } from "./lib/generate";
import { PlaceholderRegistry } from "./lib/registry";

cyberware = new PlaceholderRegistry<Cyberware>();
genCyberware = generativeRegistry({
  base: this.cyberware,
  generator: this.generator,
  promptFor: (id) => `Invent cyberware id=${id}. Reply JSON: ...`,
  schema: cyberwareSchema,
  placeholderFor: (id) => ({ name: "(generating...)", slot: "?", effect: "" }),
});

// Usage anywhere in the stage:
const def = await this.genCyberware.getOrGenerate("cw_optic_3");
```

Behavior:

- Cache hit → returned immediately, no LLM call.
- Cache miss → `placeholderFor` (if supplied) registers a placeholder
  so concurrent `waitFor` callers see "still generating," then
  generation runs and the placeholder is replaced.
- Concurrent calls for the same id coalesce: one generation, multiple
  awaiters get the same Promise.

Shard the underlying `base` registry to persist generated content
across reloads:

```ts
cyberwareShard: shardOf(
  "cyberware", this.cyberware,
  (d) => PlaceholderRegistry.fromJSON<Cyberware>(d),
  this.layers.chatStateBackend, forbidBranching(snapshotHistory()),
),
```

`chatStateBackend + forbidBranching` is the right default: once the
LLM invents something, it stays invented across swipes.

## Synergy patterns this composes

Per ROADMAP's synergy catalog:

- **cache-by-key** — exactly what `generate({ cacheKey, cache })` does.
- **fallback-chain** — the `PlaceholderRegistry`'s "real if present,
  generate if absent" is the fallback. Extend with classifier fallback
  for intent parsing (deterministic grammar first, LLM on miss).
- **procgen-validates-llm** — pass a strict `schema` parser that
  rejects LLM output failing mechanical invariants (loot respects
  power curve, monster respects difficulty band); the retry loop is
  free.
- **llm-constrained-by-procgen** — generate one field at a time;
  procgen produces the skeleton, generate fills the slots.

## When NOT to use generate

- Zero-shot classification (text → scored labels): use
  `classifier.ts` instead. `generate` is for open-ended content; the
  classifier is for "which bucket."
- Hot-path procgen with no narrative dimension: pure `procgen.ts` is
  faster and deterministic. Reserve `generate` for content where the
  LLM's prose is the point.
- "Just call textGen once": skip the wrapper. `generate` earns its
  keep at retry boundary; one-call cases without schema don't need it.
