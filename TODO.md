# TODO

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

- `src/lib/patterns/inventory.ts`
- `src/lib/patterns/effects.ts`
- `src/lib/patterns/turn-combat.ts`
- `src/lib/patterns/realtime-combat.ts`
- `src/lib/patterns/body-transformation.ts`
- `src/lib/patterns/cyber-slots.ts`
- `src/lib/patterns/physics.ts`
- `src/lib/patterns/scene.ts` (after `scene.ts` primitive lands)
- `src/lib/patterns/world-exploration.ts` (after `world.ts` primitive lands)
- `src/lib/patterns/dialogue.ts`
- `src/lib/patterns/score.ts`
- `src/lib/patterns/faction.ts` (composes `stats.ts` + content-gate predicate; reduces, no primitive needed)
- `src/lib/patterns/skit.ts` (composes scene + observation + outcome resolution + actor; PARC's Skit shape as composition)
- `src/lib/patterns/sandbox.ts`
- `src/lib/patterns/synergy/llm-narrates-programmatic-tracks.ts`
- `src/lib/patterns/synergy/programmatic-narrates-llm-decides.ts`
- `src/lib/patterns/synergy/llm-constrained-by-procgen.ts`
- `src/lib/patterns/synergy/procgen-validates-llm.ts`
- `src/lib/patterns/synergy/cache-by-key.ts`
- `src/lib/patterns/synergy/fallback-chain.ts`
- `src/lib/patterns/synergy/seed-from-player.ts`

Each composer is 90% wiring + 10% defaults; no private state; no new mechanics. The 7-games examples (CCA, Zork, HHGTTG, TiTS-shape, CoC-shape, LT-shape, FS-shape) are downstream of this — they're catalogs of which patterns each game uses.

This work is queued behind: world/actor/intent/scene primitives, the synergy-pattern mining run, and any TiTS/LT prior-art mining for scene composition.

## Game engine substrate

Major scope expansion 2026-05-23: Waves 2E (UI), 2F (3D), 2G (realtime sensory), 2H (character controllers + AI / pathfinding) added to ROADMAP.md. Library is now a chub-stage game engine with modular packaging (dynamic imports per substrate module). Game catalog expanded to 16 shapes including FPS, ARPG, Souls, platformer, spacesim, RTS, walking-sim.

See `src/lib/ROADMAP.md` Waves 2E–2H and Modular packaging strategy.
