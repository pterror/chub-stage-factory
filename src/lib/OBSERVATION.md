# Observation — stage-to-LLM structured sense data

`observation.ts` is the stage→LLM bridge for world state. The stage
registers `ObservationSource` objects; `assembleObservations` scores,
filters, and sorts them; `formatObservations` renders the payload as a
fenced JSON block for the model's context window.

## Concepts

- **ObservationSource** — declares sensory channels it speaks on (e.g.
  `"visual"`, `"tactile"`, `"interoceptive"`), a `salience(state) => 0..1`
  scorer, an optional `available(state)` gate, a `properties` map of
  `channel → { key → evaluator(state) }`, and an optional `habituationTau`.
- **Habituation** — sources with `habituationTau > 0` have their salience
  multiplied by an exponential recovery factor. A source emitted last turn
  starts at ~0 salience and recovers toward 1 over the next `tau` time
  units. `assembleObservations` reads and writes a `lastEmittedAt` map that
  the stage must persist between calls.
- **AssembledObservation** — the output shape: `{ id, channels, salience, values }`.
  `values` is `Record<channel, Record<key, unknown>>` — raw evaluated data,
  not prose.
- **formatObservations** — renders as `<observations>…</observations>` with
  compact JSON. Prepend prose instructions from `prose-register.ts` and
  append to `stageDirections`.

## API

- `interface ObservationSource<S>` (`src/lib/observation.ts:46-53`)
- `interface AssembledObservation` (`src/lib/observation.ts:55-60`)
- `interface AssembleOptions { now, maxCount?, lastEmittedAt? }` (`src/lib/observation.ts:62-67`)
- `assembleObservations(sources, state, opts): AssembledObservation[]` — filters, habituates, sorts by salience desc, optionally caps count (`src/lib/observation.ts:77-103`)
- `formatObservations(observed): string` — fenced JSON block (`src/lib/observation.ts:125-132`)
- `asContributor(sources, options?): ContextContributor` — wraps one source or array; alias of `observationContributor` from `context.ts` (`src/lib/observation.ts:115-123`)

## Gotchas

- `lastEmittedAt` is mutated by `assembleObservations` — pass the same
  `Map` instance every call and persist it alongside stage state.
- A source with `salience` returning `0` is excluded entirely, even if
  `available` returns `true`. Zero salience is the correct way to suppress.
- `assembleObservations` does not call any `EffectStore` or `Body` methods;
  those are your evaluator functions' responsibility.
