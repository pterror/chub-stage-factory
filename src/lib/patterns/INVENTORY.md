# inventoryPattern — inventory + observation + chub-adapters composer

Wires an `Inventory` with tick-based persistence shards and spot-contents /
disorder observation sources. Returns a bundle the stage holds on `this.p`; the
bundle exposes `buildBeforePrompt` so the stage's hook is a one-liner.

## Purpose

Every inventory stage re-derives the same: tick-increment → stall-contents
observation → disorder observation → `emitStageDirections` → `mergeResponses`.
`inventoryPattern` collapses that wiring into a single factory call. The stage
keeps only item registration, spot setup, and JSX rendering.

## API [`src/lib/patterns/inventory.ts`](./inventory.ts)

```ts
interface InventoryBundleInit {
  messageState: Record<string, string | undefined> | null;
  extraSources?: ObservationSource<{ now: number }>[];
  stageDirections: {
    architectures?: readonly ArchitectureName[];
    register?: RegisterSpec;
    prefix?: string;
  };
}

interface InventoryBundle {
  inv: Inventory;
  tick: { n: number };
  habituation: Map<string, number>;
  layers: ReturnType<typeof createChubLayers>;
  store: PersistenceStore;
  buildBeforePrompt(msg, bound): Promise<Partial<StageResponse<...>>>;
}

function inventoryPattern(init: InventoryBundleInit): InventoryBundle
```

- **`inv`** — the `Inventory` instance. Register items and spots on it after construction.
- **`tick`** — mutable tick counter; incremented by `buildBeforePrompt`.
- **`store`** — pass directly to `this.initStore(() => this.p.store)` in the constructor.
- **`buildBeforePrompt(msg, bound)`** — increments tick, assembles two built-in sources
  (`stall-contents`, `stall-disorder`) plus any `extraSources`, calls `emitStageDirections`,
  merges with `bound.beforePrompt`.

## Example

```ts
constructor(data) {
  super(data);
  const ms = (data.messageState as Record<string, string | undefined> | null) ?? null;
  this.p = inventoryPattern({
    messageState: ms,
    stageDirections: { architectures: ["accumulation"], register: { pov: "close-second", tense: "present", distance: "close" }, prefix: "..." },
  });
  this.p.inv.register({ id: "sword", carryClass: "explicit", portable: true, counted: false });
  this.p.inv.ensureSpot("shelf");
  this.p.inv.add("shelf", "sword");
  this.initStore(() => this.p.store);
}

async beforePrompt(msg) {
  return this.p.buildBeforePrompt(msg, this.bound);
}
```

## Gotchas

- Register items and spots **after** calling `inventoryPattern`, before `initStore`. The
  store snapshot runs during `initStore`; items registered after that call won't persist.
- The built-in sources emit `stall-contents` (visual, salience 0.6) and `stall-disorder`
  (interoceptive). If your stage uses different spot semantics, supply `extraSources` and
  keep the built-ins — they don't assume shopkeeper framing, only that spots have disorder.
- `afterResponse` is not wired by this composer — item mutations triggered by player
  actions belong in stage-specific logic.
