# ChatWindow — bounded recent-turns primitive

`ChatWindow` is the verbatim half of the sliding-window chat-history
pattern. A FIFO of the last N `Message`s with an optional
`summarizeOlder` hook fired with the turns that roll out. Implements
`ContextContributor` directly — drop it into a `ContextAssembler` and
the last N turns surface as a single `<recent-turns>` section.

Pairs with `Timeline` for the persisted half: as turns roll out of
the verbatim window, the hook captures whatever needs to outlast the
window (events, summaries, parsed tags).

## Sliding-window basics

```ts
import { ChatWindow } from "./lib/chat-window";

const chat = new ChatWindow({ size: 8 });

// In beforePrompt:
chat.push(message);
const turns = chat.turns();              // last 8 raw messages
```

## Summarize-on-roll-out

```ts
import { ChatWindow } from "./lib/chat-window";
import { Timeline } from "./lib/timeline";

const events = new Timeline<{ kind: "summary"; text: string }>();

const chat = new ChatWindow({
  size: 10,
  summarizeOlder: (rolled) => {
    // Capture what mattered before the verbatim text drops.
    for (const turn of rolled) {
      events.push({ kind: "summary", text: shortSummary(turn) });
    }
  },
});
```

Combine with `tag-parser` for structured extraction, or with
`generate` for an LLM-summarized event line per rolled turn. The
default rendering in `contribute(ctx)` emits each turn as
`speaker: content` inside a `<recent-turns>` block.

## In a ContextAssembler

```ts
import { ContextAssembler, systemInstructionsContributor, turnInputContributor }
  from "./lib/context";

const assembler = new ContextAssembler({ budget: 4000 });
assembler.register(systemInstructionsContributor("You are…"));
assembler.register(chat);                  // ChatWindow IS a ContextContributor
assembler.register(turnInputContributor());

const prompt = assembler.assemble({
  budget: 4000,
  turnInputMessage: message,
});
```

ChatWindow's default priority is 80 (high — recent turns are
near-essential context for any chat-bound stage). Override with
`{ priority: ... }` if a particular stage wants to demote it.

## Persistence

```ts
import { shardOf, chubTreeHistory } from "./lib/persistence";

chat: shardOf(
  "chat", this.chat,
  (d) => ChatWindow.fromJSON(d, { size: 10, summarizeOlder: this.onRoll }),
  this.layers.messageStateBackend, chubTreeHistory(),
),
```

The `summarizeOlder` hook is stage-author code; re-attach it on load
via the options passed to `fromJSON`. The serialized form is just
the buffer.

## Related

- `context.ts` — `ContextAssembler` + the ContextContributor protocol.
- `timeline.ts` — natural target for `summarizeOlder` output.
- `tag-parser.ts` — structured extraction from rolled-out turns.
- `synergy/sliding-window-chat.ts` (Wave-1.5-dependent composer) —
  the pattern recipe.
