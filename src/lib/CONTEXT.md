# Context — composable prompt assembly

`ContextAssembler` owns a list of `ContextContributor`s and a token
budget. `assemble(ctx)` walks contributors in priority order, gathers
`Section { id, content, tokens, optional? }` outputs, and emits a
single prompt string. Required sections always render; optional
sections fill remaining budget in priority order
(drop-then-allocate). Stages compose contributors and never
hand-concatenate prompts.

Every prompt-bound primitive in the library either implements
`ContextContributor` directly (ChatWindow) or has a built-in factory
that wraps it (observations, timelines, prose-register).

## The protocol

```ts
interface ContextContributor {
  id: string;
  priority: number;                         // higher = first allocated
  contribute(ctx: AssemblyContext): Section | null;
}

interface Section {
  id: string;
  content: string;
  tokens: number;                           // estimateTokens() or exact
  optional?: boolean;                       // droppable under budget pressure
}
```

Token counts use `estimateTokens(content)` — a coarse
`Math.ceil(chars / 4)` heuristic. Contributors that need accuracy
emit exact counts from a real tokenizer; the assembler trusts
whatever it's given.

## Priority bands (conventional)

| Band   | What lives here                              |
|--------|----------------------------------------------|
| 100+   | System instructions, hard rules              |
| 80–99  | Chat window, turn input                      |
| 60–79  | Prose register, world state                  |
| 40–59  | Observations                                 |
| 20–39  | Timeline / event history                     |
| 0–19   | Nice-to-have flavor                          |

## Assembling a full prompt

```ts
import {
  ContextAssembler,
  systemInstructionsContributor,
  proseRegisterContributor,
  observationContributor,
  timelineContributor,
  turnInputContributor,
} from "./lib/context";

const assembler = new ContextAssembler({ budget: 4000 });

assembler
  .register(systemInstructionsContributor(SYSTEM_PROMPT))
  .register(this.chatWindow)                                      // ChatWindow IS one
  .register(turnInputContributor())
  .register(proseRegisterContributor({
    architectures: ["body_then_world", "focus_hold"],
    register: { pov: "close-second", tense: "past", distance: "close" },
  }))
  .register(observationContributor([this.bodySource, this.locationSource]))
  .register(timelineContributor(this.events, { window: 12 }));

// In beforePrompt:
const stageDirections = assembler.assemble({
  budget: 4000,
  turnInputMessage: message,
});
```

## Allocation algorithm

1. Sort contributors by priority (high → low).
2. Gather every `contribute()` result (skip `null`).
3. Accept all required sections (`optional !== true`) unconditionally.
4. Walk optional sections in priority order; include each whose
   `tokens` still fits the remaining budget.
5. Emit accepted sections in priority order, joined by blank lines.

This is *drop-then-allocate*: required is sacrosanct, optional fills
remaining headroom. A `priority: 100, optional: false` section
always appears — the budget governs only the optional layer. Stage
authors who want hard caps mark sections optional.

## Built-in contributors

| Factory                              | Wraps                                   |
|--------------------------------------|-----------------------------------------|
| `observationContributor(sources)`    | `ObservationSource[]` + assemble        |
| `timelineContributor(t, { window })` | `Timeline` window render                |
| `chatWindowContributor(window)`      | identity — ChatWindow IS one            |
| `proseRegisterContributor(spec)`     | `proseInstructions` output              |
| `systemInstructionsContributor(t)`   | raw text, high priority, required       |
| `turnInputContributor()`             | `ctx.turnInputMessage`, required        |

`worldStateContributor` ships in Wave 2B alongside `world.ts`.

`Timeline` and `ObservationSource[]` also have `.asContributor(...)`
convenience methods on their owning classes — same behavior as the
factory, useful when you've got a single instance and want to register
it inline.

## Related

- `chat-window.ts` — the verbatim-recent-turns ContextContributor.
- `observation.ts` — structured world data → context.
- `timeline.ts` — event history → context.
- `prose-register.ts` — register + architecture instructions → context.
