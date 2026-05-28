# StatBar — labeled value bar

`StatBar` renders a horizontal progress bar with a label, fill color, and
optional numeric readout. Building block for HP, stamina, resource gauges,
and progress meters.

## Purpose

Display-only ambient component. Actions wrap at the containing surface
(`ActorPanel`, `ScoreBoard`). Not introspect-aware.

## Props [`src/lib/ui/StatBar.tsx`](./StatBar.tsx)

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | required | Display label ("HP", "Trust"). |
| `value` | `number` | required | Current value. |
| `max` | `number` | `100` | Maximum value. |
| `color` | `string` | derived | Fill color. When omitted, derived from %: ≥70% green, ≥35% amber, <35% red. |
| `showValue` | `boolean` | `true` | Show `value/max` beside the bar. |
| `variant` | `"labeled" \| "compact"` | `"labeled"` | Labeled shows the label row; compact shrinks the bar. |
| `style` | `CSSProperties` | — | Outer container style override. |

## Usage

```tsx
<StatBar label="HP" value={80} max={100} />
<StatBar label="Trust" value={60} max={100} color="#7c7" />
<StatBar label="Mana" value={40} max={100} variant="compact" />
```

## Affordance type

**Ambient.** No interactive surface; state is the protagonist.
