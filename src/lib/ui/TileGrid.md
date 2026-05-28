# TileGrid

Wave 2E Batch B · Affordance type: **gestural + command** · Tier 1 leaf.

## Purpose

2D rectangular grid of cells. Backbone for dungeon maps, arcology floor
plans, facility-management room layouts, inventory grids. Each cell may
carry a `verb` name; the grid cross-references it against
`availableVerbs` to determine interactivity. Clicking an interactive
cell invokes `cell.verb` with `{ target: cell.id }`.

## Props

```ts
interface TileGridCell {
  id: string;        // stable id; used as the `target` arg
  x: number;         // column (0-based)
  y: number;         // row (0-based)
  verb?: string;     // verb to invoke on click
  data?: unknown;    // free-form for the renderer
}

interface TileGridProps<C extends TileGridCell> extends IntrospectAware {
  cells: C[];
  width: number;             // grid columns
  height: number;            // grid rows
  renderCell: (cell: C | undefined, interactive: boolean) => ReactElement;
  onCellClick?: (cell: C) => void;   // overrides default verb dispatch
  cellSize?: number;         // px, default 40
  gap?: number;              // px, default 2
  style?: CSSProperties;
}
```

`IntrospectAware`: `availableVerbs?`, `onVerbInvoke?`, `verbFilter?`, `pending?`.

## Usage

```tsx
const verbs = this.availableVerbs();
const cells: MyCell[] = rooms.map(r => ({
  id: r.id, x: r.gridX, y: r.gridY,
  verb: "move",
  data: { name: r.name, occupied: r.workerCount > 0 },
}));

<TileGrid
  cells={cells}
  width={8} height={6}
  availableVerbs={verbs}
  onVerbInvoke={(name, args) => this.invokeVerb(name, args)}
  renderCell={(c, on) => (
    <div style={{ background: on ? "#3a3" : "#222", width: "100%", height: "100%" }}>
      {c?.data.occupied ? "●" : ""}
    </div>
  )}
/>
```

## Affordance type

**Gestural** (cells as spatial targets) + **command** (each interactive
cell IS a verb invocation). The spatial layout carries the targeting
information that a flat `ChoiceList` would have to encode as text.

## Opacity profile

- **Visible:** grid topology, which cells exist, which cells are interactive
  (visual distinction driven by the `interactive` arg to `renderCell`).
- **Hidden:** the verb name (shown only on hover via `title`), args beyond
  `target`, any conditional gating logic. Do **not** render verb names
  directly on cells — that's the dev-surface leak the UX audit flagged.

## Deviations / gaps

None. Built exactly to the design doc spec (`docs/WAVE-2E-DESIGN.md §3.1`).

Drag-and-drop (`onCellDrop`) is noted as a future TODO in the design doc
and is not implemented here.
