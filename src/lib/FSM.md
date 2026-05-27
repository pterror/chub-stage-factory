# FSM — flat, hierarchical, and pushdown state machines

`fsm.ts` implements a single `Fsm` class that covers flat, parent-child
hierarchical, and pushdown (stack) state machines. All three modes are
available simultaneously on the same instance.

## Concepts

- **State path** — each state may declare a `parent`. `path()` returns the
  chain from root to current leaf. Dispatch walks this chain from leaf to
  root, stopping at the first handler that returns a non-void transition.
- **Pushdown** — `push` in a transition saves the current state on a stack;
  `pop` restores it. `push` and `to` are independent: a transition can do
  both (push the current state, then jump to a new one).
- **Transition** — `{ to?, push?, pop?, emit? }`. `to` replaces the leaf,
  running exit hooks up to the common ancestor and enter hooks down to the
  new leaf. `emit` is an array of values returned from `dispatch`.
- **Serialization** — `toJSON` / `fromJSON` persist only `initial` and
  `stack` (strings). State defs contain functions and are not serializable;
  pass them again to `fromJSON` via the `states` argument.

## API

- `interface TransitionObj<E>` (`src/lib/fsm.ts:34-39`)
- `type Transition<E>` (`src/lib/fsm.ts:40`)
- `interface StateDef<C, E>` — parent?, enter?, exit?, on? (`src/lib/fsm.ts:42-47`)
- `class Fsm<C, E>` (`src/lib/fsm.ts:49-173`)
  - `constructor(initial, ctx, states?)` — `ctx` is shared mutable state passed to every hook
  - `defineState(name, def): this`
  - `current(): string`, `path(): string[]`, `stack(): string[]`
  - `dispatch(event, data?): E[]` — returns concatenated `emit` arrays from triggered transitions
  - `reset(initial?): void` — collapses stack to one entry; no exit hooks run
  - `toJSON()`, `static fromJSON(data, ctx, states?)`

## Gotchas

- `dispatch` returns only the `emit` from the **first** handler that
  returns a non-void transition. Later states in the parent chain are not
  checked after a handler fires.
- `reset` does not call exit hooks on the current state.
- Jumping to an unknown state name (via `to` or `push`) throws at
  `_applyTransition` time, not at `defineState` time.
