# patterns/realtime-combat.ts

## Purpose

Wires `RealtimeWorld` + `Timeline<RealtimeEvent>` + `Rng` (cosmetic) +
default visual `ObservationSource` into a single bundle. Removes the
boilerplate that every arena-style stage repeats when standing up a physics
combat loop.

The composer owns no state. Everything it returns — `world`, `events`,
`rng` — is the underlying primitive, directly accessible for
stage-specific mutations.

## API

```ts
interface RealtimeCombatInit {
  seed: number;          // passed to RealtimeWorld
  bounds: Bounds;        // arena collision bounds
  rngSeed?: string;      // cosmetic rng seed (default "arena")
  timelineOpts?: { ... } // windowSize, channels, saliencePer, habituationTau
}

interface RealtimeCombatBundle {
  world: RealtimeWorld;
  events: Timeline<RealtimeEvent>;
  rng: Rng;
  tick(dt, now): RealtimeEvent[];
  spawnAttack(def, ownerId, state, now): void;
  observationSources(): ObservationSource<{ now: number }>[];
}

function realtimeCombatPattern(init: RealtimeCombatInit): RealtimeCombatBundle
```

## Example

```ts
const combat = realtimeCombatPattern({
  seed: 48,
  bounds: { minX: 0, maxX: 240, minY: 0, maxY: 160 },
  rngSeed: "arena",
});

// add combatants
combat.world.add({ id: "you", pos: { x: 120, y: 80 }, ... });

// in afterResponse:
combat.events.clear();
for (let i = 0; i < 5; i++) {
  combat.tick(0.1, now + i * 0.1);
}

// in beforePrompt:
const observed = assembleObservations(
  [...combat.observationSources(), combat.events],
  { now }, { now, maxCount: 3 },
);
```

## Gotchas

- `tick` pushes events onto `combat.events`. If you want to cull the
  timeline between turns (as realtime-combat does), call
  `combat.events.clear()` before the tick loop.
- `spawnAttack` is a thin wrapper — it does not normalise velocity. Do
  that in the stage before calling it.
- The default `observationSources()` reports combatant hp/team/pos and
  active attack count. Add your own sources in `assembleObservations` if
  you need richer observation (e.g. the events timeline itself).
- `rng` is the full `Rng` instance. Use `rng.cosmetic` for per-step jitter
  that you don't want to affect seeded reproducibility.
