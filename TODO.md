# TODO

> *Open threads from previous sessions. Treat as starting context, not
> instructions — verify relevance before acting. The next session serves
> the user, not these threads. The user may want to go in a completely
> different direction, and that's fine.*

## Frontend pivot — next direction the previous session was leaning toward

The previous session worked through three phases in sequence: Wave 1.5
+ 2I keystone primitives shipped, then a 6-source mining round
(SillyTavern/NovelAI/AID synergy, TiTS+LT scene composition, Warframe
Helminth, Lord-Raven voronoi, Rapier controllers, R3F embedded
practices), then 4 parallel implementation waves (Scene primitive,
VoronoiInfluenceMap UI, ThreeScene R3F wrapper, LlmPipeline primitive
+ embeddings + 14 synergy patterns + predicate/context extensions).

The fourth phase the session had queued but did not start: pivot to
"the roleplay frontend that is just good" (see `src/lib/COMPOSITION.md`
final section and `src/lib/ROADMAP.md`). Two sub-flavors are open:

1. **Crescent forward** — port the design (primitives + patterns +
   persistence model + COMPOSITION.md framings) into
   `~/git/rhizone/crescent/` (LuaJIT ecosystem). Tests whether the
   design is genuinely portable past Chub-the-host. See the existing
   "HIGH PRIORITY — Forward designs to Crescent" thread below for what
   likely ports vs what stays chub-specific.

2. **Non-Chub frontend design** — sketch what a standalone roleplay
   frontend looks like (world-state primary, chat-log as side-panel,
   structured input, single-shot prompting). Could be a separate repo,
   a new shape for chub-stage-factory's library, or a planning doc only.

Open question the session did not resolve: is this a fresh-session opus
design exploration, or does it want a mining pass first (SillyTavern
frontend, Risu, Agnaistic, etc. as prior art for roleplay-frontend
shapes)? The pattern this session followed elsewhere — mine first,
design second, implement third — suggests mining first. But the design
intent is largely written down already (`COMPOSITION.md` + `ROADMAP.md`),
so any mining might be quick.

Whichever direction: the previous session recommended starting cold in a
fresh context, drawing on the durable docs rather than this session's
tactical chatter. `src/lib/{README,COMPOSITION,ROADMAP}.md` plus
`CLAUDE.md` north stars are the load-bearing inputs.

## HIGH PRIORITY — Forward designs to Crescent

Once the patterns layer is polished (post-Wave 2D minimum; ideally post-Waves 2E/F/G/H), evaluate forwarding the primitives + patterns + persistence model + COMPOSITION.md framings to `~/git/rhizone/crescent/` (Crescent is the LuaJIT ecosystem; the patterns are language-agnostic and the design intent for a "roleplay frontend that is just good" extends beyond chub-stage-factory).

What likely ports:
- The patterns catalog (composers are conceptual, easily re-expressed in Lua)
- The persistence model (tree-history + shards + reincarnate-derived design)
- The composable-context-construction primitive shape
- The single-shot / chat-poisoning north star
- The decision-audit reductions (Faction, ConfigSlots etc.)

What stays chub-specific:
- StageBase lifecycle binding
- React UI primitives (would need Lua-equivalent UI surface)
- Chub-host-specific persistence backend impls

## Wave 1 follow-ups

- **Investigate centralising `statTiers` on `ActorPool`** — currently `ActorDeps.statTiers` is a `Record<string, TierFn>` keyed by stat name, repeated at every `ActorPool.fromJSON` site. A constructor option holding the same map and propagating into fromJSON would centralize it. Defer the redesign until Wave 3 dogfooding pressure surfaces it as friction.
- **Generative-registry live-LLM verification gap** — Wave 3 examples must exercise `generativeRegistry` end-to-end against live Chub `textGen` to validate the retry-with-augmented-prompt loop. Sibling to the existing `PlaceholderRegistry` live-LLM verification gap.

## PlaceholderRegistry — live-LLM verification gap

`examples/composite-showcase` ships a PlaceholderRegistry demo: the
player emits `<invent>head|torso</invent>`, the stage registers a
placeholder MOD and fires `generator.textGen` to fabricate the real
EquipmentDef, then calls `MODS.replace(id, def)`. Static typecheck
and `build-all-examples` are green. The end-to-end loop (placeholder
appears in available_equip with `pending=true` next turn; replaced
with the real def after the textGen returns; equip works against the
freshly invented mod) needs on-platform verification — the dev
TestStageRunner does not simulate the Chub generator service.

## Persistence — open verification gap

The dev TestRunner (`src/TestRunner.tsx`) runs a stage in isolation and
does **not** simulate Chub's message tree, swipes, or branch navigation.
So the per-branch behavior assumption in `persistence/chub.ts` —
specifically that `setState(messageState)` fires on every swipe / tree
jump and carries the host's per-branch messageState snapshot — is
**unverified locally**. The Chub TypeScript declaration confirms the
intent:

> `setState(state: MessageStateType): Promise<void>` — "This can be
> called at any time, typically after a jump to a different place in the
> chat tree or a swipe."
> (`node_modules/@chub-ai/stages-ts/dist/types/stage.d.ts`)

But "typically" is not a guarantee, and the actual host behavior needs
on-platform smoke tests. Specifically:

1. **inventory example**: take an item via `<take>` tag, then swipe the
   user prompt. Expected: the taken item returns to its spot. If not,
   the chubTreeHistory shard is not getting a fresh setState call.
2. **tits-body example**: drink a tincture, then swipe. Expected: the
   transformation persists (chatState + forbidBranching is canon). This
   should work regardless of setState behavior because chatState is the
   host's responsibility.
3. **composite-showcase**: hit "Save Slot" mid-shop, install something,
   hit "Load Slot". Expected: install undone, slot state restored.

### Fallback if (1) does not behave

If the host does not call setState on branch nav, the chubTreeHistory
shard will silently desync from the host's view. The fallback would be
to inject the cursor's MomentId into the messageState payload itself
(e.g. a `__cursor` key per shard), and on each beforePrompt check
whether the host's last-seen cursor matches our local history's cursor.
A mismatch means a branch jump we missed; we'd navigate the local
history to the host's cursor (or commit a sibling). The infrastructure
(`history.navigate`, `store.navigateAll`) is already in place — only
the cursor-tracking wiring in chub.ts would need to be added.

Filed here because it requires real Chub host behavior to confirm.

## Patterns layer (`src/lib/patterns/`)

See `src/lib/COMPOSITION.md` for the positioning rationale. Summary: every `PATTERNS.md` recipe gets a paired `src/lib/patterns/<name>.ts` callable composer. Ergonomic parity with monolithic frameworks at the import statement; strictly more flexibility underneath.

**Initial composer candidates** (one file per row, paired with the recipe of the same name):

- `src/lib/patterns/inventory.ts` — pending
- `src/lib/patterns/effects.ts` — pending
- `src/lib/patterns/turn-combat.ts` — pending
- `src/lib/patterns/realtime-combat.ts` — pending
- `src/lib/patterns/body-transformation.ts` — pending
- `src/lib/patterns/cyber-slots.ts` — pending
- `src/lib/patterns/physics.ts` — pending
- `src/lib/patterns/scene.ts` — **shipped** (Wave 2A, commit `d9267e8`)
- `src/lib/patterns/world-exploration.ts` — pending (blocked on `world.ts` primitive)
- `src/lib/patterns/dialogue.ts` — pending
- `src/lib/patterns/score.ts` — pending
- `src/lib/patterns/faction.ts` — pending (composes `stats.ts` + content-gate predicate; reduces, no primitive needed)
- `src/lib/patterns/skit.ts` — pending (composes scene + observation + outcome resolution + actor; PARC's Skit shape as composition)
- `src/lib/patterns/sandbox.ts` — pending
- `src/lib/patterns/synergy/*.ts` — 14 composers from Wave 2I expansion
  **shipped** (see `src/lib/patterns/synergy/`; covers
  recursive-key-expansion, positional-injection-depth, inclusion-group-mutex,
  sticky-cooldown-delay-timers, recency-frequency-eviction,
  force-activate-with-budget-cap, subcontext-group-budgeting,
  triplehook-pipeline, quiet-generation-sub-call,
  scripted-quick-reply-macro, semantic-recall-overlay, scheduled-self-check,
  character-filtered-activation, override-slots). The 8 originals named in
  prior planning (llm-narrates-programmatic-tracks,
  programmatic-narrates-llm-decides, llm-constrained-by-procgen,
  procgen-validates-llm, cache-by-key, fallback-chain, seed-from-player,
  hierarchical-summarization) remain documented in PATTERNS.md but have
  not been extracted as `src/lib/patterns/synergy/*.ts` composer files yet
  — could be a small follow-up pass to retrofit them.

Each composer is 90% wiring + 10% defaults; no private state; no new mechanics. The 7-games examples (CCA, Zork, HHGTTG, TiTS-shape, CoC-shape, LT-shape, FS-shape) are downstream of this — they're catalogs of which patterns each game uses.

This work is queued behind: world/actor/intent/scene primitives, the synergy-pattern mining run, and any TiTS/LT prior-art mining for scene composition.

## Game engine substrate

Major scope expansion 2026-05-23: Waves 2E (UI), 2F (3D), 2G (realtime sensory), 2H (character controllers + AI / pathfinding) added to ROADMAP.md. Library is now a chub-stage game engine with modular packaging (dynamic imports per substrate module). Game catalog expanded to 16 shapes including FPS, ARPG, Souls, platformer, spacesim, RTS, walking-sim.

See `src/lib/ROADMAP.md` Waves 2E–2H and Modular packaging strategy.

## Follow-ups from Wave 2A/2E/2F/2I implementation

- **`macro.ts` lift** — `scripted-quick-reply-macro.ts` (Wave 2I) currently embeds inline `MacroStep<S>` union (kinds: `quiet`, `show`, `set`). If future patterns add branching, loops, or nested macros, lift `MacroStep` into top-level `src/lib/macro.ts`. `action.ts` is combat-action-shaped (costs/range/targetFilter/effects) and doesn't cover macro sequencing.
- **`ActorPool.toMap()` / iterator** — Wave 2A scenePattern composer had to manually extract `Map<ActorId, Actor>` from ActorPool. Adding `toMap()` or an iterator method to ActorPool would tidy this.
- **`PriorityHandlerRegistry<E>` extraction candidate** — Wave 2A's `SceneConsequenceRegistry` is a thin sort-then-walk wrapper. If a second use surfaces (e.g., in `bulkTickPattern` or scene-end pipelines elsewhere), extract as a generic primitive.
- **Optional-peer-dep lazy import pattern** — Wave 2I's `embeddings.ts` uses `const specifier = "@xenova/transformers"; import(specifier);` to keep tsc happy when the optional peer dep is absent. Document as the canonical pattern for future modules with optional peer deps. Possibly extract a tiny helper.
- **Wave 2E remaining UI primitives** — TileGrid, HexGrid, GraphView, ActorPanel, BodyDiagram, TimelinePanel, RegistryGallery, StatBar, StatTier, ScoreBoard, SlotPicker, ChoiceList, ModalPicker, FormBuilder need design + implementation. None mined yet beyond voronoi; would need a small mining-or-design pass each (most are conventional React+SVG components).
- **Wave 2F remaining 3D substrate** — `src/lib/3d/physics.ts` (Rapier integration), `src/lib/3d/assets.ts` (Three.js loaders + Registry integration), `src/lib/3d/camera-rigs/*.tsx` (FPS/third-person/top-down/etc. camera rigs distinct from controller patterns), `src/lib/3d/ui/{TileGrid3D,VoronoiInfluenceMap3D,GraphView3D}.tsx` (3D variants). None designed yet beyond ThreeScene.
- **Wave 2D grafting unblock** — `graftingPattern` design exists (`GRAFTING.md`) but depends on `formPattern`, `puppetPattern`, `form-collection.ts` (sibling Wave 2D patterns). Those need design before grafting can be implemented cleanly.
- **Wave 2H controllers unblock** — `CONTROLLERS.md` design exists but depends on `sensory/input.ts` (Wave 2G primitive) for input bindings. Wave 2G needs a design pass first (input abstraction over keyboard/mouse/gamepad/touch).
- **AI/pathfinding (Wave 2H secondary)** — `src/lib/ai/{pathfinding,perception}.ts` + `src/lib/patterns/behavior-tree.ts` not yet designed.
- **Wave 2G sensory** — `audio.ts`, `input.ts`, `particles.ts`, `post-fx.ts` not yet designed.
