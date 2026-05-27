# bulkTickPattern

**File:** `src/lib/patterns/bulk-tick.ts`
**Composes:** `ActorPool` + `Timeline`
**Enables:** FC-shape (#8), FS-shape (#7)

## Purpose

Wires the managerial tick loop: `ActorPool.forEach` → stage-author's `processActor` → collect events → push to `Timeline` → render text report. The stage author provides all domain logic inside `processActor`; the pattern owns the collection and forwarding loop.

## API

```ts
bulkTickPattern({ pool, processActor, timeline? }): BulkTickBundle<E>
```

### `processActor`

```ts
type TickEventProcessor<E> = (actor: Actor, now: number) => E[]
```

Called once per actor per tick. Mutate actor state here (stats, location, owner, tags). Return events describing what happened.

### `BulkTickBundle<E>`

| Method/Field | Description |
|---|---|
| `pool` | The `ActorPool` |
| `timeline` | `Timeline<E>` |
| `tick(now?)` | Run the full tick loop; returns all events |
| `report(events, render)` | Render events to a string via `render(event)` |
| `tickAndReport(render, now?)` | Convenience: `{ events, report }` in one call |

## Example

```ts
type SlaveEvent =
  | { kind: "obedience-drop"; id: string; delta: number }
  | { kind: "escape-attempt"; id: string };

const tick = bulkTickPattern<SlaveEvent>({
  pool: slavePool,
  processActor(actor, now) {
    const events: SlaveEvent[] = [];
    const obedience = actor.getStat("obedience");
    if (obedience && obedience.effective() < 20) {
      obedience.base -= 2;
      events.push({ kind: "obedience-drop", id: actor.id, delta: -2 });
    }
    return events;
  },
});

const { events, report } = tick.tickAndReport((e) =>
  e.kind === "escape-attempt"
    ? `⚠ ${e.id} attempted escape`
    : `${e.id}: obedience ${e.delta}`,
);
```

## Gotchas

- `processActor` is called synchronously; it must not be async. Queue any async work (LLM calls, etc.) and apply it after `tick` returns.
- `timeline` default `windowSize` is 50. For FC-scale stages with 100+ actors producing multiple events each, increase this or call `timeline.clear(before)` between ticks.
- `report` with 0 events returns `"(no events this tick)"` — safe to display verbatim.
- For stages that also need a player-as-ruler policy loop on top of `bulkTick`, see `managerial.ts` (Wave 2C, not yet implemented).
