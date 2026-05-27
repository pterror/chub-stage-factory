# skitPattern

**File:** `src/lib/patterns/skit.ts`
**Composes:** `scenePattern` + `ActorPool`/`Actor` + `observation.assembleObservations` + `Timeline`
**Enables:** LT-shape (#6), CoC-shape (#4), any erotic-RPG-axis stage

## Purpose

Delivers PARC-style "make a Skit" ergonomics as pure composition. A skit is a scene with named participants, predicate-gated actions, arousal tracking, and LLM-ready structured observations — all wired into one import.

The pattern wraps `scenePattern` entirely; all `scenePattern` capabilities (action registry, consequence registry, prose-tag parsing) are accessible via `bundle.scene`.

## API

```ts
skitPattern(init: SkitBundleInit): SkitBundle
```

### `SkitBundleInit`

| Field | Required | Description |
|---|---|---|
| `actors` | ✓ | `ActorPool` or `Map<ActorId, Actor>` |
| `actions` | ✓ | `Registry<SceneActionDef>` |
| `position` | ✓ | `ScenePosition` (slot map per actor) |
| `agency` | ✓ | `Map<ActorId, Agency>` |
| `pace` | ✓ | `Map<ActorId, Pace>` |
| `rng` | ✓ | `Rng` or `RngStream` |
| `onOutcome` | — | `(outcome, bundle) => void` called after each `step` |
| `proseTagSchema` | — | Enables `parseActionTags` on the bundle |
| `timeline` | — | Bring-your-own; created if omitted |

### `SkitBundle`

| Method/Field | Description |
|---|---|
| `scene` | The underlying `SceneBundle` |
| `actors` | Participant source passed at init |
| `timeline` | `Timeline<SceneEvent>` |
| `step(performerId, receiverId, actionId, roles?)` | Dispatch action; calls `onOutcome` on success |
| `tick(now, effects?)` | Advance arousal clocks; returns fired events |
| `observe(state, opts)` | Assemble salience-ranked observations for LLM context |
| `parseActionTags?(llmOutput)` | Defined when `proseTagSchema` supplied |

## Example

```ts
const skit = skitPattern({
  actors: actorPool,
  actions: actionRegistry,
  position: new Map([["alice", { id: "alice", tags: ["vagina"] }]]),
  agency: new Map([["alice", Agency.Full]]),
  pace: new Map([["alice", Pace.SubNormal]]),
  rng,
  onOutcome: (outcome) => {
    // apply arousal delta to stats, etc.
  },
});

const result = skit.step("player", "alice", "caress");
const obs = skit.observe(worldState, { now: Date.now() });
```

## Gotchas

- `observe` passes only `scene.timeline` as an observation source. To add more sources (body state, inventory, world flags), call `assembleObservations` directly with a merged list.
- `onOutcome` is called synchronously inside `step`. Don't await inside it.
- PARC's "Skit" also carries module/outfit/scenario metadata — those are stage-author concerns, not library concerns. `skitPattern` handles the mechanical shape only.
