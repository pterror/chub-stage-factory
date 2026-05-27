# `replay.ts` — deterministic action log and state reconstruction

Records an ordered log of typed `{ at, kind, data }` entries and reconstructs
state by replaying them through a pure `Dispatcher` function. Requires seeded
RNG (`rng.ts`) and explicit ticks to be deterministic.

## Concepts

A **dispatcher** is `(state, entry) => state` — a pure reducer. Given the same
initial state and the same log, replay always returns the same final state.

`replayUpTo(time)` reconstructs state at any past timestamp, enabling branch
comparison and debugging of non-determinism.

## API

- `interface LogEntry<K, D> { at: number; kind: K; data: D }` (line 28)
- `type Dispatcher<S, E extends LogEntry> = (state, entry) => S` (line 34)
- `class Replay<S, E>` (lines 36–60)
  - `constructor(initial: S, dispatch: Dispatcher<S, E>)`
  - `record(entry: E): void`
  - `log(): readonly E[]`
  - `replay(): S` — replay full log from initial
  - `replayUpTo(time: number): S` — replay entries where `at <= time`
  - `toJSON(): { log: E[] }` — no `fromJSON`; caller reconstructs with stored initial
- `reconstruct<S, E>(initial, log, dispatch): S` — standalone; no class needed (line 62)

## Example

```ts
import { Replay } from "./lib/replay";

type MyEntry = { at: number; kind: "move"; data: { dx: number; dy: number } };
type Pos = { x: number; y: number };

const r = new Replay<Pos, MyEntry>({ x: 0, y: 0 }, (pos, e) => ({
  x: pos.x + e.data.dx,
  y: pos.y + e.data.dy,
}));

r.record({ at: 1, kind: "move", data: { dx: 1, dy: 0 } });
r.record({ at: 2, kind: "move", data: { dx: 0, dy: 2 } });

r.replay();          // { x: 1, y: 2 }
r.replayUpTo(1);     // { x: 1, y: 0 }
```

## Gotchas

- `toJSON` serializes the log only. The caller must store initial state separately
  to reconstruct on load.
- Determinism requires that `dispatch` is pure and any RNG used by the stage is
  seeded and advanced only through `Rng.stream` calls replayed in the same order.
