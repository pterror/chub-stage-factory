# ScoreBoard — multi-stat dashboard

`ScoreBoard` arranges a list of [`StatBar`](./StatBar.md) and
[`StatTier`](./StatTier.md) instances into a labeled, optionally grouped,
optionally multi-column dashboard. Tier-2 composer: it owns no display
primitive of its own.

## Purpose

Ambient surface for a stage's stat block (pairs with the `score.ts` pattern).
Replaces raw-number dashboard dumps the UX audit flagged. Each entry is
discriminated by `kind` — `"bar"` renders a `StatBar`, `"tier"` renders a
`StatTier`.

## Props [`src/lib/ui/ScoreBoard.tsx`](./ScoreBoard.tsx)

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `entries` | `ScoreEntry[]` | required | The rows to render. |
| `columns` | `number` | `1` | Column count for the entry grid. |
| `grouped` | `boolean` | `false` | Partition entries into sections by `entry.group`; ungrouped entries collapse into a trailing section. |
| `style` | `CSSProperties` | — | Outer container style override. |

### `ScoreEntry` interface

```ts
interface ScoreEntry {
  key: string;
  label: string;
  kind: "bar" | "tier";
  value: number;
  max?: number;        // for kind="bar"
  tiers?: StatTier[];  // for kind="tier"
  group?: string;      // section header when grouped
}
```

## Usage

```tsx
<ScoreBoard
  grouped
  entries={[
    { key: "hp",   label: "HP",   kind: "bar",  value: 80, max: 100, group: "Body" },
    { key: "stam", label: "Stam", kind: "bar",  value: 60, max: 100, group: "Body" },
    { key: "inn",  label: "Inn",  kind: "tier", value: 60, tiers: TIERS, group: "Reputation" },
  ]}
/>
```

## Affordance type

**Ambient.** No interactive surface; composes ambient children.
