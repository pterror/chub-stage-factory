# patterns/form-collection.ts

## Purpose

Wraps a `PlaceholderRegistry<Form>` with unlock progression. The catalog starts
with locked (placeholder) Forms; gameplay events resolve them to real Forms.

Enables **Warframe-shape (#9)**: "defeat the Ropalolyst to unlock Wisp."

## API

```ts
function formCollectionPattern(init?: FormCollectionInit): FormCollection
```

**`FormCollectionInit`**

| Field | Type | Description |
|---|---|---|
| `forms` | `Iterable<Form>` | Pre-unlocked Forms (player starts with these) |
| `placeholders` | `Iterable<string>` | IDs for locked forms (not yet acquired) |

**`FormCollection`**

| Member | Description |
|---|---|
| `registry` | `PlaceholderRegistry<Form>` — pass directly to `graftingPattern` |
| `unlock(id, form)` | Resolve a placeholder to a real Form |
| `locked(id)` | True if still a placeholder |
| `unlocked()` | All resolved Forms |
| `all()` | All registered ids (locked + unlocked) |
| `get(id)` | Return real Form or undefined if locked/absent |

## Example

```ts
import { formCollectionPattern } from "lib/patterns/form-collection";
import { graftingPattern } from "lib/patterns/grafting";

const collection = formCollectionPattern({
  forms: [excalibur],                    // starts unlocked
  placeholders: ["wisp", "protea"],      // locked until acquired
});

// Later, when player defeats the boss:
collection.unlock("wisp", wispForm);

// Pass registry to grafting:
const grafting = graftingPattern({ forms: collection.registry, learnedLibrary });
```

## Gotchas

- `get(id)` returns `undefined` for locked ids — always check `locked(id)`
  before calling `get`.
- `unlock` is also a plain registration if the id was never a placeholder.
  Registering a new Form this way is safe.
- The sentinel placeholder objects have `actor: null` and `abilities: null`.
  Never read fields from a locked Form; use `get()` which returns undefined.
