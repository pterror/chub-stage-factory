# bodyTransformationPattern — body + transformation + snapshots + timeline + observation composer

Wires a `Body` + `Snapshots` + `Timeline<string>` + tick counter with split
persistence (tick on messageState, body+snaps on chatState + `forbidBranching`).
Provides `buildBeforePrompt` (trajectory advance → body tick → tag observation →
stage directions) and `buildAfterResponse` (drink/restore tag parse → `tryApply`
→ snapshot restore → tag strip).

## Purpose

Every body-transformation stage re-derives the same loop: tick → `applyTrajectories`
→ `body.tick` → observe effective tags + in-progress TFs → parse drink/restore tags →
conflict resolution → `apply` → `snaps.restore`. `bodyTransformationPattern` collapses
that wiring; the stage keeps only slot schema, transformation definitions, and rendering.

## API [`src/lib/patterns/body-transformation.ts`](./body-transformation.ts)

```ts
interface BodyTransformationBundleInit {
  messageState: Record<string, string | undefined> | null;
  chatState: Record<string, string | undefined> | null;
  initialSlots: Record<string, string[]>;
  baselineSnapshot?: string | null;  // default "baseline"; null to skip
  tfs: Registry<TransformationDef>;
  drinkTagName?: string;    // default "drink"
  restoreTagName?: string;  // default "restore"
  stageDirections: { architectures?; register?; prefix? };
}

interface BodyTransformationBundle {
  body: Body;
  snaps: Snapshots;
  tick: { n: number; lastApplied?: string };
  applied: Timeline<string>;
  layers: ReturnType<typeof createChubLayers>;
  store: PersistenceStore;
  buildBeforePrompt(msg, bound): Promise<Partial<StageResponse<...>>>;
  buildAfterResponse(msg, bound): Promise<Partial<StageResponse<...>>>;
}

function bodyTransformationPattern(init: BodyTransformationBundleInit): BodyTransformationBundle
```

- **`initialSlots`** — slot → base-tag arrays used to construct the `Body`.
  The baseline snapshot (if enabled) is saved immediately after construction.
- **`baselineSnapshot`** — name of the auto-saved snapshot. Set to `null` if the
  stage manages snapshots manually. Default `"baseline"`.
- **`tfs`** — registry of `TransformationDef`s used for drink-tag validation and
  conflict resolution inside `tryApply`.
- **`buildBeforePrompt`** — increments tick, calls `applyTrajectories` and `body.tick`,
  assembles the `body-state` interoceptive observation, emits stage directions.
- **`buildAfterResponse`** — parses drink + restore tags, calls internal `tryApply`
  (conflict check → `apply`), or calls `snaps.restore` + clears the applied timeline.
  Sets `tick.lastApplied` on success.

## Example

```ts
const TFS = new Registry<TransformationDef>({ cat_tail: { ... }, ... });

constructor(data) {
  super(data);
  this.p = bodyTransformationPattern({
    messageState: ..., chatState: ...,
    initialSlots: { head: ["human"], torso: ["human"], tail: [] },
    tfs: TFS,
    stageDirections: { architectures: ["body_then_world"], register: { ... }, prefix: "..." },
  });
  this.initStore(() => this.p.store);
}

async beforePrompt(msg) { return this.p.buildBeforePrompt(msg, this.bound); }
async afterResponse(msg) { return this.p.buildAfterResponse(msg, this.bound); }
```

## Gotchas

- Body and snapshot state are persisted on `chatState` with `forbidBranching`. A swipe
  does NOT un-transform the body — that's a deliberate design stance. To undo, the
  player emits `<restore>baseline</restore>` (or whatever snapshot name was saved).
- `tryApply` returns `{ ok: false, reason }` silently — no exception, no user-visible
  message. The stage's prose can surface this if needed by inspecting `tick.lastApplied`
  (set only on success).
- `applied.clear()` is called on restore — the timeline resets so past-applied
  tinctures don't show in observations after an undo.
- The `body-state` observation has salience `min(1, tfs.length / 3 + 0.3)` — an
  untransformed body still appears with salience 0.3 to keep the LLM aware of slot tags.
