# Registry — id→value catalog primitive

`Registry<T>` replaces the `Record<Id, T>` literals that show up across
every recipe (TFS, MODS, EFFECT_DEFS, ITEM_DEFS, ACTION_DEFS). Static
usage is zero-behavioral-change: `register`, `get`, `require`, `has`,
`keys`/`values`/`entries`, `filter`, `map`. The win is dynamic usage —
when the catalog grows mid-chat — and that's where `PlaceholderRegistry`
earns its keep.

## Static catalog

```ts
import { Registry } from "./lib/registry";
import type { TransformationDef } from "./lib/transformation";

const TFS = new Registry<TransformationDef>()
  .register("cat_tail", { id: "cat_tail", /* ... */ } as TransformationDef)
  .register("horns",    { id: "horns",    /* ... */ } as TransformationDef);

const def = TFS.require("cat_tail");
const all = TFS.values();
```

Static registries are constants. They don't need to be Shards. Treat
them like `const TFS: Record<...> = {...}` with a nicer surface.

## Dynamic catalog (Shard)

When a registry grows during play — generated names, invented items,
LLM-authored content — wrap it in a Shard so it survives swipe/restart.
Pick the persistence paradigm the way you would for any other stateful
primitive (see `persistence/README.md`):

```ts
import { Registry } from "./lib/registry";
import { shardOf } from "./lib/persistence";

invented = new Registry<ItemDef>();

// In your store:
invented: shardOf(
  "invented", this.invented, (d) => Registry.fromJSON<ItemDef>(d),
  this.layers.chatStateBackend, forbidBranching(snapshotHistory()),
),
```

`chatStateBackend + forbidBranching` is the right default for canon
invention: once the LLM names an item, it stays named across the chat
even if the player swipes the message that introduced it. Use
`messageStateBackend + chubTreeHistory()` if invented entries should
diverge per branch.

## Placeholder swap (PlaceholderRegistry)

The pattern is: an action requires a value that doesn't exist yet; you
register a placeholder, kick off generation (LLM, image gen, lookup),
and replace it when the generation returns. Code that needed the value
synchronously calls `require`; code that can wait calls `waitFor`.

```ts
import { PlaceholderRegistry } from "./lib/registry";

cyberware = new PlaceholderRegistry<CyberwareDef>();

async inventCyberware(slot: string, now: number): Promise<CyberwareDef> {
  const id = `cw_${now}`;
  this.cyberware.registerPlaceholder(id, {
    id, slot, displayName: "(generating...)", grantsTags: [],
  } as CyberwareDef);

  // Fire and forget; the waiter picks up the real value.
  this.generateCyberware(id, slot);

  return this.cyberware.waitFor(id, 30_000);
}

async generateCyberware(id: string, slot: string) {
  const text = await this.generator.textGen({ prompt: /* ... */ });
  const def = parseCyberwareFromLlm(text, id, slot);
  this.cyberware.replace(id, def);
}
```

`waitFor` resolves immediately if the id is already real (so callers
can be uniform), and rejects on `timeoutMs` if supplied. The
`isPlaceholder(id)` flag lets observation sources flag still-generating
entries to the LLM — useful when the prose register wants the model to
narrate uncertainty ("Maven's still rummaging for the part...").

`toJSON` is the flat record; placeholder-ness is runtime-only. After
reload, the stage re-registers placeholders for any ids it knows are
still under construction. In practice this rarely matters: if
generation was in flight when the chat closed, the stage either retries
or accepts the placeholder text as canon.
