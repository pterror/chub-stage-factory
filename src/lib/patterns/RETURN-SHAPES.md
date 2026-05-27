# Composer return shapes

Three shapes coexist across the pattern library. This document names the
discriminant so authors know which to expect (and which to use when authoring
a new composer).

---

## The three shapes

### 1. `*Bundle` — rich object with methods

A Bundle packs the live primitives *and* ergonomic helpers into one plain
object. The stage unpacks only what it needs.

```ts
// inventory.ts
export interface InventoryBundle {
  inv: Inventory;
  tick: { n: number };
  habituation: Map<string, number>;
  layers: ReturnType<typeof createChubLayers>;
  store: PersistenceStore;
  buildBeforePrompt(msg, bound): Promise<Partial<StageResponse<…>>>;
}
```

`inventoryPattern(…)` returns an `InventoryBundle`. The stage stores
`this.p = inventoryPattern(…)` and calls `this.p.buildBeforePrompt(…)` — one
call drives the whole subsystem.

**Canonical examples:** `inventory.ts`, `body-transformation.ts`,
`turn-combat.ts`, `realtime-combat.ts`, `effects.ts`, `cyber-slots.ts`,
`physics.ts`, `dialogue.ts`, `score.ts`, `faction.ts`, `skit.ts`, `form.ts`,
`form-collection.ts`, `puppet.ts`, `managerial.ts`, `bulk-tick.ts`,
`sandbox.ts`, `world-exploration.ts`, `subject-sandbox.ts`,
`slot-assignment.ts`, `spatial-propagation.ts`, `daily-vignette.ts`,
`lineage.ts`.

---

### 2. `ComposedSubsystem<S>` — declarative descriptor

Defined in `synergy/types.ts`. A pure data record: state, context
contributors, lifecycle hooks, and persistence shard descriptors. The stage
registers the subsystem with an orchestrator (`LlmPipelineRunner` or similar);
the orchestrator drives it.

```ts
// synergy/types.ts (lines 48-59)
export interface ComposedSubsystem<S> {
  state: S;
  contributors?: ContextContributor[];
  hooks?: PatternHooks;
  shards?: PatternShard[];
}
```

The stage does not call methods on the subsystem directly; it hands it to a
pipeline and the pipeline calls `hooks.beforePrompt`, `hooks.afterResponse`,
etc. on its behalf.

**Canonical examples:** all 22 synergy patterns (`cache-by-key`,
`hierarchical-summarization`, `triplehook-pipeline`, …). See
`src/lib/LLM-PIPELINE.md` for the pipeline wiring.

---

### 3. Ad-hoc — named hooks object, no standard envelope

Some composers return a flat object whose shape is unique to the mechanic.
No `state`, no `contributors`, no `buildBeforePrompt`.

```ts
// grafting.ts
export interface GraftingBundle {
  hooks: {
    subsume(formId, abilityId): InjectionRecord;
    inject(req): FormConfig;
    replace(req): FormConfig;
    listLearned(): AbilityDef[];
    listInjected(formId): FormConfig[];
  };
}
```

`graftingPattern(…)` returns a `GraftingBundle`. There are no lifecycle
helpers; the stage calls `hooks.subsume`, `hooks.inject`, and so on at the
points that make sense for the Helminth mechanic.

**Other examples:** `lineage.ts` (graph-query helpers only, no tick loop);
`procgen.buildGraph` (returns `{ nodes, edges }` with no wrapper at all).

---

## The discriminant

| Use this shape | When… |
|---|---|
| `*Bundle` | The subsystem has a tick loop, `beforePrompt`/`afterResponse` helpers, and persistence wiring. The stage needs to call it each turn. |
| `ComposedSubsystem<S>` | The subsystem plugs into `LlmPipelineRunner` or another orchestrator that drives the lifecycle. The stage registers rather than calls. |
| Ad-hoc | The mechanic is a pure operation set with no turn-level lifecycle — a query API, a mutation surface, or a one-shot builder. |

If the composer needs to run every turn: Bundle.
If it delegates its turn-driving to a pipeline: ComposedSubsystem.
If it is stateless or has no turn lifecycle: ad-hoc.

---

## Converting between shapes

Conversion is not required. If a Bundle is working, keep it.

**Ad-hoc → Bundle:** add a `buildBeforePrompt` / `buildAfterResponse` wrapper
that calls the ad-hoc hooks in order, collects stage directions, and merges
with the bound persistence response via `mergeResponses`. Wire a
`PersistenceStore` shard if the mechanic needs durable state.

**Bundle → ComposedSubsystem:** extract `state`, move `buildBeforePrompt`
into `hooks.beforePrompt` with the pipeline's `ctx`-threaded signature, and
declare `contributors` and `shards` as arrays. Requires the stage to adopt
`LlmPipelineRunner`; see `src/lib/LLM-PIPELINE.md`.

---

## Honest note

This is **documented, not enforced**. TypeScript does not prevent a composer
from returning any shape. The three shapes emerged from three distinct use
cases and have not been unified because each coercion would add complexity for
the authors writing in that mode. Convergence toward a single shape may happen
in a future wave; for now, match the shape to the use case using the
discriminant above.
