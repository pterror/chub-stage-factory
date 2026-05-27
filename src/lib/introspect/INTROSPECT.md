# StageIntrospect

Optional interface stages may implement to expose their interaction graph
as queryable data. Used by:

- The stage's own UI (button-bar derived from `availableVerbs`, button
  `onClick` calls `invokeVerb`).
- `scripts/explore-stage.mjs` — interactive CLI driver for headless
  exploration, useful in Phase 5 manual verification and for any agent
  that needs to drive a stage turn-by-turn without parsing DOM.

Origin: UX audit 2026-05-27 §R1 (`docs/UX-AUDIT-2026-05-27.md`). The
audit found world-primary's `ActionSurface` rendering verbs whose
`onClick` handlers were no-ops, and noted that the same gap blocks any
agent that wants to "explore" a stage without rendering HTML. This
interface is the shared primitive that closes both.

## Shape

```ts
interface VerbDescriptor {
  name: string;            // stable id
  label?: string;          // UI display
  description?: string;
  args?: VerbArg[];
  enabled?: boolean;
  group?: string;
}

interface VerbArg {
  name: string;
  type: "string" | "number" | "boolean" | "enum";
  required?: boolean;
  description?: string;
  enum?: string[];
}

interface StageDescriptor {
  summary: string;
  details?: Record<string, unknown>;
  verbCount?: number;
}

interface InvocationResult {
  ok: boolean;
  message?: string;
  prose?: string;
  error?: string;
  messageState?: unknown;
  chatState?: unknown;
}

interface StageIntrospect {
  availableVerbs(): VerbDescriptor[];
  describe(): StageDescriptor;
  invokeVerb(name: string, args?: Record<string, unknown>): Promise<InvocationResult>;
}
```

## Contract

- `availableVerbs()` is a snapshot. It may return an empty list (e.g.
  while a turn is processing).
- `describe()` does not mutate state.
- `invokeVerb()` **must route through the stage's lifecycle** (typically
  by synthesizing a `Message` and calling `beforePrompt`) so that state
  changes are persisted normally. Driver-injected state changes that
  bypass the lifecycle defeat the point of the interface.

## Implementing

A stage opts in by adding the three methods. There is no required base
class — `hasIntrospect(stage)` is a structural check.

Sketch (see `examples/world-primary/Stage.tsx` for the full version):

```ts
availableVerbs(): VerbDescriptor[] {
  if (this.isProcessing) return [];
  return [
    ...this.deriveMovementVerbs(),
    ...this.deriveTalkVerbs(),
    ...this.deriveItemVerbs(),
    { name: "freeform", description: "Send any prose.", args: [
      { name: "text", type: "string", required: true },
    ]},
  ];
}

describe(): StageDescriptor {
  return {
    summary: `In ${this.locationName()}, turn ${this.ms.turnCount}.`,
    details: { location: this.ms.locationId, inventory: this.ms.inventory },
    verbCount: this.availableVerbs().length,
  };
}

async invokeVerb(name, args) {
  const text = verbToText(name, args);    // "go north", "take map-fragment", …
  const msg = { ...DEFAULT_MESSAGE, content: text };
  const resp = await this.beforePrompt(msg);
  return {
    ok: resp.error == null,
    prose: this.currentProse,
    error: resp.error ?? undefined,
    messageState: resp.messageState,
    chatState: resp.chatState,
  };
}
```

## Composition

`CompositionRunner` implements `StageIntrospect` itself when at least one
child implements it. Child verb names are namespaced by instance id
(`"<instanceId>:<verbName>"`) so they don't collide. `describe()`
concatenates child summaries; `invokeVerb` routes by prefix.

Children that do not implement `StageIntrospect` contribute zero verbs
but still appear in `describe()` output as an opaque panel.

## Driver

`scripts/explore-stage.mjs <example>` runs an interactive REPL:

```
verbs (4):
  1. go-north             — Move north to The Ember Inn
  2. talk-elder-mira      — Speak with Elder Mira
  3. examine-map-fragment
  4. freeform <text>      — Send any prose.
> 1
[invoke go-north]
ok. prose: "The path north winds between cottages …"

In The Ember Inn, turn 2.
verbs (3):
  …
```

Single-line REPL; no DOM rendered. JSON-RPC mode (`--json`) prints one
JSON object per line for agent driving.
