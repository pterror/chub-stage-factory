# `3d/ui/TileGrid3D` — 3D tile grid on the XZ plane

3D analogue of the (still pending) 2D `TileGrid` UI primitive. Renders a
`rows × cols` matrix of unit-square tiles centered on the world origin.

## Props

- `cells: TileCell<C>[][]` — row-major matrix. Each `TileCell` has `data`,
  optional `color`, `elevation`, `interactive`.
- `tileSize` — world-space edge length. Default 1.
- `gap` — gap between tiles. Default 0.02.
- `renderTile?` — custom mesh per cell. Default is a colored plane.
- `onCellClick?(r, c, cell)`, `onCellHover?(r, c, cell|null)` — pointer events.
- `checkerboard?` — alternate light/dark when `color` is missing.

## Click handling

R3F raycasts through `pointer-events: none` on the canvas wrapper, so the
default `<ThreeScene>` host-DOM-passthrough doesn't break cell clicks.
`e.stopPropagation()` is called so clicks don't bleed through to whatever
else might own the bottom of the scene.

## Layout

Tiles are placed on the XZ plane (Y is up). The grid is centered on the
origin, so `cells[0][0]` is at `(-((cols-1)*stride)/2, 0, -((rows-1)*stride)/2)`.
For non-centered placement, wrap in a `<group position={...}>`.

## Example

```tsx
<ThreeScene>
  <ambientLight intensity={0.5} />
  <directionalLight position={[5, 10, 5]} />
  <TileGrid3D<{ owner: string }>
    cells={buildBoardCells(state)}
    checkerboard
    onCellClick={(r, c, cell) => stage.invokeVerb("place", { r, c })}
  />
</ThreeScene>
```
