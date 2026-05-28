# `focus` — FocusPattern

## Purpose

Directs player attention to the currently most-interesting things: a fire spreading
through a room, a low-energy worker about to collapse, an incoming raid. In a
high-action-density managerial stage many observation sources compete for the
player's limited attention simultaneously; `focusPattern` surfaces the top-N
winners as a structured `<focus>` block in the LLM context.

Used by: Facility-management-shape (#20), RTS-shape (#15), FC-shape (#8), and any
other stage where more things can happen in one tick than a player can watch.

Placed in `lifecycle/` because it is a cross-cutting attention director that wires
across world, character, and combat observation sources — not scoped to any single
mechanic bucket.

## API

```ts
focusPattern<S>(init: FocusInit<S>): FocusBundle<S>
```

### Init fields

| Field       | Type                        | Required | Description                                        |
|-------------|-----------------------------|----------|----------------------------------------------------|
| `sources`   | `ObservationSource<S>[]`    | yes      | The sources competing for player attention.        |
| `maxFocus`  | `number`                    | no       | Max items from `top()` and the contributor. Default: 3. |
| `priority`  | `number`                    | no       | Contributor priority. Default: 70 (high).         |
| `id`        | `string`                    | no       | Contributor id. Default: `"focus"`.               |

### Bundle surface

| Method / field                              | Description                                                           |
|---------------------------------------------|-----------------------------------------------------------------------|
| `rank(state, now)`                          | All sources ranked by habituated salience, high→low.                  |
| `top(state, now, n?)`                       | Top `n` items (default: `maxFocus`).                                  |
| `asContributor(getState, getNow)`           | Returns a `ContextContributor` that renders top-N as `<focus>` XML.  |

## Example

```ts
import { focusPattern } from "../patterns/lifecycle/focus";
import { ContextAssembler } from "../context";

const focus = focusPattern<MyState>({
  sources: [fireSource, workerSource, raidSource],
  maxFocus: 3,
});

const assembler = new ContextAssembler({ budget: 4000 });
assembler.register(focus.asContributor(() => this.ms, () => Date.now()));

// Or call directly in beforePrompt:
const hotItems = focus.top(this.ms, Date.now());
```

## Gotchas

- Habituation is shared across all callers of `rank` / `top` through the internal
  `lastEmittedAt` map. Call only once per turn; don't call `rank` then `top`
  separately or the emitted-at timestamps will be recorded twice.
- The contributor calls `top` on every `contribute` invocation. If `getState` /
  `getNow` are expensive, cache the result before calling `assemble`.
- Sources with `habituationTau = 0` (the default) are never habituated — they fire
  at full raw salience every turn. Set `habituationTau` on sources you want to
  decay after repeated focus to prevent one high-salience source monopolising
  every turn.
