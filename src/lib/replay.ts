/*
 * replay.ts — deterministic action log → state reconstruction.
 *
 * WHAT: A replay log is an ordered list of `{ at, kind, data }` records the
 *       stage emits as authoritative actions occur (turn taken, item moved,
 *       attack spawned). Given the same starting state, the same seed, and
 *       the same log, `replay(initial, log, dispatch)` returns the final
 *       state. Useful for debugging non-determinism or for branch comparison.
 *
 * WHY: Rule #7 (seeded streams make replay possible) + rule #5 (explicit
 *       ticks mean every state change has a discrete cause). Without explicit
 *       ticks and seeded RNG this module couldn't exist; with them it falls
 *       out for free.
 *
 * SHAPE:
 *   interface LogEntry<K extends string = string, D = unknown> { at: number; kind: K; data: D }
 *   type Dispatcher<S, E extends LogEntry> = (state: S, entry: E) => S
 *   class Replay<S, E extends LogEntry>
 *     constructor(initial: S, dispatch: Dispatcher<S, E>)
 *     record(entry: E): void
 *     log(): readonly E[]
 *     replay(): S
 *     replayUpTo(time: number): S
 *     toJSON(): { log: E[] }
 *   reconstruct<S, E>(initial, log, dispatch): S
 */

export interface LogEntry<K extends string = string, D = unknown> {
  at: number;
  kind: K;
  data: D;
}

export type Dispatcher<S, E extends LogEntry> = (state: S, entry: E) => S;

export class Replay<S, E extends LogEntry> {
  private _log: E[] = [];
  constructor(private _initial: S, private _dispatch: Dispatcher<S, E>) {}

  record(entry: E): void {
    this._log.push(entry);
  }

  log(): readonly E[] {
    return this._log;
  }

  replay(): S {
    return reconstruct(this._initial, this._log, this._dispatch);
  }

  replayUpTo(time: number): S {
    const slice = this._log.filter((e) => e.at <= time);
    return reconstruct(this._initial, slice, this._dispatch);
  }

  toJSON(): { log: E[] } {
    return { log: [...this._log] };
  }
}

export function reconstruct<S, E extends LogEntry>(
  initial: S,
  log: readonly E[],
  dispatch: Dispatcher<S, E>,
): S {
  let state = initial;
  for (const e of log) state = dispatch(state, e);
  return state;
}
