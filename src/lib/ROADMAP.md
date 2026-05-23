# ROADMAP

## What this is

The library's design direction. Reflects design decisions through 2026-05-23. Companion to:

- `README.md` — current state of primitives + rules.
- `COMPOSITION.md` — patterns-as-first-class positioning rationale + "imagine X, but infinite" pitch.
- `PATTERNS.md` — current recipe catalog.
- `CLAUDE.md` (repo root) — north stars frontloaded into every Claude Code session.

Read those first; this doc adds: the game shipping catalog, the dependency-driven wave plan, the decision audit, the pattern composer catalog, the synergy-pattern catalog, and the mining queue.

This doc is forward-looking. As waves ship, move completed items from upcoming sections into Wave 0 / shipped lists and update the status snapshot at the bottom. Do NOT delete completed items — the historical decision-record is part of the value.

## North stars (brief; full text in CLAUDE.md)

1. *Imagine X, but infinite.* — content-bounded classics → content-unbounded shapes-of-classics.
2. Composition strictly dominates monolithic frameworks. Every "thing" is either a primitive or a pattern.
3. Supply-driven, not demand-driven. "Deferred until a use case" is invalid library reasoning.
4. Provenance-neutral primitives, synergy-rich patterns. Procgen + LLM compose without prescription.

Two design rules surfaced during the Warframe-shape discussion:

5. **Configuration is additive, never subtractive.** Saving a build never costs you another build. Switching configurations is mechanically free by default. If a stage wants to impose currency / cooldown / narrative friction on customization, it does so explicitly; the library never imposes it.
6. **Named-in-source-game ≠ earns-a-primitive.** Things have names in the games we're modeling (`Faction`, `Module`, `Skit`, `Form`, `ConfigSlots`); that does not mean each gets a primitive slot. The reduction test always applies.

## Shipping catalog — 9 game-shape examples

Each is a Chub-deployable stage whose worlds, characters, and content are generated on demand by LLM + procgen rather than authored once. The tagline is the audience-facing pitch and ships in the stage's `chub_meta.yaml` + `README.md`.

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

### Wave 2A — erotic-RPG axis

- **`src/lib/scene.ts` — combinatoric action composition.** `(actor, target, verb) → outcome` where outcome depends on actor's parts × target's parts × consent × pose × intensity × items-in-scope. Extension of `action.ts` with a richer target/effect resolver that knows body tags and partner state. ~200 LOC.
- **`src/lib/patterns/scene.ts` — `scenePattern` composer.**

Enables CoC-shape, TiTS-shape, LT-shape. **Mining required first** (see Mining queue): TiTS source + LT source + possibly FoE for scene-resolver prior art. Scene composition is the most under-theorized axis; only deep prior art exists in (notoriously messy) game sources.

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

Parallel-developable with Waves 2A, 2B, 2C.

### Wave 3 — example stages

All 9 game-shape stages ship in parallel as their dependent waves complete.

- CCA, Zork, HHGTTG ship after Wave 2B.
- CoC, TiTS ship after Wave 2A.
- LT ships after Waves 2A + 2B (needs both world and scene).
- FS ships after Wave 2C (+ partial 2B for world).
- FC ships after Wave 2C.
- Warframe-shape ships after Wave 2D.

No ordering precedence among examples — each ships when its wave dependencies land. The "smallest goes first" heuristic puts FC and Warframe-shape near the front (Wave 2C / 2D have no new primitives); parser-IF games are last because Wave 2B is the biggest primitive block.

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

## Decision audit — things ruled out

This list is closed; each item is permanently not-shipping unless the architectural facts change. "Deferred until a use case" is not present in this list because it is not a valid library-internal reason.

- **Faction primitive** — reduces to Stat-with-tier (reputation) + predicate (gated content) + actor field (representative NPC). Ships as `patterns/faction.ts` composer + one-line `PATTERNS.md` recipe; no primitive.
- **`RelationshipScore<Subject, Object>`** — reduces to `Map<NpcId, Stat>`. The Map is more honest. No primitive.
- **`ConfigSlots` / `VariantSet` / `LoadoutCollection`** — reduces to `Map<string, Config>` + active-key + capacity-number. Struct literal, not primitive. The value of the Warframe slot-economy insight is the *design rule* ("configuration is additive, never subtractive"), not code. Ships as a `PATTERNS.md` one-line recipe ("multiple configs of the same entity? Map with active key. No primitive.") + the design rule in CLAUDE.md north stars.
- **`synthesize.ts` as heavyweight schema-fills-everything primitive** — wrong abstraction. The right primitives are narrower: `procgen.ts` (deterministic) + `generate.ts` (LLM-call with cache). "Generate a whole world from spec" composes from these, not from a unified synthesis primitive.
- **Zod or runtime schema library as a dep** — overshoots. Existing TS types + ad-hoc validation per LLM call are sufficient.
- **Prose-register typed presets** — `PRESET_REGISTERS` const + `RegisterPreset` type cut in the persistence-redesign pass. PARC ships one bool (`disableImpersonation`); user's prompt preset owns POV/tense/distance. Library ships only `ARCHITECTURES` + free-form `RegisterSpec`.
- **React component primitives beyond optional `SlotPicker`** — UI is the stage author's concern; library stays logic-shaped.
- **Skit / Module / Actor-as-monolith as monolithic primitives** — each is a pattern over existing primitives. The monolith feel at the import statement is preserved; substance is composition.

## Mining queue

Read-only investigation tasks that should precede their dependent design work.

- **TiTS source + LT source + possibly FoE** — for Scene composition prior art. Required before Wave 2A `scene.ts` design. The most under-theorized axis; only deep prior art exists in (notoriously messy) game sources. Both repos are clone-and-skim, not modify.
- **AI Dungeon + NovelAI + SillyTavern stages + World Engine plugins + Fabula Ultima or similar** — for procgen-LLM synergy patterns and existing structured-generation approaches. Required before expanding the synergy patterns catalog beyond the headline list above.
- **Live Chub host branch behavior** — does the host call `setState` with the prior branch's `messageState` when the user swipes? SDK type doc says "typically yes" but we have no local verification (TestRunner is single-stage with no swipe simulation). Required to confirm `chubTreeHistory` works end-to-end as designed; if not, cursor-tracking fallback sketched in TODO.md.
- **Warframe documentation / wiki for fine-grained Form mechanics** — Helminth specifics, ability scaling rules, mod multiplier stacks — optional but valuable for designing Wave 2D patterns with mechanical fidelity.

## Status snapshot — 2026-05-23

- Wave 0 complete; all foundational primitives + 8 examples shipped.
- `COMPOSITION.md`, `CLAUDE.md` north stars, `TODO.md` patterns catalog, `REGISTRY.md`, `TIMELINE.md`, `reincarnate/TODO.md` insight all landed.
- Wave 1 (Actor + Procgen + Generate) not yet planned; next durable work after this ROADMAP.
- Branch `main` is ~25 commits ahead of origin; not pushed.
