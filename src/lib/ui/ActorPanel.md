# ActorPanel — compact actor summary

`ActorPanel` composes [`BodyDiagram`](./BodyDiagram.md),
[`StatBar`](./StatBar.md), [`StatTier`](./StatTier.md), and
[`RegistryGallery`](./RegistryGallery.md) into one bordered card summarising a
single Actor. Tier-2 composer.

## Purpose

Mixed ambient (status) + command (action buttons) surface. The actor identity
(`actorId`) is the binding: stats, body, inventory, and verb targeting all
hang off it. When `showActions` is set, the panel surfaces verbs that target
this actor and invokes them with `{ target: actorId }`.

## Props [`src/lib/ui/ActorPanel.tsx`](./ActorPanel.tsx)

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `actorId` | `string` | required | Stable id; supplied as the `target` arg when invoking verbs. |
| `name` | `string` | required | Panel heading. |
| `description` | `string` | — | One-line description under the heading. |
| `body` | `BodySlot[]` | — | Slots for the `BodyDiagram` subcomponent; omit to hide the silhouette. |
| `stats` | `ActorStat[]` | — | Rendered as `StatBar` rows; a stat with `tiers` also renders a `StatTier`. |
| `inventory` | `RegistryEntry[]` | — | Items shown as a compact `RegistryGallery`. |
| `showActions` | `boolean` | `false` | Render a button row for verbs targeting this actor. |
| `availableVerbs` / `onVerbInvoke` / `verbFilter` / `pending` | `IntrospectAware` | — | Standard introspect-aware contract. |
| `style` | `CSSProperties` | — | Outer container style override. |

### `ActorStat` interface

```ts
interface ActorStat {
  key: string;
  label: string;
  value: number;
  max?: number;
  tiers?: StatTier[];  // when present, also renders a StatTier band
}
```

## Verb targeting

With `showActions`, the panel filters `availableVerbs` to verbs that can
target this actor — those declaring a `target` arg, or carrying
`group: "actor"` — and invokes the chosen one with `{ target: actorId }`.

## Usage

```tsx
<ActorPanel
  actorId="elder-mira"
  name="Elder Mira"
  description="A weathered warden of the inn."
  stats={[
    { key: "hp",    label: "HP",    value: 80, max: 100 },
    { key: "trust", label: "Trust", value: 60, max: 100,
      tiers: [{ at: 30, label: "wary" }, { at: 70, label: "warm" }] },
  ]}
  inventory={mira.inventory.map((i) => ({ id: i.id, label: i.name }))}
  availableVerbs={verbs}
  onVerbInvoke={(n, a) => stage.invokeVerb(n, a)}
  showActions
/>
```

## Affordance type

**Ambient** (status) + **command** (action buttons).
