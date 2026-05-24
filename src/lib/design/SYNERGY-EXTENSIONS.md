# Synergy Pattern Extensions design
> Synthesized 2026-05-24 from src/lib/mining/SYNERGY.md.
> Implementation-ready: 14 new patterns + 2 anti-patterns + 1 framing-primitive proposal.
---

## 1. Framing-primitive proposal: `llm-pipeline.ts`

Mining observation §52: the AID Scripting `triple-hook-pipeline + quiet-generation-sub-call + state-object` trio is the most general substrate; our existing 8 synergy patterns can all be re-expressed inside it. This is a load-bearing **wrapper shape**, not a composition of existing primitives — `ContextAssembler` assembles, but no current primitive owns the input-rewrite / context-mutate / output-rewrite envelope that wraps each LLM call.

**Decision: ship as a NEW PRIMITIVE in Wave 2I** (sibling to `context.ts`), not as a pattern. Per the supply-driven rule in `COMPOSITION.md`: distinct architectural shape + earns its keep → primitive.

```ts
// src/lib/llm-pipeline.ts
export interface PipelineDelta<S> { rewritten: string; stateDelta?: Partial<S> }
export interface QuietResult<S>   { result: string; stateDelta?: Partial<S> }

export interface LlmPipeline<S> {
  state: S;
  inputModifier?:   (input: string, state: S) => PipelineDelta<S>;
  contextModifier?: (assembler: ContextAssembler, state: S) => void;
  outputModifier?:  (output: string, state: S) => PipelineDelta<S>;
  quietCall?:       (prompt: string, state: S) => Promise<QuietResult<S>>;
}

export interface TurnResult { input: string; prompt: string; output: string }

export class LlmPipelineRunner<S> {
  constructor(private pipeline: LlmPipeline<S>, private assembler: ContextAssembler,
              private generator: GenerationService) {}
  async runTurn(playerInput: string): Promise<TurnResult> { /* see LLM-PIPELINE.md */ }
  async runQuiet(prompt: string): Promise<string> { /* routes through quietCall */ }
}
```

The runner threads `state` through every hook, applies `stateDelta`s atomically, and exposes `runQuiet` so sub-call patterns (#9, #12) share the same routing. `state` lives as a `Shard` like any other persistent primitive; the runner does not own persistence.

## 2. Fourteen new pattern composers

Each composer returns `{ state, observations, hooks, shards }` (the `ComposedSubsystem<S>` shape from `COMPOSITION.md`). Files live at `src/lib/patterns/synergy/<name>.ts` (~30–60 LOC each).

### 1. `recursiveKeyExpansionPattern`
**Composes**: `Registry<WIEntry>` + `tag-parser` + `ConditionalTrigger` (predicate gate per entry) + `ContextAssembler` (re-runs scan on injected text up to `maxDepth`).
**Signature**: `recursiveKeyExpansionPattern({ entries, maxDepth = 3, preventFurther }): ComposedSubsystem<{depth: number; fired: Set<string>}>`.
**Source**: SillyTavern WI recursion; NovelAI cascading activation.
```ts
const wi = recursiveKeyExpansionPattern({
  entries: loreRegistry, maxDepth: 3,
  preventFurther: id => loreRegistry.require(id).noRecurse,
});
assembler.register(wi.contributors.injectionContributor);
store.add(wi.shards.firedShard);
```

### 2. `positionalInjectionDepthPattern`
**Composes**: `ContextAssembler` priority + a new `position: { depth: number; role: "system"|"user"|"assistant" }` annotation on `ContextContributor`.
**Signature**: `positionalInjectionDepthPattern({ entries, defaultDepth = 4 }): ComposedSubsystem<{}>`.
**Source**: SillyTavern WI position field; AID Front Memory / Author's Note depth ~3.
```ts
const pos = positionalInjectionDepthPattern({
  entries: [{ id: "an", content: "Style: noir", depth: 3, role: "system" }],
});
pos.contributors.forEach(c => assembler.register(c));
```
**FLAG**: `Section` currently has no `position`/`role` fields. Either extend `Section` or introduce a `PositionedSection` subtype in `context.ts`. Small additive change, not a new primitive.

### 3. `inclusionGroupMutexPattern`
**Composes**: `Registry<WIEntry>` (with `group: string`) + `predicate` + `rng.weightedChoice`.
**Signature**: `inclusionGroupMutexPattern({ entries, tieBreak = "weight" }): ComposedSubsystem<{}>`.
**Source**: SillyTavern Inclusion Groups.
```ts
const mutex = inclusionGroupMutexPattern({ entries: flavorRegistry });
assembler.register(mutex.contributors.groupContributor);
```

### 4. `stickyCooldownDelayTimersPattern`
**Composes**: `Registry` + `ConditionalTrigger.cooldown` + `Scheduler` (turn-counter) + a small `{ sticky, cooldown, delay }` per-id state map.
**Signature**: `stickyCooldownDelayTimersPattern({ entries }): ComposedSubsystem<{timers: Record<string, TimerState>}>`.
Explicitly NOT a new state machine — it is a `Scheduler` tick that decrements counters and a predicate that reads them.
**Source**: SillyTavern WI Timed Effects.
```ts
const timed = stickyCooldownDelayTimersPattern({ entries: loreRegistry });
scheduler.every("turn", timed.hooks.tick);
```

### 5. `recencyFrequencyEvictionPattern`
**Composes**: `ContextAssembler` (already drops on overflow) + per-entry `{ lastFiredAt, fireCount }` Shard + a custom priority function `recencyFreq(state) = w1·recency + w2·freq`.
**Signature**: `recencyFrequencyEvictionPattern({ entries, weights }): ComposedSubsystem<{stats: Map<string, {at, n}>}>`.
**Source**: AID Story Cards prioritization.
```ts
const rfe = recencyFrequencyEvictionPattern({ entries: loreRegistry, weights: { recency: 0.7, freq: 0.3 }});
rfe.contributors.forEach(c => assembler.register(c));
```

### 6. `forceActivateWithBudgetCapPattern`
**Composes**: `ContextAssembler` with `optional: true, priority: high` contributors that have no predicate (always emit) and drop silently on overflow.
**Signature**: `forceActivateWithBudgetCapPattern({ entries, priority = 90 }): ComposedSubsystem<{}>`.
**Source**: NovelAI Force Activation; SillyTavern Constant entries.
```ts
const forced = forceActivateWithBudgetCapPattern({ entries: alwaysOnLore });
forced.contributors.forEach(c => assembler.register(c));
```

### 7. `subcontextGroupBudgetingPattern`
**Composes**: a **nested** `ContextAssembler` per group (inner assembler owns the group's budget; outer treats the inner's output as one `Section`).
**Signature**: `subcontextGroupBudgetingPattern({ group: { id, budget, contributors }[] }): ComposedSubsystem<{}>`.
**Source**: NovelAI Subcontext.
```ts
const sub = subcontextGroupBudgetingPattern({
  group: [{ id: "lore", budget: 800, contributors: loreContribs }],
});
sub.contributors.forEach(c => assembler.register(c));
```

### 8. `triplehookPipelinePattern` (wraps `llm-pipeline.ts`)
**Composes**: `LlmPipelineRunner` with author-supplied `inputModifier` / `contextModifier` / `outputModifier` callbacks; the pattern just provides ergonomic defaults (echo identity, no-op context, regex post-clean).
**Signature**: `triplehookPipelinePattern<S>(pipeline: LlmPipeline<S>): ComposedSubsystem<S>`.
**Source**: AID Scripting.
```ts
const tp = triplehookPipelinePattern({
  state: { mood: "neutral" },
  inputModifier: (s, st) => ({ rewritten: s.replace(/lol/g, "[laughs]") }),
  outputModifier: (o, st) => ({ rewritten: o.trim() }),
});
```

### 9. `quietGenerationSubCallPattern`
**Composes**: `LlmPipelineRunner.runQuiet` + a `Registry<QuietPrompt>` of named sub-call templates; results route to `state` via `stateDelta`, never to the transcript.
**Signature**: `quietGenerationSubCallPattern({ prompts, onResult }): ComposedSubsystem<{lastQuiet?: string}>`.
**Source**: SillyTavern Quiet Mode; STscript `/gen quiet=true`.
```ts
const quiet = quietGenerationSubCallPattern({
  prompts: { summarize: "Summarize the scene in 3 lines: {{ctx}}" },
  onResult: (id, txt, st) => ({ [id]: txt }),
});
```

### 10. `scriptedQuickReplyMacroPattern`
**Composes**: `Registry<MacroDef>` + `action.ts` action specs + `LlmPipelineRunner.runQuiet` for embedded LLM steps.
**Signature**: `scriptedQuickReplyMacroPattern({ macros }): ComposedSubsystem<{}>`.
**Source**: SillyTavern STScript / Quick Replies; Guided-Generations.
```ts
const qr = scriptedQuickReplyMacroPattern({
  macros: { "/recap": [{ kind: "quiet", id: "summarize" }, { kind: "show", channel: "panel" }] },
});
```
**FLAG**: macro DSL — reuses `action.ts` shape (JSON-RPC-like). No new primitive if `action.ts` covers it; if not, a tiny `macro.ts` may be needed.

### 11. `semanticRecallOverlayPattern`
**Composes**: `Timeline` + a new `Embeddings` primitive (top-K cosine over event embeddings) + `ContextContributor`.
**Signature**: `semanticRecallOverlayPattern({ source, embed, topK = 5 }): ComposedSubsystem<{index: VectorIndex}>`.
**Source**: SillyTavern Vector Storage / Data Bank RAG.
```ts
const recall = semanticRecallOverlayPattern({ source: timeline, embed: embedder, topK: 5 });
assembler.register(recall.contributors.recallContributor);
```
**FLAG**: requires `embeddings.ts` primitive we don't have. See §7.

### 12. `scheduledSelfCheckPattern`
**Composes**: `Scheduler.every("turn", ...)` + `LlmPipelineRunner.runQuiet` + `ConditionalTrigger` to consume the verdict.
**Signature**: `scheduledSelfCheckPattern({ everyN, prompt, onVerdict }): ComposedSubsystem<{lastCheck: number}>`.
**Source**: SillyTavern Objectives Task Check Frequency.
```ts
const audit = scheduledSelfCheckPattern({
  everyN: 5, prompt: "Is the task done? yes/no",
  onVerdict: (v, st) => v.startsWith("yes") ? { taskDone: true } : {},
});
scheduler.register(audit.hooks.tick);
```

### 13. `characterFilteredActivationPattern`
**Composes**: `Predicate.actorTag("speaker", X)` + per-character `Registry<WIEntry>` namespaces + `ContextAssembler` filter.
**Signature**: `characterFilteredActivationPattern({ entries, speakerOf }): ComposedSubsystem<{}>`.
**Source**: SillyTavern WI Character Filters; per-character lorebooks.
```ts
const cf = characterFilteredActivationPattern({
  entries: loreRegistry, speakerOf: st => st.currentSpeaker,
});
cf.contributors.forEach(c => assembler.register(c));
```

### 14. `overrideSlotsPattern`
**Composes**: `ContextContributor` with `optional: false` + a very high `priority` + a slot id (e.g. `"system-prompt"`) that **replaces** rather than appends — implemented by `unregister(slotId)` then `register(newOne)` in the contextModifier hook.
**Signature**: `overrideSlotsPattern({ slots: { id, content, priority }[] }): ComposedSubsystem<{overrides: Map<string, string>}>`.
**Source**: SillyTavern character card Main Prompt override + Post-History Instructions; NovelAI Memory.
```ts
const ov = overrideSlotsPattern({
  slots: [{ id: "system-prompt", content: cardSystemPrompt, priority: 1000 }],
});
ov.hooks.beforeAssemble(assembler);
```

## 3. Two anti-patterns

Documented as `PATTERNS.md` entries in the upcoming patterns-layer commit.

### `budget-poisoning`
**What**: A single category of entries (lore, summaries, character cards) silently expands until it consumes most of the context budget, starving other contributors.
**Trigger**: `recursiveKeyExpansionPattern` + `forceActivateWithBudgetCapPattern` together, or unbounded `recencyFrequencyEvictionPattern`.
**Mitigation**: wrap each greedy category in `subcontextGroupBudgetingPattern` so its budget is bounded by construction; require `optional: true` on cascading entries; cap recursion depth.

### `key-collision`
**What**: Two entries share a key (or one entry's key is a substring of another), and both fire on the same input, double-injecting or producing contradictory lore.
**Trigger**: `recursiveKeyExpansionPattern`, `cacheByKey` with author-defined string keys, large `Registry<WIEntry>` shared across characters.
**Mitigation**: `inclusionGroupMutexPattern` to force "exactly one wins"; `characterFilteredActivationPattern` to namespace by speaker; `predicate.ts` `regex`/`glob` kinds (see §7) for tighter matchers.

## 4. File layout

- `src/lib/llm-pipeline.ts` — new Wave 2I primitive (~250 LOC).
- `src/lib/LLM-PIPELINE.md` — primitive doc (separate commit).
- `src/lib/patterns/synergy/<name>.ts` — one file per pattern (14 files, ~30–60 LOC each).
- `src/lib/PATTERNS.md` — append 14 recipes + 2 anti-pattern entries (separate commit).

## 5. Composition with existing primitives (notable cases)

- **`stickyCooldownDelayTimersPattern`**: Registry + `ConditionalTrigger.cooldown` + `Scheduler` — not a new state machine; counters live in a small Shard and the scheduler ticks them.
- **`semanticRecallOverlayPattern`**: requires `embeddings.ts` — see §7. The pattern itself is `Timeline` + `Embeddings.topK` + `ContextContributor`.
- **`scriptedQuickReplyMacroPattern`**: leans on `action.ts` shape. If macros need branching/loops a tiny `macro.ts` DSL may be required; flag rather than invent.
- **`recursiveKeyExpansionPattern`**: Registry + `tag-parser` (key scanner) + `ConditionalTrigger` with a recursion-depth guard held in pipeline state.
- **`overrideSlotsPattern`**: pure `ContextAssembler` operation — `unregister(id)` then `register(replacement)` in a `contextModifier` hook. No new persistence support needed because the override is a contributor like any other.

## 6. New dependencies surfaced

- **Vector embeddings** for #11: propose `src/lib/embeddings.ts`. Needs decision on local-transformer (transformers.js, ~30MB model download in browser) vs. API call (latency, key management). Recommend shipping a `EmbeddingService` interface with `localTransformerEmbedder()` and `apiEmbedder({fetch, url})` factories — author chooses.
- **`regex` / `glob` predicate kinds** in `predicate.ts` for tighter key matching to mitigate `key-collision`. Additive; both serialize cleanly as `{kind: "regex", source, flags}` / `{kind: "glob", pattern}`.
- **Macro DSL** for #10 — first attempt: reuse `action.ts` action specs. If branching is required, a 50-LOC `macro.ts` with sequence/quiet/action nodes.
- **`Section.position`** field for #2 — additive to `context.ts`, not a new primitive.

## 7. Critical re-framing

Our existing 8 synergy patterns can ALL be re-expressed as configurations of the `LlmPipeline` primitive — `cache-by-key` is a `contextModifier` that reads a Registry; `hierarchical-summarization` is a `quietCall` chain feeding `state`; `procgen-validates-llm` is an `outputModifier` that re-runs on rejection. This isn't a rewrite — it's a recognition. The existing patterns ship in their current shape (back-compat); `LlmPipeline` is a NEW substrate the 14 new patterns live inside, and existing patterns can OPTIONALLY be re-expressed within it for stages that want one unified envelope.

## 8. Estimated LOC

- `llm-pipeline.ts`: ~250
- 14 pattern composers: ~30–60 each → ~600 total
- `PATTERNS.md` additions (14 + 2): ~50
- New deps (if adopted): `embeddings.ts` ~150, `predicate.ts` extensions ~30, optional `macro.ts` ~50

## 9. Open questions

1. **`LlmPipeline` as primitive vs. pattern.** Defense: it owns the **wrapper shape** for every LLM call (input → context → output → quiet sub-call) and threads `state`. No combination of `ContextAssembler` + existing hooks produces it without re-inventing the runner. It does not reduce. **Recommendation: primitive.**
2. **Vector embeddings: local-only, API-only, or both?** Recommend **both via interface** (`EmbeddingService`) so the author chooses; default factory is local-transformer with a documented model-download cost.
3. **Recursion depth cap for `recursiveKeyExpansionPattern`.** Recommend **stage-configurable with hard default of 3** (matches SillyTavern's sane default; authors can raise with explicit opt-in).
4. **`overrideSlotsPattern` persistence.** It does NOT need new persistence-layer support. It produces a `ContextContributor` with `optional: false` and very high priority whose presence triggers `unregister(slotId)` of the contributor it replaces in the `contextModifier` hook. The override map itself is a small Shard like any other.
