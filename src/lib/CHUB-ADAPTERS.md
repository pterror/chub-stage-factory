# `chub-adapters.ts` — Stage hook composition glue

Small glue utilities for composing `beforePrompt`/`afterResponse` hooks,
emitting observation payloads as `stageDirections`, and applying parsed tags
back into mutable state. Also re-exports the full persistence-layer Chub
bindings so stages can import the entire persistence story from one place.

## API

**Hook composition**
- `interface HookCtx<C, M> { state: M; chatState?: C | null; now: number }` (lines 39–43)
- `type Hook<C, M> = (msg, ctx: HookCtx<C, M>) => Promise<Partial<StageResponse<C, M>>>` (lines 46–49)
- `composeBeforePrompt<C, M>(...hooks): Hook` — run hooks in order; merge responses (line 73)
- `composeAfterResponse<C, M>(...hooks): Hook` — identical to `composeBeforePrompt` (line 81)

**Observation emission**
- `emitStageDirections({ observations, architectures?, register?, prefix? }): string` (lines 89–101)
  — concatenates optional `prefix`, `proseInstructions(...)`, and `formatObservations(...)`

**Tag parsing**
- `type Reducer<S, T> = (state, parsed, errors) => void` (line 103)
- `parseAndApply(text, pairs, state): { stripped, results }` (lines 111–125)
  — runs each `{ schema, reduce }` pair in sequence; each strips its matches from the cumulative output

**Persistence re-exports** (from `persistence/`)
- `chubTreeHistory`, `createChubLayers`, `bindStore`, `mergeResponses`, `shard`
- `BoundStore`, `BindStoreOptions`

## Example

```ts
import { composeBeforePrompt, emitStageDirections, parseAndApply } from "./lib/chub-adapters";

const beforePrompt = composeBeforePrompt<ChatState, MsgState>(
  async (msg, { state, now }) => {
    state.tick(now);
    const observations = assembler.assemble();
    return { stageDirections: emitStageDirections({ observations, architectures: ["zoom_out"], register }) };
  },
  async (msg, { state }) => {
    const { stripped, results } = parseAndApply(msg.content, [
      { schema: MY_SCHEMA, reduce: (s, parsed) => { s.flag = parsed.flag; } },
    ], state);
    return { messageState: state };
  },
);
```

## Gotchas

- `mergeResp` (internal) concatenates `stageDirections` and `systemMessage` with
  newlines when both hooks produce them; scalars (non-string fields) use last-writer-wins.
- `emitStageDirections` skips `proseInstructions` if either `architectures` or
  `register` is absent; pass both or neither.
