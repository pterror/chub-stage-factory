# dialoguePattern

**File:** `src/lib/patterns/dialogue.ts`
**Composes:** `Fsm` + `Predicate` + `evaluate`
**Enables:** Zork-shape (#2)

## Purpose

Wraps an `Fsm` with say/choices semantics. Each state carries a `say` string (NPC dialogue) and a list of `DialogueChoice` entries with optional predicate guards. `availableChoices` filters choices against the current world state; `choose` dispatches to the underlying `Fsm`.

## API

```ts
dialoguePattern({ initial, ctx, states }): DialogueBundle
```

### `DialogueStateDef`

```ts
interface DialogueStateDef<C, S, E> extends StateDef<C, E> {
  say: string;
  choices?: DialogueChoice<S>[];
}
interface DialogueChoice<S> {
  id: string;
  label: string;
  when?: Predicate<S>;
}
```

### `DialogueBundle`

| Method | Description |
|--------|-------------|
| `current()` | Current FSM state name |
| `say()` | NPC line for the current state |
| `availableChoices(state, refs, resolvers?)` | Choices whose `when` predicate passes |
| `choose(id, data?)` | Dispatch a choice; returns the new `say` (or null on no transition) |
| `fsm` | Raw `Fsm` instance |
| `states` | The state definitions map |

## Example

```ts
const dlg = dialoguePattern({
  initial: "greeting",
  ctx: {},
  states: {
    greeting: {
      say: "Hello, traveller. What brings you here?",
      choices: [
        { id: "ask_grue", label: "Tell me about the grue." },
        { id: "buy",      label: "I need a lamp.",
          when: P.not(P.hasItem("player", "lamp")) },
      ],
      on: {
        ask_grue: () => ({ to: "grue_info" }),
        buy:      () => ({ to: "purchase" }),
      },
    },
    grue_info: {
      say: "It lives in the dark. Stay in the light.",
      choices: [{ id: "back", label: "Thanks." }],
      on: { back: () => ({ to: "greeting" }) },
    },
    purchase: {
      say: "That will be 10 zorkmids.",
      choices: [],
    },
  },
});

const choices = dlg.availableChoices(worldState, { player: playerActor }, resolvers);
dlg.choose("ask_grue");
console.log(dlg.say()); // "It lives in the dark. Stay in the light."
```

## Gotchas

- `choose` fires `Fsm.dispatch(id)`; the choice `id` must match an `on[id]` handler in the current state (or its parent). If no handler matches, the FSM stays put and `choose` returns the current `say`.
- `when` predicates use the standard `Predicate<S>` DSL — supply `resolvers` that match your state shape.
- States are mutable via `bundle.states` — the stage author can add states dynamically via `bundle.fsm.defineState`.
