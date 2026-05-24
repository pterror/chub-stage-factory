# ROADMAP

## What this is

The library's design direction. Reflects design decisions through 2026-05-23. Companion to:

- `README.md` — current state of primitives + rules.
- `COMPOSITION.md` — patterns-as-first-class positioning rationale + "imagine X, but infinite" pitch.
- `PATTERNS.md` — current recipe catalog.
- `CLAUDE.md` (repo root) — north stars frontloaded into every Claude Code session.
- `design/` — implementation-ready design docs synthesized from `mining/` + ROADMAP wave specs. See `src/lib/design/README.md` for the index. Foremen implementing a wave should read the corresponding design doc first.

Read those first; this doc adds: the game shipping catalog, the dependency-driven wave plan, the decision audit, the pattern composer catalog, the synergy-pattern catalog, and the mining queue.

This doc is forward-looking. As waves ship, move completed items from upcoming sections into Wave 0 / shipped lists and update the status snapshot at the bottom. Do NOT delete completed items — the historical decision-record is part of the value.

## North stars (brief; full text in CLAUDE.md)

1. *Imagine X, but infinite.* — content-bounded classics → content-unbounded shapes-of-classics.
2. Composition strictly dominates monolithic frameworks. Every "thing" is either a primitive or a pattern.
3. Supply-driven, not demand-driven. "Deferred until a use case" is invalid library reasoning.
4. Provenance-neutral primitives, synergy-rich patterns. Procgen + LLM compose without prescription.
5. LLMs are single-shot; naive chat accumulation is context poisoning. World state is the durable substrate; distant chat summarizes into state, not raw text.
6. Composable context construction; the stage author never `string +`s a prompt. `ContextAssembler` + `ContextContributor` is the prompt-assembly model.

Two design rules surfaced during the Warframe-shape discussion:

7. **Configuration is additive, never subtractive.** Saving a build never costs you another build. Switching configurations is mechanically free by default. If a stage wants to impose currency / cooldown / narrative friction on customization, it does so explicitly; the library never imposes it.
6. **Named-in-source-game ≠ earns-a-primitive.** Things have names in the games we're modeling (`Faction`, `Module`, `Skit`, `Form`, `ConfigSlots`); that does not mean each gets a primitive slot. The reduction test always applies.

## Catalog taxonomy — atomic / umbrella / composite shapes

The catalog isn't a flat list of N games to build; it's a 2D-or-more space where every cell is a valid stage and a few cells are highlighted as canonical examples. Shapes fall into three categories:

- **Atomic shapes.** Single mechanical axis. Each is a clean genre with well-understood mechanics. Examples: CCA-shape (#1, IF), Zork-shape (#2, IF + score), Walking-sim-shape (#16, atmospheric).
- **Umbrella shapes.** Same mechanics, different content theming. Examples: Facility-management-shape (#20) with SFW/brothel/Lobotomy variants — identical mechanical DNA (room grid + workers + assignments + incidents + bulkTick), different content tagging. Subject-life-sim-shape (#19) with fempov / malepov / nonbinary POV variants.
- **Composite shapes.** Multiple atomic shapes layered. Examples: FC-shape (#8) is Facility-Management × Breeding-Sim × adult content layered together. CoC-shape (#4) is Sandbox × Body-Transformation × Scene-Combinatorics. Composite shapes inherit primitive dependencies from each axis they layer.

This taxonomy is the right way to read the catalog: each example we ship demonstrates one canonical point in the space; the patterns layer makes the rest of the space cheap to reach. The catalog grows by either (a) identifying genuinely new mechanical axes (atomic shapes), (b) recognizing one shape's mechanics work across multiple themes (umbrella shapes), or (c) layering existing shapes (composite shapes).

## Shipping catalog — 20 game-shape examples

Each is a Chub-deployable stage whose worlds, characters, and content are generated on demand by LLM + procgen rather than authored once. The tagline is the audience-facing pitch and ships in the stage's `chub_meta.yaml` + `README.md`. The point isn't to ship all 20 immediately — it's that the library *enables* them.

| # | Game-shape | Tagline | Primitive deps | Status |
|---|---|---|---|---|
| 1 | CCA-shape | *Imagine Colossal Cave Adventure, but infinite.* — every chat is a new underground, fresh puzzles, the LLM doing the prose. | world, actor, intent, procgen, generate | Wave 3 pending; smallest, ships first in IF-axis |
| 2 | Zork-shape | *Imagine Zork, but infinite.* — every chat is a new underground, the thief, the maze, score-and-ranks. | (CCA-deps) + dialogue, score-as-stat | Wave 3 pending |
| 3 | HHGTTG-shape | *Imagine Hitchhiker's Guide, but infinite.* — every chat is a different absurdist universe in the same comic register. | (CCA-deps) + constraint-puzzle pattern | Wave 3 pending; constraint-puzzle authoring tightest |
| 4 | CoC-shape | *Imagine Corruption of Champions, but infinite.* — every playthrough is a different Mareth, fresh threats and transformations. | actor, procgen, generate, scene, existing body/transformation/effects | Wave 3 pending; first scene-primitive use |
| 5 | TiTS-shape | *Imagine Trials in Tainted Space, but infinite.* — every chat is a new universe of planets, encounters, species. | (CoC-deps) + ship combat (combat-realtime, have) | Wave 3 pending |
| 6 | LT-shape | *Imagine Lilith's Throne, but infinite.* — every chat is a new city, fresh factions, NPCs that didn't exist before. | (CoC-deps) + world, faction-as-recipe, slavery-as-owner-field-on-actor | Wave 3 pending |
| 7 | FS-shape | *Imagine Flexible Survival, but infinite.* — every chat is a new outbreak, new infection vectors, new survivors. | actor, world, transformation, scheduler, bulkTick pattern | Wave 3 pending |
| 8 | FC-shape | *Imagine Free Cities, but infinite.* — every arcology has unique slaves, unique events, unique trade arcs. | actor (bulk-from-start), procgen, generate, bulkTick, managerial; NO world/intent/scene needed | Wave 3 pending; smallest primitive surface, may ship first chronologically |
| 9 | Warframe-shape (TF-power-fantasy) | *Imagine Warframe, but infinite.* — collect frames, mod them, graft abilities, switch freely, every frame procgen-unique. | actor (player puppeteers form), Form pattern, FormCollection (PlaceholderRegistry), grafting pattern, puppet pattern | Wave 3 pending |
| 10 | Dungeon-crawler-shape | *Imagine Wolfenstein/Doom, but infinite.* — procgen dungeons, every chat a new layout. | 3D substrate, FPS controller, real-time combat, procgen | Wave 3 pending |
| 11 | ARPG-shape | *Imagine Diablo, but infinite.* — procgen dungeons, loot, ARPG combat. | 3D substrate, top-down controller, real-time combat, procgen | Wave 3 pending |
| 12 | Souls-shape | *Imagine Dark Souls, but infinite.* — procgen interconnected world, stamina combat. | 3D substrate, third-person orbital, melee physics | Wave 3 pending |
| 13 | Platformer-shape | *Imagine Celeste, but infinite.* — procgen levels, momentum platforming. | 2D physics (planck), sidescroller controller | Wave 3 pending |
| 14 | Spacesim-shape | *Imagine Elite Dangerous, but infinite.* — procgen galaxy, ship combat. Note: TiTS-shape but with the actual flying. | 3D substrate, vehicle controller, space physics | Wave 3 pending |
| 15 | RTS-shape | *Imagine StarCraft, but infinite.* — procgen maps, unit production, base building. | 3D substrate top-down, cursor controller, pathfinding | Wave 3 pending |
| 16 | Walking-sim-shape | *Imagine Dear Esther, but infinite.* — procgen vistas, LLM-generated atmospheric voiceover. | 3D substrate, FPS controller, audio | Wave 3 pending |
| 17 | Pregnancy-sim-shape | *Imagine [your favorite pregnancy CYOA], but infinite.* — every chat is a different pregnancy with different complications, body trajectories, partner dynamics; every daily vignette procgen-grounded and LLM-rendered. | actor, transformation trajectory (have), effects with asymmetric kinetics (have), scheduler, scene primitive (Wave 2A), generate (Wave 1), Timeline, observation, dailyVignettePattern | Wave 3 pending |
| 18 | Breeding-sim-shape | *Imagine Breeding Season, but infinite.* — every chat is a different bestiary of breeding partners with unique trait pools; generations branch dynastically; every offspring procgen-generated with LLM-flavored personality. | actor + ActorPool, procgen.recombine (Wave 1.5), generate (Wave 1), bulkTick (Wave 2C), managerial (Wave 2C), Timeline, Registry | Wave 3 pending |
| 19 | Subject-life-sim-shape (umbrella; fempov-horny-sandbox is one POV variant) | Multiple taglines per POV: *Imagine "My New Life," but infinite. Imagine Lab Rats 2 from her perspective, but infinite. Imagine The Sims with explicit content, but infinite.* — player IS the subject (not manager), open multi-location life sim with recurring NPC relationships, resource management, pregnancy as one consequence thread among many. | actor (focal), ActorPool (NPCs), world (Wave 2B), inventory, stats, effects, scheduler, scene (Wave 2A), transformation, Timeline, **ConditionalTrigger** (huge here — pregnancy conditional on cycle+protection+stats; NPC behavior based on past interactions), generate, intent (Wave 2B), subjectSandboxPattern | Wave 3 pending |
| 20 | Facility-management-shape (umbrella; three theme variants below) | 20a *Imagine Fallout Shelter, but infinite.* — every vault is a different procgen layout, different dwellers, different incidents. 20b *Imagine Strive: Conquest, but infinite.* — every brothel is different girls, different clientele, different room loadout. 20c *Imagine Lobotomy Corporation, but infinite.* — every facility is different abnormalities, different employees, different mental-health spirals. | TileGrid UI (Wave 2E), world (Wave 2B) for rooms-as-graph, Registry<RoomType>, ActorPool (workers), stats + tiers, Scheduler, bulkTick (Wave 2C), managerial (Wave 2C), ConditionalTrigger for incidents (Wave 1.5), Effects (worker status), slotAssignmentPattern, spatialPropagationPattern, focusPattern, generate + PlaceholderRegistry (worker recruitment) | Wave 3 pending |

**Meta-category — slice-of-life-texture-shapes.** The catalog's first 16 shapes biased toward combat / management / exploration / sandbox. Pregnancy-sim (#17), and other shapes that would fit here (dating-sim, pet-care, slow-life farming a la Stardew, aging-and-life sim a la Sims), share a distinct mechanical axis: **sustained focus on one subject's gradual change with daily vignettes as the content unit**. The load-bearing composer for all of them is `dailyVignettePattern` — slice-of-life equivalent of `bulkTick` (which advances many actors in parallel; daily-vignette advances ONE subject deeply through time). This category isn't a separate catalog entry per se; it's a recurring shape across multiple entries (17, plus future dating-sim, life-sim, etc. if/when added).

The library's external promise is unbounded faithful-to-genre play; these examples are the proof. The "infinite X" framing in each stage's tagline is non-negotiable — authors browsing Chub see "infinite TiTS" and click; they see "primitives library demo stage" and don't.

## Wave roadmap (dependency-ordered)

Order is determined by primitive dependency graph, not audience priority. Multiple game-shapes ship in parallel once their wave's primitives land.

### Wave 0 — shipped

- All foundational primitives: `tags`, `body`, `transformation`, `equipment`, `constraints`, `snapshots`, `stats`, `effects`, `scheduler`, `fsm`, `rng`, `inventory`, `grid-inventory`, `action`, `combat-turn`, `combat-realtime`, `physics`, `observation`, `prose-register` (typed presets cut), `tag-parser`, `classifier`, `chub-adapters`, `replay`
- Persistence cluster: `backend`, `history` (tree-based), `store`, `chub`, with `shard`/`shardOf`/`counterShard`/`layerShards` helpers
- `Registry` + `PlaceholderRegistry`
- `Timeline` (implements `ObservationSource`)
- 8 example stages: `inventory`, `effects`, `turn-combat`, `tits-body`, `cyber-slots`, `physics`, `realtime-combat`, `composite-showcase`
- Docs: `README`, `REFERENCE`, `PATTERNS`, `CONFLICTS`, `PROSE`, `REGISTRY`, `TIMELINE`, `COMPOSITION`

### Wave 1 — universal shared foundation

Required by every Wave 3 example. Three primitives, parallelizable (no inter-dependencies).

- **`src/lib/actor.ts` — Actor with `ActorPool` bulk-collection form.** Bundled entity: body + inventory + stats + location + optional owner/affinity + arbitrary tags. Designed bulk-first (FC-shape scales to 100+ actors per stage). Probably ships an `ActorPool: Registry<Actor>` as the natural managed-collection form rather than per-actor shards.
- **`src/lib/procgen.ts` — deterministic procgen helpers over `rng`.** Weighted tables, topology generators with constraints, template-based instantiation. Pure functions. ~200 LOC.
- **`src/lib/generate.ts` (or extension of `classifier.ts`) — LLM-call primitive with schema + retry + cache.** `(prompt, schema?) => Promise<T>` with retry on validation. Cache via Shard. Composes with `PlaceholderRegistry` for placeholder→swap async. Single primitive surface for LLM gen across all stages.

Wave 1 adds one ROADMAP-tier decision rule: **the synthesis primitives (`procgen` + `generate` together with `persistence` + `PlaceholderRegistry`) are load-bearing for the "infinite" pitch.** Test for any future primitive: does this make "infinite X" more credible, or just more elaborate?

### Wave 1.5 — predicate/trigger + procgen.recombine

Small wave (~200 LOC total) that ships ahead of Wave 2 because it is load-bearing across everything that comes after. Two primitives; no inter-dependencies.

#### `src/lib/predicate.ts` + `src/lib/trigger.ts` — conditional probabilistic triggers

Surfaced from the breeding-sim discussion: a "mutation rate" parameter is the lazy roguelike framing. The real primitive shape is **conditional probabilistic triggers with a queryable predicate DSL** — generalizable to every "this happens when X under Y conditions with Z chance" mechanic across the catalog.

```ts
// src/lib/predicate.ts
type Predicate<S> =
  | { kind: "tag-on"; target: ActorRef; tag: string }
  | { kind: "stat"; target: ActorRef; stat: string; op: ">" | "<" | "==" | "!=" | ">=" | "<="; value: number }
  | { kind: "stat-tier"; target: ActorRef; stat: string; tier: string }
  | { kind: "has-item"; target: ActorRef; item: string; count?: number }
  | { kind: "located-at"; target: ActorRef; location: string }
  | { kind: "actor-relation"; subject: ActorRef; object: ActorRef; relation: string; op?: ">" | "<" | "==" ; value?: number }
  | { kind: "since"; event: string; op: "<" | ">"; duration: number }      // time-since-event
  | { kind: "world-flag"; flag: string; value?: unknown }
  | { kind: "and"; clauses: Predicate<S>[] }                                // n-ary
  | { kind: "or"; clauses: Predicate<S>[] }
  | { kind: "not"; inner: Predicate<S> }
  | { kind: "custom"; id: string; fn: (s: S, refs: Refs) => boolean };      // escape hatch (does not serialize)

type ActorRef = "self" | "partner" | "player" | { id: string };             // ref resolution at eval time

function evaluate<S>(p: Predicate<S>, state: S, refs: Refs): boolean;
function evaluateAll<S>(ps: Predicate<S>[], state: S, refs: Refs): boolean;

// src/lib/trigger.ts
interface ConditionalTrigger<S, E> {
  id: string;
  when: Predicate<S>;                              // must evaluate true
  probability: number | ((state: S) => number);   // state-dependent allowed
  effect: E;                                       // payload, fired by caller
  cooldown?: number;                               // ms — prevents rapid re-fire
  oneShot?: boolean;                               // fires at most once
}

class TriggerSet<S, E> {
  triggers: ConditionalTrigger<S, E>[]
  evaluate(state: S, rng: RngStream): E[]          // returns all firing effects
  // toJSON/fromJSON for cooldown state + oneShot fired-flags persistence
}
```

Use cases across the catalog (every shape touches this):
- LT: "when arcology rep > 70 AND time-since-last-faction-encounter > 7 days, 30% chance faction approaches you"
- CoC: "when corruption tier = mostly-pure AND consumed-tincture-X within 24h, 100% chance demoness TF"
- Zork: "when player in maze AND has-grue-protection = false AND in-darkness, 80% chance grue eats player"
- FC: "when slave obedience tier = rebellious AND health > 50 AND unguarded, 15% chance escape attempt"
- Warframe-shape: "when player defeated 5+ enemies tagged=Y AND form-X not yet unlocked, 100% chance form-X drops"
- Breeding-sim: "when paired with sire tag=alpha AND gestation > 4 weeks, 25% chance offspring inherits tag=alpha-traits"
- Pregnancy-sim: "when gestation = 6-8 weeks AND no-fitness-routine within 48h, 60% chance morning-sickness event"
- Facility-management: "when room.heat-output > capacity AND no-fire-suppression, 5% chance fire event per tick" (then `spatialPropagationPattern` handles the spread)

Design notes:
- **Scope / target resolution.** Predicates declare role-name refs (`self`, `partner`, etc.); the evaluator takes a `Refs` dict mapping role names to entities. Predicate stays generic; resolution happens at eval site.
- **Serialization vs power.** Pure-data tagged-union predicates serialize cleanly; `custom` escape-hatch loses JSON round-trip. Ship both with a clear "custom predicates won't survive saves" warning in the doc.
- **Composition with tags.ts query DSL.** `tags.ts` already has `!` negation + AND-of-tags queries. Probably `kind: "tag-query"` predicates use that DSL inline as a string for advanced tag matching.
- **Cooldown / oneShot state.** Lives in TriggerSet's serializable state. Shard-able like everything else.
- **Probability functions.** State-dependent `(state) => number` loses serialization. Alternative: `{ base: number; modifiers: PredicateBasedModifier[] }` — fully serializable. Ship both; escape hatch with serialization warning.

**Additive extensions (from SYNERGY design pass):** `predicate.ts` gains two new kinds in Wave 2I:
- `{ kind: "regex"; target; field; pattern: string }` — regex match against a string field
- `{ kind: "glob"; target; field; pattern: string }` — glob match against a string field

Mitigates the `key-collision` anti-pattern documented in `src/lib/design/SYNERGY-EXTENSIONS.md`.

#### `procgen.recombine` (Wave 1 amendment)

The genetics helper uses `ConditionalTrigger` for mutations, not a flat `mutationRate` parameter. Mutations are themselves predicate-gated probabilistic triggers — same primitive shape as every other "X chance under Y conditions" mechanic. The flat-rate framing was lazy; the trigger-set framing generalizes.

```ts
procgen.recombine({
  parents: [a, b],
  traitPool: Registry<Trait>,
  inheritance: 'mendelian' | 'blended' | 'dominant-recessive' | CustomInheritance,
  mutations: ConditionalTrigger<ChildGenotype, MutationEffect>[]   // predicate-gated
})
```

### Wave 2A — erotic-RPG axis

- **`src/lib/scene.ts` — combinatoric action composition.** `(actor, target, verb) → outcome` where outcome depends on actor's parts × target's parts × consent × pose × intensity × items-in-scope. Extension of `action.ts` with a richer target/effect resolver that knows body tags and partner state. ~420-480 LOC (estimate corrected post-design; see `src/lib/design/SCENE.md`).
- **`src/lib/patterns/scene.ts` — `scenePattern` composer.**

Enables CoC-shape, TiTS-shape, LT-shape. **Mining required first** (see Mining queue): TiTS source + LT source + possibly FoE for scene-resolver prior art. Scene composition is the most under-theorized axis; only deep prior art exists in (notoriously messy) game sources.

Design informed by mining of TiTS + Lilith's Throne scene systems — see `src/lib/mining/SCENE.md` for the full prior-art analysis.

### Wave 2B — parser-IF axis

- **`src/lib/world.ts` — graph of places.** Rooms with named exits (n/s/e/w/up/down/in/out), objects+actors located at place, scope/visibility rules. Composes with `inventory` (objects as containers) + `actor` (located-at) + `observation` (scope = visible-from-here). ~300 LOC.
- **`src/lib/intent.ts` — player command extraction.** Two layers: deterministic verb-noun-prep grammar with synonyms + object resolution against scope; LLM fallback via `classifier`. Same primitive surface, two engines. ~200 LOC.
- **`src/lib/patterns/world-exploration.ts`, `dialogue.ts`, `score.ts`**

Enables CCA-shape, Zork-shape, HHGTTG-shape. Parallel-developable with Wave 2A.

### Wave 2C — FC / managerial axis

- **`src/lib/patterns/bulk-tick.ts`** — weekly tick = advance all actors via `ActorPool.forEach`, collect events, push to `Timeline`, render report. No new primitives.
- **`src/lib/patterns/managerial.ts`** — player-issues-policy + report-rendering loop. Form-input + `Timeline.summarize` over the tick window. No new primitives.

Smallest wave. Enables FC-shape, partially FS-shape, partially LT-shape. Parallel-developable with Waves 2A and 2B.

### Wave 2D — Warframe-shape axis

Zero new primitives; pure pattern composition.

- **`src/lib/patterns/form.ts` — Form-as-character bundle.** Composes `Body` + `Stats` + abilities (`ActionDef` set) + aesthetics + lore. A Form is a *character in its own right*, not a body delta.
- **`src/lib/patterns/form-collection.ts`** — `PlaceholderRegistry<Form>` wrapper; collection grows via gameplay; unlocks resolve placeholders to real forms.
- **`src/lib/patterns/grafting.ts` — Helminth-style.** Transfer one ability/feature from collection A to collection B with provenance tracking.
- **`src/lib/patterns/puppet.ts`** — actor-piloting-another-actor. Player's true-self is one Actor (`chatState` canon); currently-equipped form is another Actor instance (paradigm chosen by stage author). Memory + inventory + relationships persist on the true-self; abilities + appearance + body live on the form.

Default contract + knob list derived from Warframe Helminth subsume mechanics — see `src/lib/mining/GRAFTING.md`.

Parallel-developable with Waves 2A, 2B, 2C.

### Wave 2E — UI primitives

The "React component primitives beyond optional `SlotPicker` — UI is the stage author's concern" position from the original ROADMAP is reversed. UI components are primitives too; refusing to ship them just forces every stage author to hand-roll the same set, violating the comprehensive-everything mandate. Wave 2E ships them.

Components ship as `src/lib/ui/*.tsx`, prop-customizable (theme/colors/cell-render/interaction-callbacks all overridable), composable, skinnable.

**Layouts / spatial:**

- **`TileGrid<C>`** — 2D grid of cells; cell renderer + interaction callbacks. Pairs with grid-inventory; powers FC arcology layout, dungeon maps, inventory grid, station/floor plans.
- **`HexGrid<C>`** — hex variant for tactical RPG combat grids.
- **`VoronoiInfluenceMap<E>`** — circles-with-radii + intersection lines (per Lord-Raven's prior art; identification pending — see Mining queue). Encodes influence zones / faction territory / NPC awareness radii / threat zones / spatial audio coverage. Genuinely novel; not in standard UI libraries.

  Reference implementation in Lord-Raven's `memoria` repo (`MapScreen.tsx`, d3-weighted-voronoi + SVG + Sutherland-Hodgman clipping). Full analysis in `src/lib/mining/VORONOI.md`.
- **`GraphView<N, E>`** — nodes + edges, force-directed or fixed layout. For world.ts room graphs, faction-relation graphs, dialogue trees, family/lineage trees.

**Entity displays:**

- **`ActorPanel`** — body summary + inventory summary + stat bars. Pairs with Actor (Wave 1).
- **`BodyDiagram`** — display body's slot tags visually (silhouette + per-slot annotation). Pairs with body.ts.
- **`TimelinePanel`** — render Timeline events as scrollable feed with summarization toggles.
- **`RegistryGallery`** — Registry entries as cards (forms, items, abilities).

**Stats / progress:**

- **`StatBar`** + **`StatTier`** — bars, tier displays, threshold markers.
- **`ScoreBoard`** — multi-stat dashboard.

**Interaction:**

- **`SlotPicker`** — for persistence (already planned).
- **`ChoiceList`** — option picker (dialogue choices, action menu).
- **`ModalPicker`** — generic modal wrapper.
- **`FormBuilder`** — form-input for managerial stages.

Parallel-developable with Waves 2A/B/C/D. Some components have natural dependencies on Wave 1 primitives (ActorPanel needs Actor); those ship as their logic primitive lands. UI-only components ship as Wave 1.5 alongside Wave 1.

### Wave 2F — 3D substrate

The library evolves into a chub-stage game engine. Explicit external dependencies on best-in-class JS game libraries, dynamically imported per the modular packaging strategy below.

**Library choices (committed):**

- **3D: React Three Fiber + Three.js.** R3F composes with our React UI primitives natively; mature ecosystem; best TS support.
- **3D physics: `@react-three/rapier` + Rapier (Rust-WASM).** Fast, modern, designed for R3F integration. Clean kinematic-character-controller support.
- **2D physics: extend existing `physics.ts`** for AABB/circle/spatial-hash. Add optional thin wrapper around `planck.js` (modern Box2D port) for stages needing rigid-body 2D simulation.
- **Asset loading: Three.js loaders** wrapped for stage convenience + `Registry<Asset>` pattern (composes with Registry primitive).

**Wave 2F deliverables:**

- `src/lib/3d/scene.tsx` — R3F integration wrapping chub-stage `render()` lifecycle.

  Design owns/exposes/configures split + embedded-context footguns documented in `src/lib/mining/R3F.md`.
- `src/lib/3d/physics.ts` — Rapier world wrapper composing with Shard persistence.
- `src/lib/3d/assets.ts` — asset loader + Registry integration.
- `src/lib/3d/camera-rigs/*.tsx` — common camera rigs: first-person, third-person orbital, top-down, fixed.
- `src/lib/3d/ui/{TileGrid3D,VoronoiInfluenceMap3D,GraphView3D}.tsx` — 3D variants of selected UI primitives.

### Wave 2G — Realtime sensory

- `src/lib/sensory/audio.ts` — Web Audio API wrapped: positional + ambient + music tracks + SFX banks. Howler.js wrap if we hit limitations.
- `src/lib/sensory/input.ts` — unified input abstraction over keyboard/mouse/gamepad/touch. Custom thin layer (nothing dominant in JS ecosystem; ours is small enough to own).
- `src/lib/sensory/particles.ts` — particle system wrapper.
- `src/lib/sensory/post-fx.ts` — post-processing wrapper.

### Wave 2H — Character controllers + AI / pathfinding

Each controller is a pattern, not a primitive; composes input + physics-kinematic-body + camera-rig + animation-state-machine.

Kinematic controller defaults + footgun catalog mined from Rapier docs + community; see `src/lib/mining/RAPIER.md`.

- `src/lib/patterns/controllers/fps.ts` — FPS WASD + mouselook.
- `src/lib/patterns/controllers/third-person.ts` — Souls-like orbital.
- `src/lib/patterns/controllers/top-down.ts` — Hotline Miami / Diablo click-or-WASD.
- `src/lib/patterns/controllers/platformer.ts` — sidescroller momentum.
- `src/lib/patterns/controllers/vehicle.ts` — cars / ships / planes / spacecraft.
- `src/lib/patterns/controllers/cursor.ts` — RTS / point-and-click adventure.

**AI / pathfinding:**

- `src/lib/ai/pathfinding.ts` — navmesh + A* + waypoint graph. Wrap `yuka.js` or similar.
- `src/lib/patterns/behavior-tree.ts` — composer over Fsm + decision nodes.
- `src/lib/ai/perception.ts` — cone-of-vision / hearing radius. Composes with VoronoiInfluenceMap.

### Wave 3 — example stages

All 20 game-shape stages ship in parallel as their dependent waves complete.

- CCA, Zork, HHGTTG ship after Wave 2B.
- CoC, TiTS ship after Wave 2A.
- LT ships after Waves 2A + 2B (needs both world and scene).
- FS ships after Wave 2C (+ partial 2B for world).
- FC ships after Wave 2C.
- Warframe-shape ships after Wave 2D.
- Dungeon-crawler-shape, Walking-sim-shape ship after Waves 2F + 2G + 2H (FPS controller).
- ARPG-shape ships after Waves 2F + 2H (top-down controller) + 2A (combat).
- Souls-shape ships after Waves 2F + 2H (third-person orbital).
- Platformer-shape ships after Waves 2F (planck 2D physics) + 2H (sidescroller controller).
- Spacesim-shape ships after Waves 2F + 2H (vehicle controller).
- RTS-shape ships after Waves 2F + 2H (cursor controller + pathfinding).
- Pregnancy-sim-shape (#17) ships after Wave 2A (scene) + Wave 1.5 (predicate/trigger) + `dailyVignettePattern`.
- Breeding-sim-shape (#18) ships after Wave 1.5 (`procgen.recombine` + predicate/trigger) + Wave 2C.
- Subject-life-sim-shape (#19) ships after Waves 2A + 2B + Wave 1.5 (ConditionalTrigger) + `subjectSandboxPattern`.
- Facility-management-shape (#20) ships after Waves 2B + 2C + 2E (TileGrid) + Wave 1.5 (ConditionalTrigger) + `slotAssignmentPattern` + `spatialPropagationPattern`.

No ordering precedence among examples — each ships when its wave dependencies land. The "smallest goes first" heuristic puts FC and Warframe-shape near the front (Wave 2C / 2D have no new primitives); parser-IF games are last because Wave 2B is the biggest primitive block.

## Modular packaging strategy

Three.js alone is ~600KB; Rapier WASM is ~200KB; eagerly-importing everything is easily 2MB+. Chub-stage bundle constraints favor sensible sizes. Solution: modular packaging via dynamic imports.

- **Core (light, ~100KB):** all logic primitives + UI primitives + persistence. Always imported. No external dependencies beyond React.
- **3D module:** `lib/3d/*` — dynamic-imports R3F + Three. Stages that don't need 3D pay nothing.
- **Physics modules:** `lib/3d/physics` dynamic-imports Rapier; `lib/2d/physics-planck` (optional) dynamic-imports planck.js.
- **Sensory modules:** `lib/sensory/audio` may dynamic-import Howler; `lib/sensory/input` is core-light.
- **AI module:** `lib/ai/*` dynamic-imports pathfinding lib.

Each module's import path is its dependency declaration. Vite handles code-splitting per dynamic-import boundary. The "no external deps" implicit posture from the original `extension-template` is gone; heavy external deps are acceptable when isolated to specific import paths and dynamic-imported.

## Pattern composer catalog

Each `src/lib/patterns/<name>.ts` is 90% wiring + 10% defaults. No private state. No new mechanics. Adding a pattern means adding both the recipe entry in `PATTERNS.md` and the composer file in the same commit.

### Existing-primitive composers (Wave 0 / Wave 1 deps only)

- `inventory.ts` — composes `Inventory` + `observation` + `chub-adapters` + `prose-register` snippet library
- `effects.ts` — composes `EffectStore` + `Stats` + `Scheduler` + `Timeline`
- `turn-combat.ts` — composes `Action` + `combat-turn` + `EffectStore` + `Stats` + `Rng` + `Timeline`
- `realtime-combat.ts` — composes `RealtimeWorld` + `physics` + `Scheduler` + `Rng` + `Timeline`
- `body-transformation.ts` — composes `Body` + `transformation` + `tags` + `snapshots` + `Timeline` + `observation`
- `cyber-slots.ts` — composes `Equipment` + `Body` + `transformation` + `constraints` + `tags` + `observation`
- `physics.ts` — composes `physics` + `Rng` + `observation`
- `dialogue.ts` — composes `Fsm` with say/choices semantics; predicate-gated transitions
- `score.ts` — composes `Stats` + `Timeline`; tier-based unlock conditions
- `faction.ts` — composes `Stats` (reputation = Stat with tier) + content-gate predicate. No primitive needed; reduces.
- `skit.ts` — PARC's Skit shape as composition: scene + observation + outcome-resolution + actor. The "monolith feel" at the import statement; pure composition underneath.
- `sandbox.ts` — composes `world` + `actor` + `intent` + `procgen` for free-roam stages

### Wave-2-dependent composers

- `scene.ts` (Wave 2A) — composes the `scene` primitive + `body` + `actor` + `tag-parser`; the erotic-RPG scene resolver
- `world-exploration.ts` (Wave 2B) — composes `world` + `actor` + `intent` + `observation`
- `bulk-tick.ts` (Wave 2C) — composes `ActorPool` + `Scheduler` + `Timeline`; weekly-tick pattern
- `managerial.ts` (Wave 2C) — composes form-input + `bulk-tick` + `Timeline.summarize`; player-as-ruler

### Warframe-shape composers (Wave 2D)

- `form.ts` — Form-as-character bundle
- `form-collection.ts` — `PlaceholderRegistry<Form>` with unlock progression
- `grafting.ts` — Helminth-style ability transfer
- `puppet.ts` — actor-piloting-actor

### Wave 1.5-dependent composers

- `subjectSandboxPattern` — first-person life-sim sandbox where player IS the subject in a world of NPC relationships. Composes world + actor + scheduler + scene + predicate-triggers + `dailyVignettePattern` + Timeline. Distinct from `sandboxPattern` (free-roam exploration framing — Zelda/Skyrim-style); subject-sandbox is about *life and relationships*, not exploration and combat. Used by Subject-life-sim-shape (#19), Pregnancy-sim-shape (#17), Dating-sim, future life-sim shapes.
- `dailyVignettePattern` — wraps `generate` + `observation` + `Timeline` + `scheduler` to produce one well-grounded vignette per game-day tick, with continuity from past vignettes. Slice-of-life equivalent of `bulkTickPattern`: bulkTick advances many actors in parallel; daily-vignette advances ONE subject deeply through time. Used across the slice-of-life-texture meta-category.
- `slotAssignmentPattern` — "worker X is assigned to room slot Y" relation. Composes ActorPool + Room's assigned-workers list + per-slot constraint predicates + `ConditionalTrigger` for slot-validity. Used by Facility-management-shape (#20), FC-shape (#8) slave job assignments, Warframe-shape (#9) loadout slots, any "assign actor to slot" mechanic.
- `spatialPropagationPattern` — events propagate room-to-room through the world graph: fire spreads to adjacencies, raiders move next-turn, infections jump on contact, panic radiates from incident sites. Composes World graph + ConditionalTrigger + Scheduler tick. Hugely reusable: plague spread (FS-shape), gossip propagation (LT-shape), faction territory shift (LT-shape), contamination (Lobotomy variant of #20), wildfire (any wilderness sandbox).
- `focusPattern` — directs player attention to whatever's currently interesting (a fire, a low-energy worker, an incoming raid, a containment breach). Composes Observation salience + Timeline urgency + UI panels. The "what should the player look at now" mechanic. Used by Facility-management-shape (#20), RTS-shape (#15), FC-shape (#8), any high-action-density managerial stage.
- `lineagePattern` — composer over `procgen.buildGraph` (tree connectivity) + Actor.affinity-with-"parent"-tag for parent-child relationships. Operations like "list descendants," "find common ancestor," "compute inbreeding coefficient" fall out as graph queries. Pattern, not primitive — reduces to Actor + procgen + Graph queries. Used by Breeding-sim-shape (#18), FC-shape (#8), LT-shape (#6, dynasty tracking).

### Synergy patterns — procgen × LLM cooperation

These are the genuinely novel content. Each is a small composer (~30 LOC) plus a paragraph of when-to-use. The library does not prescribe a hybrid framework; the patterns catalog the synergy moves themselves so authors compose them as needed.

- `synergy/llm-narrates-programmatic-tracks.ts` — procgen produces "the combat-outcome roll says you hit for 7"; LLM narrates the hit. `tag-parser` captures any mechanical effects the LLM mentions; reducers apply them.
- `synergy/programmatic-narrates-llm-decides.ts` — LLM picks an action from a constrained menu; procgen renders the deterministic narration. Used for NPC AI where you want LLM personality with deterministic mechanical fidelity.
- `synergy/llm-constrained-by-procgen.ts` — procgen lays the skeleton (room topology, item placement); LLM fills detail within explicit constraints. Used for world generation with mechanical-validity guarantees.
- `synergy/procgen-validates-llm.ts` — LLM proposes content; programmatic invariants check it (loot respects power curve, encounter respects difficulty band). Reject + re-prompt loop. Used for safety-critical generated content.
- `synergy/cache-by-key.ts` — LLM output cached keyed by any structural id. Composes with `PlaceholderRegistry`. Used everywhere a generated thing must be consistent on revisit.
- `synergy/fallback-chain.ts` — deterministic grammar tries first; LLM fallback on parse miss; LLM-with-broader-context on second miss. Used for intent parsing where determinism is preferred but graceful degradation is needed.
- `synergy/seed-from-player.ts` — LLM extracts a seed/spec from the player's free-form input; procgen elaborates from the seed. Used for player-as-author flows.
- `synergy/hierarchical-summarization.ts` — for FC-scale stages: per-actor mini-reports first, then aggregate. Avoids 50k-token prompts. Composes with `Timeline.summarize`.
- `synergy/sliding-window-chat.ts` — pairs the chatWindow primitive (when shipped) with Timeline so that as turns age out of the bounded verbatim window, their relevant content is captured as Timeline events (via tag-parser extraction or LLM summarization). Information persists; verbatim text doesn't. Defaults to a 5–10 turn window; crossing the window forces summarization. The "I want a 200-turn raw history" path requires explicit author opt-in plus a warning in the pattern doc about what it costs.

14 additional synergy pattern candidates mined from SillyTavern / NovelAI / AI Dungeon — see `src/lib/mining/SYNERGY.md`.

### Wave 2I — context curation primitives

- **`src/lib/chat-window.ts`** — bounded recent-turns window. Tracks last N turns verbatim; provides `summarizeOlder` hook for turns rolling out. Implements `ContextContributor` (see below). Tiny primitive (~80 LOC).
- **`src/lib/context.ts`** — composable context construction. The load-bearing prompt-assembly primitive. ~250 LOC.

```ts
interface ContextContributor {
  id: string;
  priority: number;                             // higher = more critical; first to allocate budget
  contribute(ctx: AssemblyContext): Section | null;
}

interface Section {
  id: string;
  content: string;
  tokens: number;                               // estimated
  optional?: boolean;                           // droppable under budget pressure
}

interface AssemblyContext {
  budget: number;
  turnInputMessage?: Message;
  stage: unknown;
}

class ContextAssembler {
  contributors: ContextContributor[];
  budget: number;
  register(c: ContextContributor): void;
  assemble(ctx: AssemblyContext): string;       // priority-allocates; drops optional first under pressure
}
```

Built-in contributors shipped alongside:
- `observationContributor(sources)` — wraps `ObservationSource[]`
- `timelineContributor(timeline, window)` — recent events as summarized text
- `chatWindowContributor(window)` — last N turns verbatim
- `worldStateContributor(world)` (post-Wave 2B)
- `proseRegisterContributor(spec)` — architecture hints
- `systemInstructionsContributor(text)` — stage-author static instructions
- `turnInputContributor()` — the just-received player message

Stages compose contributors via `register`. The assembler handles priority allocation, optional-section drop ordering under budget pressure, deduplication. All existing primitives that produce prompt-bound text (observation, Timeline, prose-register) will gain `ContextContributor` implementations in their Wave 2I update.

Genuinely best-in-class versus existing prompt-engineering frameworks (LangChain templates, LlamaIndex) which are template-based (string-with-placeholders, fill them). Contributor model is more flexible because each contributor knows what it's contributing AND can adjust based on remaining budget.

**Additive extensions (from SYNERGY design pass):** `Section` gains two optional fields:
- `position?: 'top' | 'bottom' | { depth: number }` — where the section is injected relative to other sections
- `role?: 'system' | 'user' | 'assistant'` — chat-role tagging when the LLM provider supports role-tagged messages

Required by `positionalInjectionDepthPattern` documented in `src/lib/design/SYNERGY-EXTENSIONS.md`.

### `src/lib/llm-pipeline.ts` — composable LLM-call envelope (load-bearing for synergy patterns)

Surfaced from the SYNERGY mining run as the AID Scripting `triple-hook-pipeline + quiet-generation-sub-call + state-object` trio. Architecturally distinct from `ContextAssembler` + hooks — it doesn't reduce to existing primitives; it OWNS the wrapper shape (input → context → output → quiet) that threads persistent stage state through every LLM call.

```ts
interface LlmPipeline<S> {
  state: S;
  inputModifier?: (input: string, state: S) => { rewritten: string; stateDelta?: Partial<S> };
  contextModifier?: (context: ContextAssembler, state: S) => void;
  outputModifier?: (output: string, state: S) => { rewritten: string; stateDelta?: Partial<S> };
  quietCall?: (prompt: string, state: S) => Promise<{ result: string; stateDelta?: Partial<S> }>;
}
class LlmPipelineRunner<S> {
  constructor(pipeline: LlmPipeline<S>, generator: GenerationService);
  runTurn(playerInput: string): Promise<TurnResult>;
}
```

The 14 new synergy patterns compose IN this primitive; the existing 8 synergy patterns can optionally be re-expressed within it for stages wanting a unified envelope. Detailed spec in `src/lib/design/SYNERGY-EXTENSIONS.md`. ~250 LOC.

### `src/lib/embeddings.ts` — vector embedding service interface

Surfaced from the SYNERGY mining run as required by `semanticRecallOverlayPattern`. Genuinely new primitive; doesn't reduce to existing primitives.

```ts
interface EmbeddingService {
  embed(text: string): Promise<number[]>;             // returns vector
  embedBatch(texts: string[]): Promise<number[][]>;
  similarity(a: number[], b: number[]): number;       // cosine, typically
}

function localTransformerEmbeddings(modelName?: string): EmbeddingService;  // transformers.js
function apiEmbeddings(opts: { endpoint: string; key?: string }): EmbeddingService;
```

Ships both local-transformer and API-call adapters; stage author picks. Used by `semanticRecallOverlayPattern` and any future RAG-shaped stage. ~120 LOC + transformers.js (lazy-imported, ~5MB on demand).

## Decision audit — things ruled out

This list is closed; each item is permanently not-shipping unless the architectural facts change. "Deferred until a use case" is not present in this list because it is not a valid library-internal reason.

- **Faction primitive** — reduces to Stat-with-tier (reputation) + predicate (gated content) + actor field (representative NPC). Ships as `patterns/faction.ts` composer + one-line `PATTERNS.md` recipe; no primitive.
- **`RelationshipScore<Subject, Object>`** — reduces to `Map<NpcId, Stat>`. The Map is more honest. No primitive.
- **`ConfigSlots` / `VariantSet` / `LoadoutCollection`** — reduces to `Map<string, Config>` + active-key + capacity-number. Struct literal, not primitive. The value of the Warframe slot-economy insight is the *design rule* ("configuration is additive, never subtractive"), not code. Ships as a `PATTERNS.md` one-line recipe ("multiple configs of the same entity? Map with active key. No primitive.") + the design rule in CLAUDE.md north stars.
- **`synthesize.ts` as heavyweight schema-fills-everything primitive** — wrong abstraction. The right primitives are narrower: `procgen.ts` (deterministic) + `generate.ts` (LLM-call with cache). "Generate a whole world from spec" composes from these, not from a unified synthesis primitive.
- **Zod or runtime schema library as a dep** — overshoots. Existing TS types + ad-hoc validation per LLM call are sufficient.
- **Prose-register typed presets** — `PRESET_REGISTERS` const + `RegisterPreset` type cut in the persistence-redesign pass. PARC ships one bool (`disableImpersonation`); user's prompt preset owns POV/tense/distance. Library ships only `ARCHITECTURES` + free-form `RegisterSpec`.
- ~~**React component primitives beyond optional `SlotPicker`**~~ — **REVERSED 2026-05-23.** UI components are now first-class primitives in Wave 2E. The original "library stays logic-shaped" position underestimated how much UI every stage author has to rebuild, violating the comprehensive-everything mandate.
- ~~**Library is logic-shaped only**~~ — **REVERSED 2026-05-23.** Library is logic + UI + 3D/audio/physics runtime substrate. The library evolves into a chub-stage game engine via Waves 2E/F/G/H. Heavy external deps (R3F, Three, Rapier, planck, etc.) are acceptable when isolated to specific import paths and dynamic-imported per the modular packaging strategy.
- **Skit / Module / Actor-as-monolith as monolithic primitives** — each is a pattern over existing primitives. The monolith feel at the import statement is preserved; substance is composition.

## Mining queue

Read-only investigation tasks that should precede their dependent design work.

- **TiTS source + LT source + possibly FoE** — for Scene composition prior art. Required before Wave 2A `scene.ts` design. The most under-theorized axis; only deep prior art exists in (notoriously messy) game sources. Both repos are clone-and-skim, not modify.
- **AI Dungeon + NovelAI + SillyTavern stages + World Engine plugins + Fabula Ultima or similar** — for procgen-LLM synergy patterns and existing structured-generation approaches. Required before expanding the synergy patterns catalog beyond the headline list above.
- **Live Chub host branch behavior** — does the host call `setState` with the prior branch's `messageState` when the user swipes? SDK type doc says "typically yes" but we have no local verification (TestRunner is single-stage with no swipe simulation). Required to confirm `chubTreeHistory` works end-to-end as designed; if not, cursor-tracking fallback sketched in TODO.md.
- **Warframe documentation / wiki for fine-grained Form mechanics** — Helminth specifics, ability scaling rules, mod multiplier stacks — optional but valuable for designing Wave 2D patterns with mechanical fidelity.
- **Lord-Raven's voronoi-influence-map source location** — identify which Lord-Raven stage ships the circles-with-radii + intersection-lines UI component (likely in statosphere or a related stage). Required before Wave 2E `VoronoiInfluenceMap` design; his is the reference implementation.
- **R3F / Three.js best-in-class chub-stage usage** — investigate whether any prior art exists. Likely none — chub-stage with 3D would be novel. If none, design from first principles + R3F best practices outside the chub-stage context.
- **Rapier kinematic character controller patterns + footgun catalog** — read Rapier docs + community examples on kinematic-vs-dynamic character controllers, collide-and-slide, slope handling. Required before Wave 2H controller patterns.

## Status snapshot — 2026-05-23

- Wave 0 complete; all foundational primitives + 8 examples shipped.
- `COMPOSITION.md`, `CLAUDE.md` north stars, `TODO.md` patterns catalog, `REGISTRY.md`, `TIMELINE.md`, `reincarnate/TODO.md` insight all landed.
- Wave 1 (Actor + Procgen + Generate) not yet planned; next durable work after this ROADMAP.
- Branch `main` is ~25 commits ahead of origin; not pushed.
- **Scope expansion 2026-05-23**: Waves 2E (UI), 2F (3D), 2G (sensory), 2H (controllers + AI) added. Game shipping catalog expanded from 9 to 16 shapes. Library is now a chub-stage game engine; modular packaging via dynamic imports keeps core lean.
- **Catalog expansion 2026-05-24**: Game shipping catalog expanded from 16 to 20 shapes. Added catalog taxonomy (atomic / umbrella / composite). Added Wave 1.5 (predicate/trigger + procgen.recombine). Added 6 new pattern composers (subjectSandboxPattern, dailyVignettePattern, slotAssignmentPattern, spatialPropagationPattern, focusPattern, lineagePattern). Added slice-of-life-texture meta-category note.
- **Design pass complete 2026-05-24** — 6 mining reports synthesized into 6 implementation-ready design docs in `src/lib/design/`. Surfaces: `LlmPipeline` and `embeddings.ts` added as Wave 2I primitives; `predicate.ts` gains regex/glob kinds; `context.ts` `Section` gains position/role annotations; scene.ts LOC estimate corrected to 420-480.
- **Implementation wave 2026-05-24** — Waves 2A (Scene primitive + scenePattern), 2E partial (VoronoiInfluenceMap UI primitive — other UI primitives like TileGrid/HexGrid/GraphView/ActorPanel/etc. still pending), 2F partial (ThreeScene R3F wrapper — physics/assets/camera-rigs still pending), and 2I expansion (LlmPipeline primitive + embeddings primitive + 14 synergy pattern composers + predicate.ts regex+glob + context.ts Section position+role) all shipped. ~3000 LOC across primitives, patterns, and pattern docs. Cross-foreman bleed in commit `5e4a95c` (Wave 2I commit accidentally over-included Wave 2E files; both bodies of work are valid, just commit-attributed differently).
- **world-primary pass 2026-05-25** — Three new primitives/patterns landed:
  - `src/lib/intent.ts` — Wave 2B narrow cut. Deterministic verb-noun-prep grammar with synonym table + scope resolution; `LlmFallback.quietCall` fallback on grammar miss. **Status: PARTIALLY LANDED** (full Wave 2B still needs `world.ts` scope integration and Zork/CCA grammar prior art).
  - `src/lib/patterns/render-trigger.ts` — Wave 2I pattern. `renderTrigger({ stub, assembler, runner })` wires trigger-fires → ContextAssembler → LlmPipeline → prose. **Status: SHIPPED**.
  - `src/lib/patterns/freeform-pipeline.ts` — Wave 2I pattern. Full escape-hatch loop: freeform text → intent parse → oracle delta → policy (`strict`/`coerce`; `extend` is TODO) → apply → render. **Status: SHIPPED** (`extend` policy is not implemented; throws with TODO).
  - `src/lib/ui/` shell components — Wave 2E **shell layer** (distinct from game UI components like TileGrid/HexGrid/ActorPanel which remain pending): `WorldStatePanel`, `ActionSurface`, `ScenePane`, `ChatLogSidebar`, `FreeformInput`. **Status: PARTIALLY LANDED** (game UI primitives TileGrid, HexGrid, GraphView, ActorPanel, StatBar, ScoreBoard, ChoiceList, FormBuilder, SlotPicker, ModalPicker, TimelinePanel, RegistryGallery still pending).
  - `examples/world-primary/` — Wave 3 partial. Demonstrates the FRONTEND-SHAPE.md design end-to-end: state machine + ConditionalTrigger + renderTrigger + freeformPipeline + full UI shell. **Status: SHIPPED**.
