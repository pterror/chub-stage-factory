# effectsPattern — effects + timeline + observation composer

Wires an `EffectStore` + `Timeline<string>` with tick-based persistence and
active-effects / tincture-menu observation sources. Provides `buildBeforePrompt`
(tick → expire → observe → stage-directions) and `buildAfterResponse`
(apply/dispel tag parse → effectStore mutation → tag strip).

## Purpose

Every effects stage re-derives the same: tick → `effectStore.tick` → expired
push to timeline → observe → `emitStageDirections` → parse apply/dispel tags →
mutate `effectStore`. `effectsPattern` collapses that into two bundle helpers;
the stage keeps only effect definitions and prose config.

## API [`src/lib/patterns/effects.ts`](./effects.ts)

```ts
interface EffectsBundleInit {
  messageState: Record<string, string | undefined> | null;
  tinctures: Registry<EffectDef>;
  applyTagName?: string;    // default "apply"
  dispelTagName?: string;   // default "dispel"
  stageDirections: {
    architectures?: readonly ArchitectureName[];
    register?: RegisterSpec;
    prefix?: string;
  };
}

interface EffectsBundle {
  effectStore: EffectStore;
  tick: { n: number };
  events: Timeline<string>;
  layers: ReturnType<typeof createChubLayers>;
  store: PersistenceStore;
  buildBeforePrompt(msg, bound): Promise<Partial<StageResponse<...>>>;
  buildAfterResponse(msg, bound): Promise<Partial<StageResponse<...>>>;
}

function effectsPattern(init: EffectsBundleInit): EffectsBundle
```

- **`tinctures`** — registry of `EffectDef`s used for LLM apply-tag validation and
  `EffectStore.fromJSON` restoration. Pass the same registry you surface to the LLM.
- **`applyTagName` / `dispelTagName`** — tag names the LLM uses. Change if your stage
  uses domain-specific tags like `<brew>` / `<neutralize>`.
- **`buildBeforePrompt`** — increments tick, drains expired effects onto the timeline,
  assembles `active-effects` + `tincture-menu` sources, emits stage directions.
- **`buildAfterResponse`** — parses apply + dispel tags, mutates `effectStore`, strips
  matched tags from the bot message.

## Example

```ts
const TINCTURES = new Registry<EffectDef>({ ... });

constructor(data) {
  super(data);
  this.p = effectsPattern({
    messageState: (data.messageState as Record<string, string | undefined> | null) ?? null,
    tinctures: TINCTURES,
    stageDirections: { architectures: ["focus_hold"], register: { ... }, prefix: "..." },
  });
  this.initStore(() => this.p.store);
}

async beforePrompt(msg) { return this.p.buildBeforePrompt(msg, this.bound); }
async afterResponse(msg) { return this.p.buildAfterResponse(msg, this.bound); }
```

## Gotchas

- `tinctures` must be a module-level constant (or at least stable across calls) because
  `EffectStore.fromJSON` receives `tinctures.toJSON()` for effect definition lookup on
  restore. A freshly constructed registry each time will work, but prefer a constant.
- The `tincture-menu` observation has salience 0.3 and habituationTau 20 — it fades after
  ~20 ticks. If the LLM stops seeing available tinctures mid-session, that's why.
- `dispelByTag` is called with the tag body verbatim. Make sure the LLM knows to emit
  tag names that match a `dispelTags` entry on one of the active effects.
