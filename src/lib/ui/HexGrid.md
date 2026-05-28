# HexGrid

Wave 2E Batch B · Affordance type: **gestural + command** · Tier 1 leaf.

## Purpose

Hex variant of `TileGrid` for tactical RPG combat grids, Civ-style
strategy maps, and any topology where six-neighbor adjacency matters more
than four. Uses axial (q, r) coordinates. Shares the `IntrospectAware`
contract with `TileGrid` and is intended to share a `hex-math.ts` helper
with a future `HexGrid3D` in Wave 2F.

## Props

```ts
interface HexGridCell {
  id: string;        // stable id; used as the `target` arg
  q: number;         // axial column
  r: number;         // axial row
  verb?: string;     // verb to invoke on click
  data?: unknown;    // free-form for the renderer
}

interface HexGridProps<C extends HexGridCell> extends IntrospectAware {
  cells: C[];
  renderCell: (cell: C | undefined, interactive: boolean) => ReactElement;
  onCellClick?: (cell: C) => void;
  hexSize?: number;              // px center-to-corner, default 32
  orientation?: "pointy" | "flat";   // default "pointy"
  style?: CSSProperties;
}
```

`IntrospectAware`: `availableVerbs?`, `onVerbInvoke?`, `verbFilter?`, `pending?`.

## Usage

```tsx
<HexGrid
  cells={tacticalCells}
  availableVerbs={verbs}
  onVerbInvoke={this.invokeVerb}
  renderCell={(c, on) => <CombatToken cell={c} active={on} />}
/>
```

## Affordance type

**Gestural** (cells as spatial targets) + **command** (each interactive cell
IS a verb invocation). Identical contract to `TileGrid`.

## Opacity profile

Same as `TileGrid`: visible topology and interactivity state; hidden verb
name (hover title only), args beyond `target`, gating logic.

## Deviations / gaps

None. Built exactly to the design doc spec (`docs/WAVE-2E-DESIGN.md §3.2`).

The hex-math functions (axial→pixel, corner generation) are inlined in the
component file. Wave 2F should extract them to `src/lib/ui/hex-math.ts` and
share with `HexGrid3D`.

The `renderCell` receives the cell via `<foreignObject>` (HTML content
inside SVG). The inner box is sized to 85% of the hex's inscribed square
(`hexSize * √3 * 0.85`). If a renderer needs the full hex polygon, it
should render into an SVG `<g>` at the stage level instead.
