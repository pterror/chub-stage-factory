# BodyDiagram — actor body slot silhouette

`BodyDiagram` renders an actor's body slots as either a humanoid silhouette
(ASCII figure + slot list) or a vertical list fallback for non-humanoid
bodies. Each slot shows its state as a colored border and an optional
player-facing detail string. Slot clicks invoke a verb or call `onSlotClick`.

## Purpose

Ambient (state display) + gestural (slot click). Replaces raw tag-string
renders ("furred, prehensile-mild, tail-cat") that the UX audit flagged as
dev-surface leaks. The stage author converts raw `Body` tags to
human-readable `detail` strings; this component only renders what it is given.

## Props [`src/lib/ui/BodyDiagram.tsx`](./BodyDiagram.tsx)

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `slots` | `BodySlot[]` | required | Slots to render. |
| `layout` | `"humanoid" \| "list"` | `"humanoid"` | Humanoid positions known slots on a silhouette; list is the fallback. |
| `availableVerbs` | `VerbDescriptor[]` | — | Bridged mode verb list for slot interactions. |
| `onVerbInvoke` | function | — | Called with `(verb, { target: slot.id })` on slot click. |
| `verbFilter` | function | — | Optional filter applied to `availableVerbs`. |
| `pending` | `boolean` | `false` | Disables all interaction while true. |
| `onSlotClick` | function | — | Override click handler (called instead of verb invocation). |
| `style` | `CSSProperties` | — | Outer container style override. |

### `BodySlot` interface

```ts
interface BodySlot {
  id: string;                                           // "head", "torso", "tail", …
  label: string;                                        // display name
  state?: "empty" | "natural" | "modified" | "equipped" | "missing";
  detail?: string;   // player-facing description — NOT raw tags
  verb?: string;     // verb to invoke on click (e.g. "examine", "unequip")
}
```

### State → color mapping

| State | Color |
|-------|-------|
| `natural` | green `#6a9` |
| `equipped` | blue `#58c` |
| `modified` | amber `#b86` |
| `empty` | dark grey `#444` |
| `missing` | dark red `#644` |

### Humanoid slot order

`head → neck → torso → arms → hands → waist → legs → feet → tail`, then
any unrecognised slots. Id matching is case-insensitive.

## Usage

```tsx
<BodyDiagram
  slots={[
    { id: "head", label: "Head", state: "natural" },
    { id: "tail", label: "Tail", state: "modified",
      detail: "long, furred, prehensile", verb: "examine" },
  ]}
  availableVerbs={verbs}
  onVerbInvoke={(n, a) => stage.invokeVerb(n, a)}
/>
```

## Affordance type

**Ambient** (slot state display) + **gestural** (slot click to inspect/act).
