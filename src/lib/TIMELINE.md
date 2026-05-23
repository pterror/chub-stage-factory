# Timeline — append-only event log + ObservationSource

`Timeline<E>` is the buffer-of-stamped-events primitive every example
re-rolls as `events: E[] = []`. It owns push, time/count windowing,
`toJSON`/`fromJSON`, and — the headline feature — implements
`ObservationSource<unknown>` so a stage hands the timeline directly to
`assembleObservations(...)` with no adapter.

## Push, query, drop

```ts
import { Timeline } from "./lib/timeline";

const log = new Timeline<{ kind: string; data?: unknown }>();

log.push({ kind: "hit", data: { dmg: 4 } }, now);
log.push({ kind: "miss" }, now + 1);

log.window(10);              // last 10
log.since(now - 60);         // last minute
log.between(t0, t1);
log.windowSince(t0, 5);      // up to 5 from "after t0"
log.clear(now - 300);        // drop everything older than 5 min
log.last();                  // most-recent event or undefined
```

## As an ObservationSource

```ts
import { Timeline } from "./lib/timeline";
import { assembleObservations, formatObservations } from "./lib/observation";

combatLog = new Timeline<CombatEvent>({
  id: "combat-events",
  channels: ["auditory"],
  windowSize: 20,            // emit last 20
  habituationTau: 1,
});

// In beforePrompt:
const observed = assembleObservations(
  [this.combatLog, /* other sources */],
  this.state,
  { now, maxCount: 8, lastEmittedAt: this.habit },
);
const stageDirections = formatObservations(observed);
```

The constructor builds the `ObservationSource` surface from your
options — id, channels, salience (saturating to 1 by event count),
properties (a single `events` evaluator on the configured channel).
The `state` argument the evaluator receives is ignored; the timeline
reads its own buffer.

For richer rendering, supply `render`:

```ts
const log = new Timeline<RealtimeEvent>({
  windowSize: 15,
  render: (e) => ({ at: e.at, kind: e.payload.kind, target: e.payload.target }),
});
```

## Persistence paradigm per timeline

A Timeline becomes a Shard like any other stateful primitive. Pick the
paradigm from the per-shard menu in `persistence/README.md`:

| Use case | Backend | History |
|---|---|---|
| Combat log (branchy: swipe undoes the round) | `messageStateBackend` | `chubTreeHistory()` |
| Canon history (e.g. choices the chat has made) | `chatStateBackend` | `forbidBranching(snapshotHistory())` |
| Session-only buffer (UI scratch) | — | no Shard |

```ts
import { shardOf } from "./lib/persistence";

events: shardOf(
  "events", this.combatLog,
  (d: ReturnType<Timeline<CombatEvent>["toJSON"]>) =>
    Timeline.fromJSON<CombatEvent>(d, { windowSize: 20, habituationTau: 1 }),
  this.layers.messageStateBackend, chubTreeHistory(),
),
```

The constructor options pass through `fromJSON` because they describe
how the timeline behaves as an observation source, not what it
contains. Reload restores the buffer; the source wiring is
reconstructed from the options the stage knew at construction.

## summarize — for debug panes only

```ts
import { summarize } from "./lib/timeline";

<pre>{summarize(log.window(20), (e, at) => `${at}: ${e.kind}`) || "—"}</pre>
```

For render() / debug surfaces. Don't pipe `summarize` output into
`stageDirections` — rule #9 wants structured payloads to the LLM,
not pre-baked prose.
