# `world-primary` — the "just good" RP frontend shape

Reference stage demonstrating the design in
[`src/lib/design/FRONTEND-SHAPE.md`](../../src/lib/design/FRONTEND-SHAPE.md)
end-to-end.

## What it demonstrates

| Pattern | Implementation |
|---|---|
| World state as primary | Hand-seeded state machine: 3 locations, 3 NPCs, small inventory schema |
| Structured verbs as fast path | `ActionSurface` — verbs derived from `schema × current state` |
| Freeform input as escape hatch | `FreeformInput` → `freeformPipeline` with `coerce` policy |
| Renderer/oracle split | `renderTrigger` for prose; `quietCall` for oracle delta proposals |
| Single-shot prompt assembly | `ContextAssembler` with `systemInstructionsContributor` |
| Chat log as side panel | `ChatLogSidebar` — collapsible, append-only |
| Fullscreen iframe | `100vw × 100vh`; Chub chat UI bypassed |

## Five-layer structure model (FRONTEND-SHAPE.md)

| Layer | Where it lives in this example |
|---|---|
| 1. Schema | `LOCATIONS`, `NPCS`, `ITEMS`, `TRIGGERS` constants |
| 2. Instance | `WorldMessageState` — seeded in constructor |
| 3. Derived affordances | `deriveVerbs()` — computed per-render from `schema × state` |
| 4. Stubs | `TRIGGER_STUBS` — structured directives per trigger |
| 5. Sandbox policy | `coerce` passed to `freeformPipeline` |

## Persistence

Three-layer, per Chub adapter conventions:

- `initState` — null; world is seeded at construction.
- `messageState` — branch-aware turn state (location, relations,
  inventory, trigger cooldown, last prose). Swiping a turn gives a
  fresh branch.
- `chatState` — log entries; append-only; survives swipes.

## Primitives composed

- `ContextAssembler` / `systemInstructionsContributor` (`src/lib/context.ts`)
- `LlmPipelineRunner` (`src/lib/llm-pipeline.ts`)
- `ConditionalTrigger` / `TriggerSet` (`src/lib/trigger.ts`)
- `renderTrigger` (`src/lib/patterns/render-trigger.ts`)
- `freeformPipeline` (`src/lib/patterns/freeform-pipeline.ts`)
- `parseIntent` (`src/lib/intent.ts`)
- `WorldStatePanel`, `ActionSurface`, `ScenePane`, `ChatLogSidebar`,
  `FreeformInput` (`src/lib/ui/`)

## Deliberately out of scope

- Procgen instance generation (the "infinite X" demo with this shape).
- Sandbox policy `extend` (schema extension within bounds).
- Salience-weighted observation context.
- Crescent port; non-Chub host adapters.

See `FRONTEND-SHAPE.md §"What world-primary demonstrates"` for the
design rationale.
