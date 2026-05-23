# persistence

Composition-over-strategy state persistence for Chub stages.

## The shape

Three things compose:

1. **A `SaveBackend`** says *where* a blob lives. Three Chub-layer backends ship: `initStateBackend` (one-shot, set in `load()`), `chatStateBackend` (one truth across the whole chat — does not fork on swipes), `messageStateBackend` (per-message — *may* fork on swipes, see Phase 7 notes).
2. **A `History<M>`** says *how branches behave*. `chubTreeHistory` keeps a moment per commit and branches on swipe. `forbidBranching(h)` collapses commits onto the trunk so the state cannot un-do via a sibling branch. `noHistory` is single-moment. `bounded(h, n)` and `persisted(h, b, key)` are wrappers.
3. **A `Shard<M>`** bundles `{name, state, backend, history}`. `PersistenceStore` holds many; `load()` / `commit()` walk them as a unit.

A stage author wires one stateful primitive in one `shard(...)` call. No `setState` boilerplate.

## The recipe table

| want | backend | history |
|---|---|---|
| per-branch inventory (swipe un-uses an item) | `messageStateBackend` | `chubTreeHistory()` |
| canon body that survives swipes (TF doesn't un-transform) | `chatStateBackend` | `forbidBranching(snapshotHistory())` |
| RNG seed set once, immutable | `initStateBackend` | `noHistory()` |
| effect store (per-branch ticks) + base stats (canon) | mixed shards | mixed |
| in-session undo with manual slots | `messageStateBackend` | `bounded(chubTreeHistory(), 64)` + `saveSlot()` |
| autosave-to-localStorage backup | `tee(chatStateBackend, localBackend)` | any |
| coalesce noisy commits | `debounced(b, 200)` | any |

## Wiring a stage

```ts
import {
  createChubLayers, chubTreeHistory, forbidBranching, snapshotHistory, noHistory,
  PersistenceStore, shard, bindStore, mergeResponses,
} from "../../src/lib/persistence";

class MyStage extends StageBase<Init, Chat, Msg, Config> {
  inv = new Inventory();
  body = new Body({...});
  rng = Rng.fromSeed("seed");
  layers = createChubLayers();
  store: PersistenceStore;
  bound: ReturnType<typeof bindStore<Chat, Msg>>;

  constructor(data) {
    super(data);
    // ...register defs, seed initial state...
    this.layers = createChubLayers({
      messageState: data.messageState as any ?? null,
      chatState: data.chatState as any ?? null,
      initState: data.initState as any ?? null,
    });
    this.store = new PersistenceStore({
      inv: shard("inv", this.inv, (i) => i.toJSON(), (d) => Inventory.fromJSON(d), this.layers.messageStateBackend, chubTreeHistory()),
      body: shard("body", this.body, (i) => i.toJSON(), (d) => Body.fromJSON(d), this.layers.chatStateBackend, forbidBranching(snapshotHistory())),
      rng: shard("rng", this.rng, (i) => i.toJSON(), (d) => Rng.fromJSON(d), this.layers.initStateBackend, noHistory()),
    });
    this.bound = bindStore(this.store, { layers: this.layers });
  }

  async load() {
    await this.store.load();
    const { chatState, messageState } = await this.bound.initial();
    return { success: true, error: null, initState: null, chatState, messageState };
  }
  async setState(state) { await this.bound.setState(state); }
  async beforePrompt(msg) {
    // ...your prose work...
    return mergeResponses({ stageDirections }, await this.bound.beforePrompt(msg));
  }
  async afterResponse(msg) {
    // ...your post-processing...
    return mergeResponses({ }, await this.bound.afterResponse(msg));
  }
}
```

## TypeScript hint: `JsonOf<T>`

Because `shard(name, instance, toJSON, fromJSON, ...)` infers `M` from
`toJSON`'s return type, the `fromJSON` parameter usually needs an
explicit annotation when the primitive's static `fromJSON` has a strict
signature (e.g. `Inventory.fromJSON(data: { defs: ItemDef[]; ... })`).
The idiom:

```ts
shard("inv", this.inv,
  (i) => i.toJSON(),
  (d: ReturnType<Inventory["toJSON"]>) => Inventory.fromJSON(d),
  this.layers.messageStateBackend, chubTreeHistory())
```

This is verbose but it keeps the shard helper a one-liner without a
parallel `JsonOf<T>` helper that would couple every primitive's name.

## What this does NOT do

- It does not auto-detect what layer a primitive *should* live on. That is a design decision per stage.
- It does not rewrite primitives. Each primitive keeps its `toJSON` / `fromJSON`; `asSaveable` is a one-line bridge.
- It does not provide manual save-slot UI. `saveSlot` / `loadSlot` exist; the stage owns the button.

## See also

- `backend.ts` — SaveBackend + combinators.
- `history.ts` — History strategies.
- `store.ts` — Shard + PersistenceStore + asSaveable.
- `chub.ts` — Chub lifecycle bindings.
- `../README.md` — composition-over-strategy rule.
- `../PATTERNS.md` — recipe rewrites where state is involved.
