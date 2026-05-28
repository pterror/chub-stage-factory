# RegistryGallery — paged card gallery for Registry entries

`RegistryGallery` renders a paginated grid of cards — one per
`RegistryEntry`. Each card shows art, label, caption, and tag chips.
Clicking an available card invokes a verb or calls `onEntryClick`. Locked
entries render as silhouettes.

## Purpose

Command + navigational affordance. Used for forms, items, abilities, room
types, recipes — any catalog the stage wants to surface as a browsable
gallery. Also used by `ActorPanel` for inventory.

## Props [`src/lib/ui/RegistryGallery.tsx`](./RegistryGallery.tsx)

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `entries` | `RegistryEntry[]` | required | Cards to render. |
| `columns` | `number` | `3` | Grid columns. |
| `maxItems` | `number` | `9` | Entries per page (3×3). Overflow paginates. |
| `availableVerbs` | `VerbDescriptor[]` | — | Bridged mode: verbs to check entry verbs against. |
| `onVerbInvoke` | function | — | Called with `(verb, { target: entry.id })` on card click. |
| `verbFilter` | function | — | Optional filter applied to `availableVerbs`. |
| `pending` | `boolean` | `false` | Disables all interaction while true. |
| `onEntryClick` | function | — | Override: called instead of verb invocation. |
| `style` | `CSSProperties` | — | Outer container style override. |

### `RegistryEntry` interface

```ts
interface RegistryEntry {
  id: string;
  label: string;
  caption?: string;     // short subtitle
  art?: string;         // image URL or emoji glyph
  tags?: string[];      // chips shown under label
  verb?: string;        // verb to invoke on click
  available?: boolean;  // false → silhouette + no interaction
}
```

## Usage

```tsx
<RegistryGallery
  entries={forms.values().map(f => ({
    id: f.id, label: f.name, caption: f.tagline,
    art: f.glyph, tags: f.archetype, verb: "equip-form",
    available: collection.has(f.id),
  }))}
  availableVerbs={verbs}
  onVerbInvoke={(n, a) => stage.invokeVerb(n, a)}
/>
```

## Affordance type

**Command** (equip / use) + **navigational** (browse pages).
