# Wave 2E — UI Component Design Pass

Status: design only. No code in this pass.
Date: 2026-05-27.
Author context: post-UX-audit (`docs/UX-AUDIT-2026-05-27.md`),
post-`StageIntrospect` ship (commit `bec4c8a`,
`src/lib/introspect/{types,index}.ts`, `INTROSPECT.md`).

This doc specifies 14 React component primitives that land under
`src/lib/ui/*.tsx`. Each is **introspect-aware from the start**: when a
stage implements `StageIntrospect`, the component can derive its
affordances from `availableVerbs()` and route clicks through
`invokeVerb()`. When a stage does not, the component still works in a
plain "render what you're given" mode. This dual mode is the design's
load-bearing decision.

Existing Wave 2E shell components (`WorldStatePanel`, `ActionSurface`,
`ScenePane`, `ChatLogSidebar`, `FreeformInput`, `CompositionLayout`,
`voronoi-influence-map`) are **not** redesigned here; the 14 below are
additive and named to compose with them.

---

## 1. Goals + non-goals

### Goals

1. **Close the orphan-button gap end-to-end.** The audit named the
   single largest UX failure in the repo: `ActionSurface` in
   `world-primary` renders verb buttons whose `onClick` handlers are
   no-ops (UX-AUDIT §3.8 / Phase 5 Blocker #1). Every Wave 2E component
   that surfaces actions MUST route them through `StageIntrospect` when
   one is available — there is no path to "render a button that does
   nothing" in the new components.
2. **Cover the affordance-type spectrum.** The audit found that the 8
   shipped examples render almost exclusively *ambient* affordances —
   status displays with no actionable surface (UX-AUDIT cross-cutting
   "affordance-type imbalance"). The 14 components in this wave
   collectively cover: **command** (ChoiceList, ModalPicker, SlotPicker,
   FormBuilder), **gestural** (TileGrid/HexGrid cell drag/select),
   **ambient** (StatBar, StatTier, ScoreBoard, BodyDiagram), **
   navigational** (GraphView, TimelinePanel, RegistryGallery), and
   **data-entry** (FormBuilder, SlotPicker).
3. **Be Miller-aware by default.** Every list/grid component takes an
   optional `maxItems` prop with a sensible default (5–9 depending on
   component) and a documented strategy for the overflow case (paginate,
   virtualize, summary-with-expand). The default behavior is
   *filtering*, not *prioritizing* (UX-AUDIT framework lens).
4. **Match existing repo conventions.** Inline styles, `ReactElement`
   return type, doc-comment `WHAT / WHY / SHAPE` header, props named
   `{Name}Props`, every prop documented in the interface. No new
   styling system, no CSS modules, no theme provider.
5. **Compose, don't subsume.** Each component is independently usable
   AND composes with the existing shell. `ActorPanel` composes
   `BodyDiagram` + `StatBar` + `RegistryGallery` (for inventory).
   `ScoreBoard` composes `StatBar` + `StatTier`. No component is a
   monolith.

### Non-goals

- **A theme system / styling framework.** Inline styles, repo
  convention. Authors override via `style?: CSSProperties`.
- **Responsive breakpoints.** Components ship sane defaults; responsive
  collapse is the host layout's job (UX-AUDIT 3.8: world-primary's
  3-column layout is the place to fix narrow-viewport behavior).
- **Wave 2F primitives.** `TileGrid3D` / `HexGrid3D` / `GraphView3D`
  ship under `src/lib/3d/ui/` in Wave 2F, not here.
- **A redesign of the existing shell** (`ActionSurface`, etc.). Those
  ship as-is; the new components plug in alongside them.
- **The orphan-button anti-pattern.** Every action-surfacing component
  in this wave either receives an `onVerbInvoke` callback OR derives
  from `availableVerbs()` and calls `invokeVerb()` directly. There is no
  "render a button that does nothing" path. This is the explicit thing
  Wave 2E is designed to prevent.

---

## 2. The introspect-aware contract

This is the most important deliverable of the design pass. Every
component below that surfaces stage actions accepts the **same** prop
shape:

```ts
import type {
  VerbDescriptor,
  InvocationResult,
} from "../introspect";

/** Common shape for components that surface stage verbs.
 *  Mix in via interface extension. */
export interface IntrospectAware {
  /** Verbs to surface. When omitted and `stage` is provided, the
   *  component will call `stage.availableVerbs()` itself. */
  availableVerbs?: VerbDescriptor[];

  /** Called when the user picks a verb. When omitted and `stage` is
   *  provided, the component will call `stage.invokeVerb` itself. */
  onVerbInvoke?: (name: string, args?: Record<string, unknown>) =>
    Promise<InvocationResult> | void;

  /** Optional filter applied to `availableVerbs` before render.
   *  Used by group-scoped components (e.g. a movement-only TileGrid
   *  filters to `v.group === "move"`). */
  verbFilter?: (v: VerbDescriptor) => boolean;

  /** Disabled state while a previous invocation is in flight.
   *  Component handles this by greying buttons; stage author may
   *  override by passing explicit `enabled` per-verb. */
  pending?: boolean;
}
```

### Three usage modes

Every introspect-aware component supports three modes, ordered by
preference:

1. **Plain mode.** Stage passes its own action list and click handler
   (`verbs`, `onClick` — the legacy shape of `ActionSurface`). The
   component does not touch `StageIntrospect`. Backwards-compatible with
   any stage that doesn't implement the interface.
2. **Bridged mode.** Stage passes `availableVerbs` + `onVerbInvoke`
   explicitly. The component renders the verbs and calls the callback.
   This is the **recommended** mode — the stage owns when to query
   `availableVerbs()` (typically per render) and the component stays
   pure-render.
3. **Wired mode.** Stage passes `stage: StageIntrospect` and the
   component queries `availableVerbs()` itself and calls `invokeVerb`
   directly. Convenience mode for stages with one big component; the
   tradeoff is loss of fine-grained control over when verbs are
   re-queried.

Bridged mode is the **default in the per-component examples below**
because it matches `examples/world-primary/Stage.tsx`'s existing
pattern: the stage derives verbs once per render, hands them to the
component, and handles invocation. Wired mode is offered as a
convenience.

### Per-verb hint pattern

Components that map verbs to spatial cells (TileGrid, HexGrid,
GraphView, BodyDiagram, ScoreBoard) need to know **which verb belongs
to which cell/node**. The library convention is the `group` and
`description` fields on `VerbDescriptor` plus an optional `target` arg:

- `group` carries the affordance category ("move", "talk", "use",
  "examine"). Components filter by group.
- A verb that targets a specific entity uses `args: [{ name: "target",
  type: "string", required: true }]` and the component supplies the
  cell's id as the `target` value at invoke time.

Example: a movement-aware `TileGrid` filters `availableVerbs` to
`group === "move"`, then for cell `{id: "north"}` calls
`onVerbInvoke("go", { target: "north" })`. The stage's `invokeVerb`
implementation handles the rest.

### Why not just thread `stage: StageIntrospect` through every prop?

Tried as a thought experiment and rejected: it leaks the stage's full
verb namespace into every component, defeats `verbFilter`, and makes
testing each component require a full mock stage. Bridged mode + the
explicit `availableVerbs` / `onVerbInvoke` props is one level of
indirection cheaper.

---

## 3. Per-component specs

Each section follows: purpose, prop interface, visual mock,
stage-author usage, player-facing affordance type, opacity profile,
dependencies.

### 3.1 TileGrid<C>

**Purpose.** 2D grid of cells; cell renderer + click/hover callbacks.
Backbone for FC arcology layout, dungeon maps, inventory grid, station
floor plans, facility-management room layouts.

**Prop interface.**

```ts
export interface TileGridCell {
  id: string;
  x: number;
  y: number;
  /** Verb name (in stage's namespace) that this cell triggers on click,
   *  if any. Component composes this with availableVerbs to decide
   *  whether the cell is interactive. */
  verb?: string;
  /** Free-form data the cell renderer can use. */
  data?: unknown;
}

export interface TileGridProps<C extends TileGridCell> extends IntrospectAware {
  cells: C[];
  width: number;                                  // grid columns
  height: number;                                 // grid rows
  /** Cell renderer. Receives the cell and whether it's currently
   *  interactive (verb is in availableVerbs AND enabled). */
  renderCell: (cell: C | undefined, interactive: boolean) => ReactElement;
  /** Override cell click. Defaults to invoking `cell.verb` with
   *  `{ target: cell.id }`. */
  onCellClick?: (cell: C) => void;
  cellSize?: number;                              // px, default 40
  gap?: number;                                   // px, default 2
  style?: CSSProperties;
}
```

**Visual mock.**

```
┌──┬──┬──┬──┬──┐
│  │██│  │  │  │   ██ = interactive cell (verb available)
├──┼──┼──┼──┼──┤   ░░ = visible but non-interactive
│██│░░│██│  │  │   ▓▓ = player position (renderer's choice)
├──┼──┼──┼──┼──┤
│  │██│▓▓│██│  │
├──┼──┼──┼──┼──┤
│  │  │██│░░│██│
└──┴──┴──┴──┴──┘
```

**Stage-author usage.**

```tsx
const verbs = this.availableVerbs();        // StageIntrospect
const cells: MyCell[] = this.rooms.map(r => ({
  id: r.id, x: r.x, y: r.y,
  verb: "move",
  data: { name: r.name, occupied: r.workerCount > 0 },
}));
<TileGrid
  cells={cells}
  width={8} height={6}
  availableVerbs={verbs}
  onVerbInvoke={(n, a) => this.invokeVerb(n, a)}
  renderCell={(c, on) => (
    <div style={{ background: on ? "#3a3" : "#222" }}>
      {c?.data.occupied ? "●" : ""}
    </div>
  )}
/>
```

**Player-facing affordance type.** Gestural (cells as spatial targets)
+ command (each interactive cell IS a verb invocation). Mixed-type
surface; the spatial layout carries the targeting info that a flat
ChoiceList would have to encode as text.

**Opacity profile.** *Visible:* grid topology, which cells exist,
which are interactive (visual distinction). *Hidden state:* the verb
name (only shown on hover as tooltip via `cell.verb`); the args
beyond `target`; any conditional gating logic. Components should NOT
render verb names directly on cells — that's the dev surface leak the
audit flagged in tits-body and cyber-slots.

**Dependencies.** None on other Wave 2E components. Uses
`IntrospectAware`.

---

### 3.2 HexGrid<C>

**Purpose.** Hex variant of TileGrid for tactical RPG combat grids,
Civ-style strategy maps, and any topology where six-neighbor adjacency
matters more than four.

**Prop interface.**

```ts
export interface HexGridCell {
  id: string;
  q: number;                                      // axial coords
  r: number;
  verb?: string;
  data?: unknown;
}

export interface HexGridProps<C extends HexGridCell> extends IntrospectAware {
  cells: C[];
  renderCell: (cell: C | undefined, interactive: boolean) => ReactElement;
  onCellClick?: (cell: C) => void;
  hexSize?: number;                               // px, default 32
  orientation?: "pointy" | "flat";                // default "pointy"
  style?: CSSProperties;
}
```

**Visual mock.**

```
   ⬡ ⬡ ⬡ ⬡
  ⬡ ⬢ ⬢ ⬡ ⬡        ⬢ = interactive
   ⬡ ⬢ ▲ ⬢ ⬡       ▲ = player
  ⬡ ⬢ ⬢ ⬡ ⬡
   ⬡ ⬡ ⬡ ⬡
```

**Stage-author usage.** Identical shape to TileGrid; axial coords
instead of x/y. Sketch:

```tsx
<HexGrid
  cells={tacticalCells}
  availableVerbs={verbs}
  onVerbInvoke={this.invokeVerb}
  renderCell={(c, on) => <CombatToken cell={c} active={on} />}
/>
```

**Player-facing affordance type.** Gestural + command (same as
TileGrid).

**Opacity profile.** Same as TileGrid.

**Dependencies.** None on other 2E components. Shares
`IntrospectAware`. Likely shares a small `hex-math.ts` helper file with
any future Wave 2F `HexGrid3D`.

---

### 3.3 GraphView<N, E>

**Purpose.** Nodes + edges, force-directed or fixed layout. For
world.ts room graphs (rooms as nodes, exits as edges), faction-relation
graphs, dialogue trees, family/lineage trees (composed with
`lineagePattern`).

**Prop interface.**

```ts
export interface GraphNode {
  id: string;
  label?: string;
  x?: number;                                     // optional fixed layout
  y?: number;
  verb?: string;                                  // verb to invoke on node click
  data?: unknown;
}

export interface GraphEdge {
  id: string;
  source: string;                                 // node id
  target: string;
  label?: string;
  verb?: string;                                  // verb to invoke on edge click
  directed?: boolean;
}

export interface GraphViewProps<N extends GraphNode, E extends GraphEdge>
  extends IntrospectAware {
  nodes: N[];
  edges: E[];
  layout?: "force" | "fixed";                     // default "force"
  renderNode?: (node: N, interactive: boolean) => ReactElement;
  renderEdge?: (edge: E, interactive: boolean) => ReactElement;
  onNodeClick?: (node: N) => void;
  onEdgeClick?: (edge: E) => void;
  width?: number;                                 // default 400
  height?: number;                                // default 300
  style?: CSSProperties;
}
```

**Visual mock.**

```
   [Inn]─────[Square]──────[Smithy]
     │           │              │
     │           │              │
   [Cellar]   [Well]─────────[Forge]
                  │
                  │
              [Aquifer]
```

Force-directed by default; fixed if all nodes have x/y.

**Stage-author usage.**

```tsx
<GraphView
  nodes={Object.values(world.rooms).map(r => ({
    id: r.id, label: r.name, verb: "go",
  }))}
  edges={world.exits.map(e => ({
    id: `${e.from}-${e.to}`, source: e.from, target: e.to,
    directed: e.oneWay,
  }))}
  availableVerbs={verbs}
  onVerbInvoke={this.invokeVerb}
/>
```

**Player-facing affordance type.** Navigational + gestural (zoom/pan
if implemented) + command (click-to-invoke).

**Opacity profile.** *Visible:* graph topology, labels, current node
(if `data.current === true`). *Hidden:* edge weights, node metadata
beyond label, verb args. Underlying force simulation parameters
(spring, charge) are configurable but not surfaced to players.

**Dependencies.** No other 2E components. Probably depends on
`d3-force` (already a dep via `voronoi-influence-map.tsx`'s
`d3-weighted-voronoi`) — confirm in implementation; if it brings a
heavy transitive, ship a small from-scratch force impl instead (the
graphs we render are small — ≤30 nodes typically).

---

### 3.4 ActorPanel

**Purpose.** Compact summary of an Actor: name, body silhouette, key
stats, inventory summary, available verbs targeting this actor.

**Prop interface.**

```ts
export interface ActorPanelProps extends IntrospectAware {
  actorId: string;
  name: string;
  description?: string;
  /** Body slots / tags for the BodyDiagram subcomponent. */
  body?: BodyDiagramProps["slots"];
  /** Stats to surface — passed straight to StatBar children. */
  stats?: Array<{ key: string; label: string; value: number;
                  max?: number; tiers?: StatTierProps["tiers"] }>;
  /** Inventory items to show as a small registry gallery. */
  inventory?: RegistryGalleryProps["entries"];
  /** When set, the panel filters availableVerbs to those targeting
   *  this actor (via args.target === actorId). */
  showActions?: boolean;
  style?: CSSProperties;
}
```

**Visual mock.**

```
┌─ Elder Mira ─────────────────────────┐
│ A weathered warden of the inn.       │
│                                       │
│   ┌─ ▽ ─┐    HP    ████████░░ 80/100 │
│   │  ║  │    Trust ██████░░░░ 60     │
│   └─ ⋀ ─┘                            │
│                                       │
│  Inventory: brass key · ledger       │
│  [Talk]  [Examine]  [Give item ▾]    │
└───────────────────────────────────────┘
```

**Stage-author usage.**

```tsx
<ActorPanel
  actorId="elder-mira"
  name="Elder Mira"
  description="A weathered warden of the inn."
  stats={[
    { key: "hp", label: "HP", value: 80, max: 100 },
    { key: "trust", label: "Trust", value: 60, max: 100,
      tiers: [{at: 30, label: "wary"}, {at: 70, label: "warm"}] },
  ]}
  inventory={mira.inventory.map(i => ({ id: i.id, label: i.name }))}
  availableVerbs={this.availableVerbs()}
  onVerbInvoke={(n, a) => this.invokeVerb(n, a)}
  showActions
/>
```

**Player-facing affordance type.** Ambient (status) + command
(action buttons). Mixed surface; the actor identity is the binding.

**Opacity profile.** *Visible:* name, description, stat values
(human-readable), available actions. *Hidden:* internal actor id (only
used as verb arg), full body tag list (only the renderable summary),
relationship scores beyond what's surfaced, behavior tags.

**Dependencies.** Composes `BodyDiagram`, `StatBar`, `StatTier`,
`RegistryGallery`. **Build order: ships after those four.**

---

### 3.5 BodyDiagram

**Purpose.** Visual representation of an actor's body slots — a
silhouette with per-slot annotations. Pairs with `body.ts`. Replaces
the raw-tag-string render that the audit flagged in `tits-body`
(`furred, prehensile-mild, tail-cat` is dev surface; this component
makes it player-facing).

**Prop interface.**

```ts
export interface BodySlot {
  id: string;                                     // "head", "torso", "tail", …
  label: string;                                  // display name
  /** Display state: empty, equipped, transformed, etc. The component
   *  maps each to a visual style. */
  state?: "empty" | "natural" | "modified" | "equipped" | "missing";
  /** Player-facing description. NOT raw tags. */
  detail?: string;
  /** Verb to invoke on slot click (e.g. "examine" or "unequip"). */
  verb?: string;
}

export interface BodyDiagramProps extends IntrospectAware {
  slots: BodySlot[];
  /** Layout preset. "humanoid" lays slots on a person silhouette;
   *  "list" renders a vertical list (fallback for non-humanoid). */
  layout?: "humanoid" | "list";
  onSlotClick?: (slot: BodySlot) => void;
  style?: CSSProperties;
}
```

**Visual mock.**

```
     ◉  head: natural
    ╱║╲ arms: natural
    ╱║╲ torso: lean
     ║   waist: natural
    ╱ ╲  legs: natural
    ▽ ▽  tail: long, furred, prehensile
```

(Click a slot → `verb` fires; e.g. `examine` with `{ target: "tail" }`.)

**Stage-author usage.**

```tsx
<BodyDiagram
  slots={[
    { id: "head", label: "Head", state: "natural" },
    { id: "tail", label: "Tail", state: "modified",
      detail: "long, furred, prehensile", verb: "examine" },
  ]}
  availableVerbs={verbs}
  onVerbInvoke={this.invokeVerb}
/>
```

**Player-facing affordance type.** Ambient (state display) + gestural
(slot click).

**Opacity profile.** *Visible:* slot list, human-readable detail,
state-as-color. *Hidden:* raw slot tags, trajectory phase numbers,
effect magnitudes. The stage author is responsible for rendering tags
into `detail` — the audit's point exactly: don't leak the dev surface.

**Dependencies.** None on other 2E components.

---

### 3.6 TimelinePanel

**Purpose.** Render `Timeline` events as a scrollable feed with
summarization toggles and click-through to event details.

**Prop interface.**

```ts
export interface TimelineEntry {
  id: string;
  at: number;                                     // tick or ms
  kind: string;
  /** Player-facing summary. NOT raw JSON. */
  text: string;
  /** Optional rich details (revealed on expand). */
  details?: string;
  /** Optional verb to re-invoke this event ("replay", "undo", …). */
  verb?: string;
}

export interface TimelinePanelProps extends IntrospectAware {
  entries: TimelineEntry[];
  maxItems?: number;                              // default 12; Miller + small buffer
  groupByKind?: boolean;                          // collapse runs of same kind
  showTimestamps?: boolean;                       // default true
  onEntryClick?: (entry: TimelineEntry) => void;
  style?: CSSProperties;
}
```

**Visual mock.**

```
─── Tick 14 ─────────────────────────────
  ◆ You arrived at The Ember Inn.
  ● Elder Mira nodded a greeting.
─── Tick 12 ─────────────────────────────
  ◇ You took the map fragment.
  ⚐ A flag rose: found-map.                [↻]
─── Tick 9 ──────────────────────────────
  3 minor events ▾
─────────────────────────────────────────
```

**Stage-author usage.**

```tsx
<TimelinePanel
  entries={timeline.recent(20).map(toUiEntry)}
  groupByKind
  availableVerbs={verbs}
  onVerbInvoke={this.invokeVerb}
/>
```

**Player-facing affordance type.** Ambient (history) + navigational
(click to focus) + optional command (re-invoke).

**Opacity profile.** *Visible:* event text, time, kind. *Hidden:*
internal event payload, timeline shard structure, full event log
beyond `maxItems`. Older events collapse into "N minor events" — the
filtering, not prioritizing, principle.

**Dependencies.** None on other 2E components. Composes with
existing `ChatLogSidebar` philosophically but renders Timeline events,
not chat turns.

---

### 3.7 RegistryGallery

**Purpose.** Render `Registry` entries as a card gallery — forms,
items, abilities, room types, recipes. Each card is clickable and can
invoke a verb targeting the entry.

**Prop interface.**

```ts
export interface RegistryEntry {
  id: string;
  label: string;
  /** Short subtitle / tagline. */
  caption?: string;
  /** Image URL or emoji glyph. */
  art?: string;
  /** Tags / chips shown under the label. */
  tags?: string[];
  /** Verb to invoke on card click. */
  verb?: string;
  /** Whether the entry is currently usable (e.g. unlocked). */
  available?: boolean;
}

export interface RegistryGalleryProps extends IntrospectAware {
  entries: RegistryEntry[];
  columns?: number;                               // default 3
  maxItems?: number;                              // default 9 (3×3); paginate beyond
  onEntryClick?: (entry: RegistryEntry) => void;
  style?: CSSProperties;
}
```

**Visual mock.**

```
┌─────────┐ ┌─────────┐ ┌─────────┐
│   🜍    │ │   ⚔     │ │   ?     │
│ Tinct.  │ │ Blade   │ │ Locked  │
│ of Calm │ │ of Mira │ │         │
│[soothe] │ │[melee]  │ │         │
└─────────┘ └─────────┘ └─────────┘
   1 of 4 pages   ◀ ●○○○ ▶
```

**Stage-author usage.**

```tsx
<RegistryGallery
  entries={forms.values().map(f => ({
    id: f.id, label: f.name, caption: f.tagline,
    art: f.glyph, tags: f.archetype, verb: "equip-form",
    available: collection.has(f.id),
  }))}
  availableVerbs={verbs}
  onVerbInvoke={this.invokeVerb}
/>
```

**Player-facing affordance type.** Command (equip / use) +
navigational (browse).

**Opacity profile.** *Visible:* labels, captions, art, availability.
*Hidden:* full entry metadata, unlock conditions (the verb's
`enabled` flag carries this; clicking a disabled entry should not
reveal the underlying predicate). Locked entries shown with
silhouette + count toward "what's missing" but no spoilers.

**Dependencies.** None on other 2E components. Used by `ActorPanel`
for inventory.

---

### 3.8 StatBar

**Purpose.** A labeled value bar with optional max. Building block for
HP, stamina, resource gauges, progress meters.

**Prop interface.**

```ts
export interface StatBarProps {
  label: string;
  value: number;
  max?: number;                                   // when omitted, treated as 0..100
  /** Color override for the fill. Default: derive from %. */
  color?: string;
  /** When set, render the numeric value beside the bar. Default true. */
  showValue?: boolean;
  /** Compact vs. labeled. Default "labeled". */
  variant?: "labeled" | "compact";
  style?: CSSProperties;
}
```

Note: StatBar is **not** introspect-aware. It's a display primitive;
its action wrapping happens at the surface that contains it
(`ActorPanel`, `ScoreBoard`).

**Visual mock.**

```
HP     ████████░░  80/100
Mana   ████░░░░░░  40/100
Stam   ██████████  100/100   (full)
```

**Stage-author usage.**

```tsx
<StatBar label="HP" value={actor.hp} max={actor.maxHp} />
<StatBar label="Trust" value={mira.trust} max={100} color="#7c7" />
```

**Player-facing affordance type.** Ambient.

**Opacity profile.** *Visible:* label, current, max. *Hidden:* the
underlying stat shard structure.

**Dependencies.** None.

---

### 3.9 StatTier

**Purpose.** Tier indicator for stats with threshold semantics:
"wary / neutral / warm / friend / devoted." Renders the current tier
label + a position indicator within the tier.

**Prop interface.**

```ts
export interface StatTier {
  at: number;                                     // threshold (inclusive)
  label: string;
  color?: string;
}

export interface StatTierProps {
  label: string;
  value: number;
  tiers: StatTier[];                              // ascending by `at`
  /** Show progress within current tier. Default true. */
  showProgress?: boolean;
  style?: CSSProperties;
}
```

**Visual mock.**

```
Trust:  ▰▰▰▱▱ warm        (60 of 70 to "friend")
Corr.:  ▰▰▰▰▱ mostly-pure (20 of 25 to "tainted")
```

**Stage-author usage.**

```tsx
<StatTier
  label="Trust"
  value={mira.trust}
  tiers={[
    { at: 0,  label: "hostile" },
    { at: 30, label: "wary" },
    { at: 70, label: "warm" },
    { at: 90, label: "friend" },
  ]}
/>
```

**Player-facing affordance type.** Ambient.

**Opacity profile.** *Visible:* tier name, position within tier.
*Hidden:* exact numeric value (some stages may want to hide this;
default shows it because the audit found that *hiding* numeric data
created "what does 0.83 mean?" confusion in `inventory`).

**Dependencies.** None. Composed by `ActorPanel` and `ScoreBoard`.

---

### 3.10 ScoreBoard

**Purpose.** Multi-stat dashboard: a labeled grid/list of `StatBar` +
`StatTier` instances with optional grouping. Pairs with `score.ts`
pattern.

**Prop interface.**

```ts
export interface ScoreEntry {
  key: string;
  label: string;
  /** Discriminator: render as bar or tier. */
  kind: "bar" | "tier";
  value: number;
  max?: number;                                   // for kind=bar
  tiers?: StatTier[];                             // for kind=tier
  group?: string;                                 // optional grouping
}

export interface ScoreBoardProps {
  entries: ScoreEntry[];
  /** Layout columns. Default 1 (vertical). */
  columns?: number;
  /** When true, group entries by `entry.group`. */
  grouped?: boolean;
  style?: CSSProperties;
}
```

**Visual mock.**

```
─── Body ──────────────────────
HP     ████████░░  80/100
Stam   ██████░░░░  60/100

─── Reputation ────────────────
Inn       ▰▰▰▰▱ warm
Smiths    ▰▰▱▱▱ wary
Wardens   ▰▰▰▱▱ neutral
```

**Stage-author usage.**

```tsx
<ScoreBoard
  grouped
  entries={[
    { key: "hp",   label: "HP",   kind: "bar",  value: pc.hp, max: 100, group: "Body" },
    { key: "stam", label: "Stam", kind: "bar",  value: pc.stam, max: 100, group: "Body" },
    { key: "inn",  label: "Inn",  kind: "tier", value: rep.inn, tiers: TIERS, group: "Reputation" },
  ]}
/>
```

**Player-facing affordance type.** Ambient.

**Opacity profile.** *Visible:* labels, values, tiers. *Hidden:*
shard structure, stat IDs.

**Dependencies.** Composes `StatBar` and `StatTier`. **Build order:
ships after them.**

---

### 3.11 ChoiceList

**Purpose.** Vertical option picker — dialogue choices, action menu,
multiple-choice prompts. Distinct from `ActionSurface` (which is a
free-form button grid): `ChoiceList` is a *numbered, exclusive-pick*
surface, the dialogue-choice shape.

**Prop interface.**

```ts
export interface Choice {
  id: string;
  label: string;
  /** Optional hint shown beneath the label. */
  hint?: string;
  /** Verb to invoke when selected. If omitted, calls onPick. */
  verb?: string;
  /** Verb args (extends/overrides default `{choice: id}`). */
  verbArgs?: Record<string, unknown>;
  enabled?: boolean;
}

export interface ChoiceListProps extends IntrospectAware {
  choices: Choice[];
  /** Number the choices (1., 2., 3.). Default true. */
  numbered?: boolean;
  /** Maximum simultaneous choices. Default 7 (Miller). Overflow shows
   *  "more…" expand. */
  maxItems?: number;
  onPick?: (choice: Choice) => void;
  style?: CSSProperties;
}
```

**Visual mock.**

```
What do you say to Mira?

  1. "I'm looking for the map fragment."
  2. "What can you tell me about the cellar?"
  3. "I'd like to rent a room."        (1 gold)
  4. Leave the inn.

  more… (3 hidden)
```

**Stage-author usage.**

```tsx
<ChoiceList
  choices={dialogue.currentChoices().map(c => ({
    id: c.id, label: c.text, verb: "say", verbArgs: { line: c.id },
    hint: c.cost ? `(${c.cost} gold)` : undefined,
  }))}
  availableVerbs={verbs}
  onVerbInvoke={this.invokeVerb}
/>
```

**Player-facing affordance type.** Command (exclusive pick) +
navigational (next dialogue node).

**Opacity profile.** *Visible:* choice text, hint, cost. *Hidden:*
gating predicates, post-pick state changes.

**Dependencies.** None on other 2E components.

---

### 3.12 ModalPicker

**Purpose.** Generic modal wrapper that hosts another picker
(ChoiceList, RegistryGallery, SlotPicker) for interrupting flows:
"Choose which item to give," "Equip from collection," etc.

**Prop interface.**

```ts
export interface ModalPickerProps {
  open: boolean;
  title: string;
  /** Picker content. Typically a ChoiceList / RegistryGallery /
   *  SlotPicker — but anything ReactElement works. */
  children: ReactElement;
  /** Called when the user cancels (Esc / backdrop click). */
  onCancel: () => void;
  /** Show explicit Cancel button. Default true. */
  showCancel?: boolean;
  style?: CSSProperties;
}
```

Not directly introspect-aware. The child component (ChoiceList, etc.)
carries the introspect contract. ModalPicker is structural.

**Visual mock.**

```
       ┌─ Give to Elder Mira ───┐
░░░░░░░│                         │░░░░░░░
░░░░░░░│  • Brass key            │░░░░░░░
░░░░░░░│  • Wax-sealed letter    │░░░░░░░
░░░░░░░│  • Cracked compass      │░░░░░░░
░░░░░░░│                         │░░░░░░░
░░░░░░░│           [ Cancel ]    │░░░░░░░
       └─────────────────────────┘
```

**Stage-author usage.**

```tsx
<ModalPicker
  open={this.giveModalOpen}
  title="Give to Elder Mira"
  onCancel={() => this.giveModalOpen = false}
>
  <ChoiceList
    choices={inv.map(i => ({ id: i.id, label: i.name,
      verb: "give", verbArgs: { target: "elder-mira", item: i.id } }))}
    availableVerbs={verbs}
    onVerbInvoke={this.invokeVerb}
  />
</ModalPicker>
```

**Player-facing affordance type.** Navigational (modal interrupt) +
hosts whatever its child is.

**Opacity profile.** Same as the child component.

**Dependencies.** Hosts any of the picker components above. **Build
order: ships in same batch as ChoiceList.**

---

### 3.13 FormBuilder

**Purpose.** Generic structured form input for managerial stages.
Renders a labeled set of inputs (text, number, enum, boolean) and
submits as a verb invocation with `args` matching the form fields.

**Prop interface.**

```ts
export interface FormField {
  /** Maps directly to `VerbArg.name`. */
  name: string;
  label: string;
  type: "string" | "number" | "boolean" | "enum";
  required?: boolean;
  enum?: string[];                                // for type=enum
  default?: unknown;
  hint?: string;
}

export interface FormBuilderProps extends IntrospectAware {
  /** Verb name this form submits to. */
  verb: string;
  /** Fields. Can be derived from VerbDescriptor.args by calling
   *  `formFieldsFromVerb(descriptor)`. */
  fields: FormField[];
  submitLabel?: string;                           // default "Submit"
  onSubmit?: (values: Record<string, unknown>) => void;
  style?: CSSProperties;
}
```

**Shipping helper:**
`formFieldsFromVerb(v: VerbDescriptor): FormField[]` derives fields
from a verb's args, so a stage with one `set-policy` verb can render
its form with one line.

**Visual mock.**

```
─── Set tax rate ─────────────────────
  Rate (0–100):  [   18  ]
  District:      [ Hold   ▾]
  Enforce:       [✓]
                        [  Submit  ]
```

**Stage-author usage.**

```tsx
const verb = verbs.find(v => v.name === "set-policy")!;
<FormBuilder
  verb="set-policy"
  fields={formFieldsFromVerb(verb)}
  availableVerbs={verbs}
  onVerbInvoke={this.invokeVerb}
/>
```

**Player-facing affordance type.** Data-entry + command (submit).

**Opacity profile.** *Visible:* fields, types, enum options, defaults.
*Hidden:* downstream validation rules beyond what `VerbArg` carries
(stage's job to surface validation errors via the next invocation
result).

**Dependencies.** None on other 2E components.

---

### 3.14 SlotPicker

**Purpose.** Pick a persistence save slot. Distinct shape: enumerate
existing slots with labels + timestamps, plus a "new slot" affordance.
Was the only UI primitive planned in the *original* ROADMAP — now one
of 14.

**Prop interface.**

```ts
export interface SaveSlot {
  id: string;
  label: string;
  savedAt?: number;                               // epoch ms
  summary?: string;                               // one-line description
  empty?: boolean;
}

export interface SlotPickerProps extends IntrospectAware {
  slots: SaveSlot[];
  /** Verb name to invoke on save-slot pick. Default "load-slot". */
  loadVerb?: string;
  /** Verb name to invoke on save. Default "save-slot". */
  saveVerb?: string;
  /** Verb name to invoke on delete. Default "delete-slot". */
  deleteVerb?: string;
  allowDelete?: boolean;
  style?: CSSProperties;
}
```

**Visual mock.**

```
─── Saves ──────────────────────────
  ● Slot 1     2026-05-25 14:02
              "In the cellar, turn 14."   [Load] [Del]
  ○ Slot 2     2026-05-24 22:11
              "First arrival at the inn." [Load] [Del]
  + New slot                              [Save]
```

**Stage-author usage.**

```tsx
<SlotPicker
  slots={persistence.listSlots()}
  availableVerbs={verbs}
  onVerbInvoke={this.invokeVerb}
  allowDelete
/>
```

**Player-facing affordance type.** Command + data-entry (slot name).

**Opacity profile.** *Visible:* slot list, save metadata. *Hidden:*
the underlying shard structure, branch trees (a future component
could surface those for stages opting in).

**Dependencies.** None on other 2E components.

---

## 4. Component dependency graph

```
                            (introspect-aware contract; in introspect/)
                                          │
        ┌────────────────────┬────────────┴────────────┬────────────────────┐
        │                    │                         │                    │
    Tier 1 — pure leaves (no 2E deps)
        │                    │                         │                    │
    StatBar  ──┐           BodyDiagram             ChoiceList         RegistryGallery
    StatTier ──┤           TileGrid                ModalPicker        TimelinePanel
               │           HexGrid                                    FormBuilder
               │           GraphView                                  SlotPicker
               │
        ┌──────┴──────┐
        ▼             ▼
    Tier 2 — composers
        │             │
    ScoreBoard    ActorPanel
                  (uses BodyDiagram + StatBar + StatTier + RegistryGallery)
```

- **Tier 1** (12 components) — depend only on the shared
  `IntrospectAware` shape (defined in this design doc; lands in
  `src/lib/ui/introspect-aware.ts` or inlined). Independently
  shippable.
- **Tier 2** (2 components) — `ActorPanel` and `ScoreBoard`. Compose
  Tier 1 components. Must ship after their leaves.

Notes:
- `ModalPicker` is structural; "depends on" any picker it hosts but
  doesn't import them (children are `ReactElement`). Ship-order
  independent.
- `formFieldsFromVerb` helper ships with `FormBuilder`.
- `IntrospectAware` itself depends only on `src/lib/introspect/types.ts`
  (already shipped).

---

## 5. Build order recommendation

Three parallel batches, each shippable as one PR.

### Batch A — Stats & content (Tier 1 leaves, no graph deps)

`StatBar`, `StatTier`, `RegistryGallery`, `TimelinePanel`, `BodyDiagram`

Rationale: smallest components, no shared subgraphs, immediately
useful for retrofitting existing examples (UX-AUDIT R2: replace JSON
dumps in `cyber-slots`, `effects`, `turn-combat`). One PR; 5
components; ~600 LOC total estimate.

### Batch B — Spatial & graph (Tier 1, larger components)

`TileGrid`, `HexGrid`, `GraphView`

Rationale: these are the heaviest leaves (custom rendering,
coordinate math, possibly d3-force for GraphView). Parallelizable
internally — one engineer per component or one author across all
three. One PR; 3 components; ~700 LOC total estimate.

### Batch C — Interaction surfaces (Tier 1 leaves, interaction-heavy)

`ChoiceList`, `ModalPicker`, `FormBuilder`, `SlotPicker`

Rationale: these are the most introspect-contract-exercising
components — they all surface verbs and handle invocation. Shipping
them together lets the contract get stress-tested in one PR. One PR; 4
components; ~500 LOC total estimate.

### Batch D — Composers (Tier 2)

`ActorPanel`, `ScoreBoard`

Rationale: depend on Batch A. Ship after Batch A merges (B and C can
land in parallel with A; D follows A). One PR; 2 components;
~250 LOC total estimate.

### Critical path

```
Batch A ──> Batch D
   (Batch B parallel with A, C)
   (Batch C parallel with A, B)
```

A→D is the only ordering constraint. Total wall-clock minimum is
`max(A, B, C) + D` if all three Batches A/B/C run concurrently.

---

## 6. Cost estimate

S/M/L per component:
- **S** ≈ ½ day, ~80–150 LOC + tests + doc-comment
- **M** ≈ 1 day, ~150–250 LOC
- **L** ≈ 2 days, ~250–400 LOC

| # | Component | Size | Notes |
|---|-----------|------|-------|
| 1 | TileGrid | M | Cell math + interactivity bridging |
| 2 | HexGrid | M | Axial coord math; shares helper with TileGrid |
| 3 | GraphView | L | Force layout + interactivity; risk on d3 dep choice |
| 4 | ActorPanel | M | Mostly composition; small itself |
| 5 | BodyDiagram | M | Humanoid SVG silhouette; list fallback trivial |
| 6 | TimelinePanel | S | List render + group collapse |
| 7 | RegistryGallery | S | Card grid + pagination |
| 8 | StatBar | S | Trivial bar |
| 9 | StatTier | S | Trivial threshold display |
| 10 | ScoreBoard | S | Composition |
| 11 | ChoiceList | S | List + Miller cap |
| 12 | ModalPicker | S | Generic modal shell |
| 13 | FormBuilder | M | Input types + `formFieldsFromVerb` helper |
| 14 | SlotPicker | S | List + new-slot input |

Totals: **3 L + 5 M + 8 S** ≈ 9–11 engineering-days serial,
or **~3–4 wall-clock days** with the four-batch parallelization above.

The introspect-aware contract itself (Section 2 made concrete in
`src/lib/ui/introspect-aware.ts` or inlined into each component) is
~½ day of design-to-code; bake it into Batch A.

---

## 7. Out of scope / future

- **3D variants** (`TileGrid3D`, `HexGrid3D`, `GraphView3D`) — Wave 2F
  under `src/lib/3d/ui/`.
- **VoronoiInfluenceMap** — already shipped in
  `src/lib/ui/voronoi-influence-map.tsx`. Not part of this 14.
- **Animated transitions.** All components ship with static state
  changes; animation hooks (e.g. trajectory dot fading in `physics`)
  are stage-author concern via the `renderCell` / `renderNode` slots.
- **Responsive collapse.** Layout-level concern; lives in
  `CompositionLayout` (already shipped) and host stages.
- **Drag-and-drop within grids.** TileGrid takes `onCellClick` only.
  Future `onCellDrop` is a TODO when an example needs it (likely
  Facility-management slot-assignment) — flagged but not in this wave.
- **Branch-tree UI for chat history.** SlotPicker covers flat slots;
  branched persistence (`chubTreeHistory`) deserves its own component
  (`BranchPicker` or similar) in a future micro-wave.
- **Form validation errors.** FormBuilder renders the form; surfacing
  validation errors from `InvocationResult.error` is a stage-author
  pattern, not built into the component. Could be added as
  `formError?: string` prop if it recurs.
- **A11y pass.** Components ship keyboard-navigable defaults
  (button/role semantics, tabIndex, Enter/Space activation) but a
  formal a11y audit is out of scope; recommend a follow-up audit pass
  matching the UX audit's structure.
- **Storybook / preview harness.** Authors get one preview path
  today: drop the component into an example. A dedicated UI sandbox
  (e.g. `examples/_ui-gallery/`) is a future improvement; out of
  scope here.

### Components flagged for user decision

**None.** All 14 components in ROADMAP §"Wave 2E" are specced as-is.

One adjacent thing to flag (not in the 14): the introspect-aware
contract surfaced an opportunity for a small helper component,
`VerbBar`, that's the minimal `availableVerbs → buttons` adapter —
basically `ActionSurface` re-wired through the introspect contract.
The existing `ActionSurface` already does this; the question is
whether to retrofit `ActionSurface` to introspect-mode or ship
`VerbBar` as the new canonical name. Recommend: **retrofit
`ActionSurface`** in Batch C alongside `ChoiceList`/etc.; do not
add a 15th component.
