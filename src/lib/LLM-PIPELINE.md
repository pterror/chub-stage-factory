# LlmPipeline — composable LLM-call envelope

`LlmPipeline<S>` is the wrapper shape every LLM call passes through:
input rewrite, context mutation, output rewrite, and an out-of-band
quiet sub-call channel — all threaded by a persistent `state: S`.
`LlmPipelineRunner<S>` drives the four hooks around each `textGen`
call and applies any returned `stateDelta` shallowly.

Surfaced from the SYNERGY mining run (`src/lib/mining/SYNERGY.md` §52)
as the AID Scripting `triple-hook-pipeline + quiet-generation-sub-call
+ state-object` trio. The shape does not reduce to existing primitives
— `ContextAssembler` assembles, but no primitive owns the
input/context/output/quiet envelope or threads stage state through
it. Shipped as a primitive (not a pattern) per the supply-driven rule
in `COMPOSITION.md`.

The 14 Wave 2I synergy patterns compose inside this primitive; the
existing 8 synergy patterns can OPTIONALLY be re-expressed inside it
for stages that want one unified envelope (no rewrite required for
back-compat).

## The shape

```ts
interface PipelineDelta<S> { rewritten: string; stateDelta?: Partial<S> }
interface QuietResult<S>   { result: string; stateDelta?: Partial<S> }

interface LlmPipeline<S> {
  state: S;
  inputModifier?:   (input, state) => PipelineDelta<S> | Promise<PipelineDelta<S>>;
  contextModifier?: (assembler, state) => void | Promise<void>;
  outputModifier?:  (output, state) => PipelineDelta<S> | Promise<PipelineDelta<S>>;
  quietCall?:       (prompt, state) => Promise<QuietResult<S>>;
}

class LlmPipelineRunner<S> {
  constructor(pipeline, assembler, generator, options?);
  runTurn(playerInput): Promise<TurnResult>;
  runQuiet(prompt): Promise<string>;
}
```

Hook order per `runTurn`:

1. `inputModifier(input, state)` — rewrites the player input.
2. `contextModifier(assembler, state)` — registers / unregisters /
   re-prioritises contributors before assembly.
3. `assembler.assemble(ctx)` — builds the prompt.
4. `generator.textGen({ prompt, max_tokens })` — raw output.
5. `outputModifier(output, state)` — final rewrite.

`stateDelta` returned from any hook is merged into `pipeline.state`
via `Object.assign` before the next hook runs. The runner does not
own persistence; shard `pipeline.state` directly via the persistence
cluster.

## Quiet sub-calls

`runQuiet(prompt)` routes through `pipeline.quietCall` if supplied,
otherwise falls back to a plain `textGen` with a smaller default
`max_tokens` (300 vs 500). Quiet results never enter the transcript;
they inform `state` only. Useful for self-checks, summaries, verdicts,
and macro-step LLM calls.

## Wiring

```ts
import { ContextAssembler, systemInstructionsContributor } from "./lib/context";
import { LlmPipelineRunner } from "./lib/llm-pipeline";

const assembler = new ContextAssembler({ budget: 4000 });
assembler.register(systemInstructionsContributor("You are a noir detective."));

const runner = new LlmPipelineRunner(
  {
    state: { mood: "neutral", clueCount: 0 },
    inputModifier: (input, state) => ({
      rewritten: input.replace(/lol/g, "[laughs]"),
    }),
    outputModifier: (output, state) => ({
      rewritten: output.trim(),
      stateDelta: { clueCount: state.clueCount + (output.includes("CLUE") ? 1 : 0) },
    }),
  },
  assembler,
  generator,
);

const turn = await runner.runTurn("look around");
// turn.input / turn.prompt / turn.output
```

## Synergy patterns

The 14 Wave 2I patterns at `src/lib/patterns/synergy/` either compose
inside `LlmPipelineRunner` directly or operate at the assembler /
contributor layer it drives. One-paragraph usage per pattern:

### `recursiveKeyExpansionPattern`

SillyTavern WI recursion. Walks key matchers across `ctx.stage.scanText`;
fired entries' content is re-scanned up to `maxDepth` (default 3). Set
`preventFurther(id)` to mark entries that should not seed further
scans.

```ts
const wi = recursiveKeyExpansionPattern({
  entries: loreRegistry, maxDepth: 3,
  preventFurther: id => loreRegistry.require(id).noRecurse,
});
wi.contributors!.forEach(c => assembler.register(c));
```

### `positionalInjectionDepthPattern`

SillyTavern WI position field + AID Front Memory / Author's Note
depth. Emits one contributor per entry, each setting
`Section.position: { depth }` so the assembler injects at a known
offset from the end of the prompt. Requires the Wave 2I `Section.position`
extension.

```ts
const pos = positionalInjectionDepthPattern({
  entries: [{ id: "an", content: "Style: noir", depth: 3, role: "system" }],
});
pos.contributors!.forEach(c => assembler.register(c));
```

### `inclusionGroupMutexPattern`

SillyTavern Inclusion Groups. Entries tagged with `group`; at most one
entry per group fires per turn. Tie-break by `weight` (default) or by
registration order.

```ts
const mutex = inclusionGroupMutexPattern({ entries: flavorEntries });
mutex.contributors!.forEach(c => assembler.register(c));
```

### `stickyCooldownDelayTimersPattern`

SillyTavern WI Timed Effects. `sticky` (force fire N turns after first
fire), `cooldown` (block fire N turns after fire), `delay` (block fire
until N turns from now). Counters live in a small Shard; the pattern
exposes `tick`, `shouldFire(id)`, `markFired(id)` — no new state
machine.

```ts
const timed = stickyCooldownDelayTimersPattern({ entries: loreEntries });
scheduler.every("turn", timed.hooks!.tick);
```

### `recencyFrequencyEvictionPattern`

AID Story Cards prioritization. Each entry's effective priority is
`base + w_recency * recency + w_freq * fireCount`. Lets the assembler's
overflow-drop layer evict cold entries while keeping hot ones.

```ts
const rfe = recencyFrequencyEvictionPattern({
  entries: loreEntries, weights: { recency: 0.7, freq: 0.3 },
});
rfe.contributors!.forEach(c => assembler.register(c));
```

### `forceActivateWithBudgetCapPattern`

NovelAI Force Activation / SillyTavern Constant entries. Always-emit
contributors at high priority + `optional: true` — they render when
budget permits and drop silently otherwise. Pair with
`subcontextGroupBudgetingPattern` to mitigate `budget-poisoning`.

```ts
const forced = forceActivateWithBudgetCapPattern({ entries: alwaysOnLore });
forced.contributors!.forEach(c => assembler.register(c));
```

### `subcontextGroupBudgetingPattern`

NovelAI Subcontext. Each group owns a nested `ContextAssembler` with
its own budget; the outer assembler treats the group's assembled
output as one Section. One greedy category cannot starve the others.

```ts
const sub = subcontextGroupBudgetingPattern({
  group: [{ id: "lore", budget: 800, contributors: loreContribs }],
});
sub.contributors!.forEach(c => assembler.register(c));
```

### `triplehookPipelinePattern`

Wraps `LlmPipelineRunner` with author-supplied input / context /
output modifiers and sensible defaults (echo input, no-op context,
trim output). Returns a runner plus the state shard.

```ts
const tp = triplehookPipelinePattern({
  assembler, generator,
  state: { mood: "neutral" },
  inputModifier: (input, st) => ({ rewritten: input.replace(/lol/g, "[laughs]") }),
  outputModifier: (output, st) => ({ rewritten: output.trim() }),
});
const t = await tp.runner.runTurn("hello");
```

### `quietGenerationSubCallPattern`

SillyTavern Quiet Mode / STscript `/gen quiet=true`. Named templates
rendered with `{{var}}` substitution and dispatched via `runQuiet`.
Results route into pipeline state via `onResult`.

```ts
const quiet = quietGenerationSubCallPattern({
  runner,
  prompts: { summarize: "Summarize the scene in 3 lines: {{ctx}}" },
  onResult: (id, txt, st) => ({ [`last_${id}`]: txt } as Partial<typeof st>),
});
await quiet.runQuietNamed("summarize", { ctx: scene });
```

### `scriptedQuickReplyMacroPattern`

SillyTavern STScript / Quick Replies / Guided-Generations. Macros are
sequences of typed steps (`quiet`, `show`, `set`); the pattern exposes
`matchAndRun(input)` so stages can intercept macro triggers in their
own `inputModifier`.

```ts
const qr = scriptedQuickReplyMacroPattern({
  runner,
  prompts: { summarize: "Summarize: {{ctx}}" },
  macros: {
    recap: { trigger: "/recap", steps: [
      { kind: "quiet", promptId: "summarize", promptCtx: { ctx: "..." } },
      { kind: "show", channel: "panel", content: state => `Mood: ${(state as any).mood}` },
    ] },
  },
});
```

FLAG: `MacroStep` is an inline minimal DSL. Lift to a top-level
`src/lib/macro.ts` primitive if future patterns need branching /
loops / nested macros. `action.ts` does NOT cover the macro shape
(it is combat-action-shaped: costs / range / targetFilter / effects).

### `semanticRecallOverlayPattern`

SillyTavern Vector Storage / Data Bank RAG. Maintains an in-memory
`VectorIndex<E>` over `Timeline` events; each turn embeds the scan
text and emits the top-K nearest events as a context section.
Composes with the `embeddings.ts` primitive.

```ts
const recall = semanticRecallOverlayPattern({
  source: timeline, embed: embedder, topK: 5,
});
await recall.reindex();
assembler.register(recall.contributors![0]);
```

### `scheduledSelfCheckPattern`

SillyTavern Objectives Task Check Frequency. Every N turns, fires a
quiet sub-call with an author-defined prompt; the verdict feeds back
into pipeline state.

```ts
const audit = scheduledSelfCheckPattern({
  runner, everyN: 5,
  prompt: "Is the task done? yes/no",
  onVerdict: (v, st) => v.startsWith("yes") ? { taskDone: true } as Partial<typeof st> : {},
});
// each turn:
await audit.tick();
```

### `characterFilteredActivationPattern`

SillyTavern WI Character Filters. Each entry declares `forSpeakers`;
the contributor emits only when the resolved current speaker matches.

```ts
const cf = characterFilteredActivationPattern({
  entries: loreEntries,
  speakerOf: st => (st as any).currentSpeaker,
});
cf.contributors!.forEach(c => assembler.register(c));
```

### `overrideSlotsPattern`

SillyTavern character-card Main Prompt + Post-History Instructions /
NovelAI Memory. Named slots REPLACE the contributor under the same id
rather than appending. The pattern exposes `apply(assembler)` —
typically wired through a pipeline's `contextModifier`.

```ts
const ov = overrideSlotsPattern({
  slots: [{ id: "system", content: cardSystemPrompt, priority: 1000 }],
});
ov.apply(assembler);
```

## Anti-patterns mitigated

- `budget-poisoning` — one category silently expands and starves
  others. Mitigation: `subcontextGroupBudgetingPattern` bounds each
  category's budget by construction.
- `key-collision` — two entries share a key or one is a substring of
  another. Mitigation: `inclusionGroupMutexPattern` forces exactly one
  winner; `characterFilteredActivationPattern` namespaces by speaker;
  `predicate.ts` `regex` / `glob` kinds give tighter matchers.

See `src/lib/design/SYNERGY-EXTENSIONS.md` §3 for the full anti-pattern
catalog.

## Persistence

`LlmPipelineRunner` does not own persistence. Shard `pipeline.state`
directly:

```ts
const stateShard = shard("pipeline-state", pipeline.state);
store.add(stateShard);
```

Each pattern returns a `shards` array of `{ id, value }` pairs for
the same reason — the stage author wires them into whatever
persistence layer they're using.
