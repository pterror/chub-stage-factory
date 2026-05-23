/*
 * scheduler.ts — unified event queue used to compose other subsystems' ticks.
 *
 * WHAT: A min-heap of `{ at: number, type: string, data?: any }` events. The
 *       stage registers handlers by type; `tickTo(now)` drains every event
 *       with `at <= now` in order and dispatches to its handler. Events the
 *       handlers return are reinserted (handlers are pure-ish — they describe
 *       what to enqueue next; the scheduler is the mutable holder).
 *
 * WHY: Rule #5 (no global scheduler — this one is opt-in and lives on the
 *       stage). Rule #4 (handlers are pure functions over event + state).
 *
 * SHAPE:
 *   interface ScheduledEvent<T> { at: number; type: string; data?: T }
 *   type Handler<S, T> = (event, state, scheduler) => ScheduledEvent<any>[] | void
 *   class Scheduler<S>
 *     constructor(state: S)
 *     schedule(ev): void
 *     on(type, handler): void
 *     peek(): ScheduledEvent | null
 *     tickTo(now): ScheduledEvent[]   // returns drained events in fire order
 *     size(): number
 *     clear(): void
 */

export interface ScheduledEvent<T = unknown> {
  at: number;
  type: string;
  data?: T;
}

export type Handler<S> = (
  event: ScheduledEvent,
  state: S,
  scheduler: Scheduler<S>,
) => ScheduledEvent[] | void;

/** Simple binary min-heap keyed on `at`; ties broken by insertion order. */
class Heap {
  private _arr: { ev: ScheduledEvent; seq: number }[] = [];
  private _seq = 0;
  size(): number {
    return this._arr.length;
  }
  push(ev: ScheduledEvent): void {
    const node = { ev, seq: this._seq++ };
    this._arr.push(node);
    this._siftUp(this._arr.length - 1);
  }
  peek(): ScheduledEvent | null {
    return this._arr[0]?.ev ?? null;
  }
  pop(): ScheduledEvent | null {
    if (this._arr.length === 0) return null;
    const top = this._arr[0].ev;
    const last = this._arr.pop()!;
    if (this._arr.length > 0) {
      this._arr[0] = last;
      this._siftDown(0);
    }
    return top;
  }
  clear(): void {
    this._arr = [];
  }
  private _less(a: number, b: number): boolean {
    const x = this._arr[a];
    const y = this._arr[b];
    if (x.ev.at !== y.ev.at) return x.ev.at < y.ev.at;
    return x.seq < y.seq;
  }
  private _siftUp(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this._less(i, p)) {
        [this._arr[i], this._arr[p]] = [this._arr[p], this._arr[i]];
        i = p;
      } else break;
    }
  }
  private _siftDown(i: number): void {
    const n = this._arr.length;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < n && this._less(l, m)) m = l;
      if (r < n && this._less(r, m)) m = r;
      if (m === i) break;
      [this._arr[i], this._arr[m]] = [this._arr[m], this._arr[i]];
      i = m;
    }
  }
}

export class Scheduler<S> {
  private _heap = new Heap();
  private _handlers: Map<string, Handler<S>> = new Map();
  constructor(public state: S) {}

  schedule(ev: ScheduledEvent): void {
    this._heap.push(ev);
  }

  on(type: string, handler: Handler<S>): void {
    this._handlers.set(type, handler);
  }

  peek(): ScheduledEvent | null {
    return this._heap.peek();
  }

  size(): number {
    return this._heap.size();
  }

  clear(): void {
    this._heap.clear();
  }

  /**
   * Drain all events with `at <= now`. Each event is handed to its handler;
   * any events returned by the handler are enqueued immediately so they may
   * fire on this same `tickTo` call if also <= now.
   * Returns the events that fired, in order.
   */
  tickTo(now: number): ScheduledEvent[] {
    const fired: ScheduledEvent[] = [];
    for (;;) {
      const top = this._heap.peek();
      if (!top || top.at > now) break;
      const ev = this._heap.pop()!;
      fired.push(ev);
      const handler = this._handlers.get(ev.type);
      if (!handler) continue;
      const next = handler(ev, this.state, this);
      if (next) for (const n of next) this._heap.push(n);
    }
    return fired;
  }
}
