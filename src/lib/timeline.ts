/*
 * timeline.ts — append-only time-stamped event log + ObservationSource.
 *
 * WHAT: `Timeline<E>` is an append-only buffer of `{ at, payload }` events
 *       ordered by insertion. Query by time (`since`, `until`, `between`),
 *       by count (`window`), or both (`windowSince`). `clear(beforeTime?)`
 *       drops the head; without an arg it wipes the buffer.
 *
 *       Implements `ObservationSource<unknown>` so a stage hands a timeline
 *       directly to `assembleObservations(sources, ...)` as one of its
 *       sources — recent events surface alongside other state in
 *       `stageDirections` without a hand-rolled adapter. The default
 *       observation emits the last N events (configurable via
 *       `observationOptions`) on the `auditory` channel with salience
 *       proportional to event count.
 *
 *       `toJSON`/`fromJSON` round-trip the buffer; pair with a Shard to
 *       persist. Choose paradigm per-timeline like every other primitive:
 *       branchy combat log -> messageState + chubTreeHistory;
 *       canon history -> chatState + forbidBranching;
 *       session-only buffer -> no Shard.
 *
 * WHY: Every example with an `events: E[]` field re-implements
 *      push + slice(-N) + observation source wiring + serialization.
 *      Timeline collapses that to one line per concern and makes the
 *      observation hookup zero-line via the ObservationSource interface.
 *
 *      Rule #5 (explicit ticks, no global scheduler): Timeline is a
 *      passive buffer; the stage pushes into it when subsystem ticks
 *      produce events. Rule #9 (observation source = stage->LLM bridge):
 *      Timeline IS an ObservationSource, not a thing the stage adapts.
 *
 * SHAPE:
 *   interface TimelineEvent<E> { at: number; payload: E }
 *   interface TimelineObservationOptions<E>
 *     { id?, channels?, channel?, key?, windowSize?, saliencePer?,
 *       habituationTau?, render? }
 *   class Timeline<E> implements ObservationSource<unknown>
 *     constructor(opts?: TimelineObservationOptions<E>)
 *     push(payload, at?): TimelineEvent<E>
 *     pushAll(events: Iterable<TimelineEvent<E>>): void
 *     since(t): TimelineEvent<E>[]
 *     until(t): TimelineEvent<E>[]
 *     between(t0, t1): TimelineEvent<E>[]
 *     window(n): TimelineEvent<E>[]            // last n
 *     windowSince(t, n?): TimelineEvent<E>[]
 *     all(): readonly TimelineEvent<E>[]
 *     count(): number
 *     last(): TimelineEvent<E> | undefined
 *     clear(beforeTime?): number               // returns removed count
 *     // ObservationSource fields, populated from opts in the constructor:
 *     id; channels; salience; properties; habituationTau?
 *     toJSON(): TimelineEvent<E>[]
 *     static fromJSON<E>(data, opts?): Timeline<E>
 *
 *   summarize<E>(events, render): string       // newline-joined render
 */

import type { Channel, Evaluator, Key, ObservationSource } from "./observation";

export interface TimelineEvent<E> {
  at: number;
  payload: E;
}

export interface TimelineObservationOptions<E> {
  /** ObservationSource id; defaults to "timeline". */
  id?: string;
  /** Channels to advertise; defaults to ["auditory"]. */
  channels?: Channel[];
  /** Channel the default `events` evaluator is published on; defaults to
   *  channels[0] (or "auditory" if neither set). */
  channel?: Channel;
  /** Property key for the events array under the channel; default "events". */
  key?: Key;
  /** How many recent events to emit per assembly; default 12. */
  windowSize?: number;
  /** Salience saturates at `windowSize / saliencePer`; default = windowSize. */
  saliencePer?: number;
  /** Pass-through to ObservationSource habituationTau. */
  habituationTau?: number;
  /** Optional render to project payloads before emitting (e.g. JSON.stringify).
   *  If omitted, raw payloads (plus `at`) are emitted as-is. */
  render?: (event: TimelineEvent<E>) => unknown;
}

export class Timeline<E> implements ObservationSource<unknown> {
  private readonly events: TimelineEvent<E>[] = [];

  readonly id: string;
  readonly channels: Channel[];
  readonly habituationTau?: number;
  readonly salience: Evaluator<unknown, number>;
  readonly properties: Record<Channel, Record<Key, Evaluator<unknown>>>;

  constructor(opts: TimelineObservationOptions<E> = {}) {
    this.id = opts.id ?? "timeline";
    this.channels = opts.channels ?? ["auditory"];
    if (opts.habituationTau !== undefined) this.habituationTau = opts.habituationTau;

    const channel = opts.channel ?? this.channels[0] ?? "auditory";
    const key = opts.key ?? "events";
    const windowSize = opts.windowSize ?? 12;
    const saliencePer = opts.saliencePer ?? windowSize;
    const render = opts.render;

    this.salience = () =>
      saliencePer <= 0 ? (this.events.length > 0 ? 1 : 0) : Math.min(1, this.events.length / saliencePer);

    const props: Record<Channel, Record<Key, Evaluator<unknown>>> = {};
    for (const ch of this.channels) props[ch] = {};
    props[channel] = props[channel] ?? {};
    props[channel][key] = () => {
      const recent = this.window(windowSize);
      return render ? recent.map(render) : recent;
    };
    this.properties = props;
  }

  push(payload: E, at?: number): TimelineEvent<E> {
    const ev: TimelineEvent<E> = { at: at ?? Date.now(), payload };
    this.events.push(ev);
    return ev;
  }

  pushAll(events: Iterable<TimelineEvent<E>>): void {
    for (const e of events) this.events.push(e);
  }

  since(t: number): TimelineEvent<E>[] {
    return this.events.filter((e) => e.at >= t);
  }

  until(t: number): TimelineEvent<E>[] {
    return this.events.filter((e) => e.at <= t);
  }

  between(t0: number, t1: number): TimelineEvent<E>[] {
    const lo = Math.min(t0, t1);
    const hi = Math.max(t0, t1);
    return this.events.filter((e) => e.at >= lo && e.at <= hi);
  }

  /** Last n events (or all if fewer than n exist). n <= 0 returns []. */
  window(n: number): TimelineEvent<E>[] {
    if (n <= 0) return [];
    return this.events.slice(-n);
  }

  /** Events at or after t, optionally capped to the last n of those. */
  windowSince(t: number, n?: number): TimelineEvent<E>[] {
    const tail = this.since(t);
    if (n === undefined || n <= 0 || tail.length <= n) return tail;
    return tail.slice(-n);
  }

  all(): readonly TimelineEvent<E>[] {
    return this.events;
  }

  count(): number {
    return this.events.length;
  }

  last(): TimelineEvent<E> | undefined {
    return this.events[this.events.length - 1];
  }

  /** Drop events with `at < beforeTime`. Without arg, wipes the buffer.
   *  Returns the number removed. */
  clear(beforeTime?: number): number {
    if (beforeTime === undefined) {
      const n = this.events.length;
      this.events.length = 0;
      return n;
    }
    let removed = 0;
    while (this.events.length > 0 && this.events[0].at < beforeTime) {
      this.events.shift();
      removed++;
    }
    return removed;
  }

  toJSON(): TimelineEvent<E>[] {
    return this.events.slice();
  }

  static fromJSON<E>(data: TimelineEvent<E>[], opts?: TimelineObservationOptions<E>): Timeline<E> {
    const t = new Timeline<E>(opts);
    t.pushAll(data);
    return t;
  }
}

/** Project events into a single newline-joined string. Useful for the
 *  render() debug pane in examples; not used by the observation pipeline
 *  (which prefers structured payloads — see rule #9). */
export function summarize<E>(events: readonly TimelineEvent<E>[], render: (e: E, at: number) => string): string {
  return events.map((e) => render(e.payload, e.at)).join("\n");
}
