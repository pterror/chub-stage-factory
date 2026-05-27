# patterns/physics.ts

## Purpose

Wires `SpatialHash` (static obstacle grid) + `AABB` projectile simulation
+ `Rng` (cosmetic spin jitter) + default visual `ObservationSource` into a
single bundle. Removes the setup and simulation loop that every
physics-sandbox stage repeats.

The composer owns no state beyond the `SpatialHash` and `Rng`. The `hash`
and `rng` fields are directly accessible for stage-specific extension
(e.g. dynamic obstacle insertion, seeded event generation).

## API

```ts
interface PhysicsObstacle { name: string; aabb: AABB }

interface PhysicsInit {
  room: AABB;
  obstacles: PhysicsObstacle[];
  cellSize?: number;   // default 32
  rngSeed?: string;    // default "physics"
  simOpts?: {
    dt?: number;                  // default 0.1
    maxSteps?: number;            // default 60
    friction?: number;            // default 0.92
    wallRestitution?: number;     // default 0.6
    obstacleRestitution?: number; // default 0.5
    projectileSize?: { w; h };    // default { w: 6, h: 6 }
    restThreshold?: number;       // default 0.5
  };
}

interface PhysicsSimResult { hit: string[]; final: AABB; steps: TrajectoryStep[] }

interface PhysicsBundle {
  hash: SpatialHash<PhysicsObstacle>;
  rng: Rng;
  simulate(x, y, vx, vy): PhysicsSimResult;
  observationSources(lastResult?): ObservationSource<{ now: number }>[];
}

function physicsPattern(init: PhysicsInit): PhysicsBundle
```

## Example

```ts
const phys = physicsPattern({
  room: { x: 0, y: 0, w: 200, h: 120 },
  obstacles: [
    { name: "workbench", aabb: { x: 60, y: 40, w: 80, h: 20 } },
  ],
  rngSeed: "mara-studio",
});

// in afterResponse:
const [x, y, vx, vy] = args.map(Number);
lastResult = phys.simulate(x, y, vx, vy);

// in beforePrompt:
const observed = assembleObservations(
  phys.observationSources(lastResult),
  { now }, { now, maxCount: 3 },
);
```

## Gotchas

- `simulate` uses `rng.cosmetic` for per-bounce jitter. The cosmetic
  stream advances on each obstacle collision — results are deterministic
  per sequence of calls on the same `Rng` instance, but will drift if you
  call `rng.cosmetic` elsewhere between simulations.
- `observationSources` takes `lastResult` as an argument (not stored
  inside the bundle) so the caller controls when result data appears in
  observations. Pass `undefined` if no throw has happened yet.
- The `last-throw` source has `habituationTau: 0` — it re-surfaces on
  every tick so the LLM always sees the most recent throw result.
- `hash` is populated with the static `obstacles` at construction and
  never mutated by `simulate`. Dynamic obstacles require calling
  `hash.insert` / `hash.remove` in the stage.
- Persistence of `lastResult` and `rng` is not included here; it remains
  in the stage because shard strategy (initState vs messageState) is
  stage-specific.
