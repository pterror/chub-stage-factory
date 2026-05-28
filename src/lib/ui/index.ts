/*
 * ui/index.ts — public barrel for the ui component library.
 *
 * Re-exports every ui component (named exports throughout — the repo
 * convention) plus the shared IntrospectAware contract. Per-file imports
 * (e.g. `import { StatBar } from ".../ui/StatBar"`) keep working; this
 * barrel is additive.
 *
 * Wave 2E added 14 introspect-aware primitives + retrofitted ActionSurface;
 * the IntrospectAware mix-in is consolidated in ./introspect-aware.
 */

// Shared contract.
export * from "./introspect-aware";

// Wave 2E — Batch A (stats & content)
export * from "./StatBar";
export * from "./StatTier";
export * from "./RegistryGallery";
export * from "./TimelinePanel";
export * from "./BodyDiagram";

// Wave 2E — Batch B (spatial & graph)
export * from "./TileGrid";
export * from "./HexGrid";
export * from "./GraphView";

// Wave 2E — Batch C (interaction surfaces)
export * from "./ChoiceList";
export * from "./ModalPicker";
export * from "./FormBuilder";
export * from "./SlotPicker";

// Wave 2E — Batch D (tier-2 composers)
export * from "./ActorPanel";
export * from "./ScoreBoard";

// Retrofitted shell component (introspect-aware as of Wave 2E Batch C).
export * from "./ActionSurface";

// Pre-existing shell components.
export * from "./ScenePane";
export * from "./WorldStatePanel";
export * from "./ChatLogSidebar";
export * from "./FreeformInput";
export * from "./CompositionLayout";
export * from "./voronoi-influence-map";
export * from "./voronoi-utils";
