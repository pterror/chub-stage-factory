# patterns/form.ts

## Purpose

Assembles a **Form** — a pilotable character-in-its-own-right composed from
Body + Stats + abilities (ActionDef registry) + aesthetics + lore.  A Form is
not a body delta applied to the player; it is a fully autonomous Actor the
player pilots via `puppetPattern`.

Enables **Warframe-shape (#9)**: collect frames, mod them, graft abilities,
switch freely.

## API

```ts
function formPattern(init: FormInit): Form
```

**`FormInit`**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | ✓ | Stable unique identifier |
| `body` | `Body` | ✓ | Body instance for appearance/body-tags |
| `stats` | `Iterable<[StatName,Stat]> \| Record<StatName,Stat>` | ✓ | Numerical capabilities |
| `abilities` | `Iterable<[string,ActionDef]> \| Record<string,ActionDef>` | ✓ | Form's ability set |
| `aesthetics` | `FormAesthetics` | ✓ | displayName, colors, icon |
| `lore` | `FormLore` | — | origin, faction, archetype, proseRegister |

**`Form`** (returned bundle)

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Same as init.id |
| `actor` | `Actor` | The Actor instance (body + stats live here) |
| `abilities` | `Registry<ActionDef>` | Abilities; `graftingPattern` injects into this |
| `aesthetics` | `FormAesthetics` | Display metadata |
| `lore` | `FormLore` | Narrative metadata |

## Example

```ts
import { formPattern } from "lib/patterns/form";
import { Body } from "lib/body";
import { Stat } from "lib/stats";

const excalibur = formPattern({
  id: "excalibur",
  body: new Body(),
  stats: {
    shields: new Stat({ name: "shields", base: 300 }),
    health: new Stat({ name: "health", base: 300 }),
  },
  abilities: {
    "slash-dash": { id: "slash-dash", costs: {}, effects: [] },
    "radial-blind": { id: "radial-blind", costs: {}, effects: [] },
    "exalted-blade": { id: "exalted-blade", costs: { energy: 50 }, effects: [] },
  },
  aesthetics: {
    displayName: "Excalibur",
    description: "The blade of the Orokin Empire.",
    colorPrimary: "#d4a017",
  },
  lore: {
    archetype: "duelist",
    proseRegister: "Narrate this form's combat in a precise, disciplined register.",
  },
});
```

## Gotchas

- `StatName` is exported from `actor.ts`, not `stats.ts`.
- `abilities` on the returned `Form` is a live `Registry<ActionDef>`.
  `graftingPattern` mutates it via `inject` — both hold the same reference.
- The `actor.name` is set to `aesthetics.displayName`. Rename via
  `form.aesthetics.displayName`; `form.actor.name` is the display source.
