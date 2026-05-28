# StatTier — threshold-semantic tier indicator

`StatTier` renders the current qualitative tier label derived from a value
against an ascending set of thresholds, plus a 5-pip strip showing progress
within the current tier.

## Purpose

Ambient display for stats whose player-facing meaning is qualitative —
relationship tiers, corruption bands, morale levels. Pairs with `StatBar`
in `ScoreBoard` for mixed dashboards.

## Props [`src/lib/ui/StatTier.tsx`](./StatTier.tsx)

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | required | Display label ("Trust", "Corruption"). |
| `value` | `number` | required | Current numeric value. |
| `tiers` | `StatTier[]` | required | Tier ladder, ascending by `at`. The component picks the highest tier whose `at ≤ value`. |
| `showProgress` | `boolean` | `true` | Show 5-pip progress within the current tier. |
| `showValue` | `boolean` | `true` | Render the raw numeric value beside the tier label, matching `StatBar`'s `showValue`. The UX audit found that hiding the number entirely caused "what does this mean?" confusion; default shows it. Pass `false` for a purely qualitative readout. |
| `style` | `CSSProperties` | — | Outer container style override. |

### `StatTier` interface

```ts
interface StatTier {
  at: number;      // inclusive lower bound
  label: string;   // player-facing tier label
  color?: string;  // pip fill color
}
```

## Usage

```tsx
<StatTier
  label="Trust"
  value={60}
  tiers={[
    { at: 0,  label: "hostile" },
    { at: 30, label: "wary" },
    { at: 70, label: "warm" },
    { at: 90, label: "friend" },
  ]}
/>
```

## Affordance type

**Ambient.** No interactive surface.
