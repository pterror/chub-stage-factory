# TimelinePanel — scrollable event feed

`TimelinePanel` renders `TimelineEntry` items as a timestamped scrollable
feed. Entries beyond `maxItems` collapse to "N older events". Optional
per-entry verb buttons enable re-invoke actions (replay, undo).

## Purpose

Ambient (history) + navigational (click to expand details) + optional
command (re-invoke verb). Replaces raw JSON event dumps. Composable with
`ChatLogSidebar` philosophically — renders `Timeline` events, not chat
turns.

## Props [`src/lib/ui/TimelinePanel.tsx`](./TimelinePanel.tsx)

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `entries` | `TimelineEntry[]` | required | Events to render, sorted newest-first automatically. |
| `maxItems` | `number` | `12` | Visible entries (Miller + small buffer). Older events collapse. |
| `groupByKind` | `boolean` | `false` | Collapse runs of same `kind` within a tick. |
| `showTimestamps` | `boolean` | `true` | Show tick/time headers. |
| `availableVerbs` | `VerbDescriptor[]` | — | Bridged mode verb list for re-invoke buttons. |
| `onVerbInvoke` | function | — | Called with `(verb, { target: entry.id })` on re-invoke click. |
| `verbFilter` | function | — | Optional filter applied to `availableVerbs`. |
| `pending` | `boolean` | `false` | Disables all interaction while true. |
| `onEntryClick` | function | — | Override click handler (called instead of verb invocation). |
| `style` | `CSSProperties` | — | Outer container style override. |

### `TimelineEntry` interface

```ts
interface TimelineEntry {
  id: string;
  at: number;        // tick or ms
  kind: string;      // event kind / category
  text: string;      // player-facing summary — NOT raw JSON
  details?: string;  // rich details revealed on expand
  verb?: string;     // optional re-invoke verb
}
```

## Usage

```tsx
<TimelinePanel
  entries={timeline.recent(20).map(toUiEntry)}
  groupByKind
  availableVerbs={verbs}
  onVerbInvoke={(n, a) => stage.invokeVerb(n, a)}
/>
```

## Affordance type

**Ambient** (history display) + **navigational** (expand details) +
optional **command** (re-invoke).
