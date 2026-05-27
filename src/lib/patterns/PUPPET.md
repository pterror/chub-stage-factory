# patterns/puppet.ts

## Purpose

Manages the player's true-self Actor piloting a Form Actor. The true-self
persists memory, inventory, relationships; the Form holds appearance and
abilities.

Enables **Warframe-shape (#9)**: "player IS the Operator, but controls the
Warframe." Composes with `graftingPattern` (which mutates the form's abilities)
without coupling to it.

## API

```ts
function puppetPattern(init: PuppetInit): PuppetBundle
```

**`PuppetInit`**

| Field | Type | Description |
|---|---|---|
| `pilot` | `Actor` | The player's true-self (chatState canon) |
| `formRegistry` | `PlaceholderRegistry<Form>` | From `formCollectionPattern` |

**`PuppetBundle`**

| Member | Description |
|---|---|
| `activePilot` | Always the pilot Actor |
| `activeForm` | Currently equipped Form or null |
| `equip(formId)` | Switch to a form; throws if locked or absent |
| `unequip()` | Revert to bare true-self |
| `effectiveBody()` | Form body when equipped; pilot body otherwise |
| `effectiveAbilities()` | Form abilities when equipped; empty Registry otherwise |

## Example

```ts
import { puppetPattern } from "lib/patterns/puppet";
import { Actor } from "lib/actor";

const operator = new Actor({ id: "operator", name: "Tenno" });
const puppet = puppetPattern({ pilot: operator, formRegistry: collection.registry });

puppet.equip("excalibur");
console.log(puppet.effectiveBody());     // excalibur's body
console.log(puppet.activePilot.name);   // "Tenno" — unchanged

puppet.unequip();
console.log(puppet.effectiveBody());    // operator's body
```

## Gotchas

- `equip` throws if the form is still a placeholder (locked). Check
  `formCollection.locked(id)` before calling.
- `effectiveAbilities()` returns a new empty `Registry<ActionDef>` when
  unequipped — callers should cache or check `activeForm !== null`.
- Pilot inventory / affinity / stats are never touched by this pattern.
  All mutations to those live on `activePilot` directly.
- `graftingPattern` and `puppetPattern` are independent: grafting mutates
  the form's ability registry; puppet decides which form is active. Both
  share the same `formRegistry` reference; no explicit wiring needed.
