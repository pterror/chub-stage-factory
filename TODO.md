# TODO

> *Open threads from previous sessions. Treat as starting context, not
> instructions — verify relevance before acting. The next session serves
> the user, not these threads. The user may want to go in a completely
> different direction, and that's fine.*

End-of-session capture, 2026-05-29. Mined from the prior TODO.md,
DECISIONS.md (§1–§16), `docs/UX-AUDIT-2026-05-27.md` (R1–R12),
`docs/WAVE-2E-DESIGN.md`, `docs/CICD-AUDIT-2026-05-27.md`,
`src/lib/ROADMAP.md`, `STATUS.md`, and code-comment markers
(`TODO`/`FIXME`/`@experimental`). Items verified against the tree where
possible; anything not re-verified this pass is marked `(verify)`.

---

## Blocked on human action

- **`CHUB_AUTH_TOKEN` secret unset → deploy CI hard-fails on every push.**
  `deploy.yml`'s "Confirm CHUB_AUTH_TOKEN is set" step exits 1 when the
  secret is absent — intentional fail-fast (CICD-AUDIT §"Needs human
  input"). Deploy stays red until the repo owner adds `CHUB_AUTH_TOKEN`
  (and optionally `STAGE_ID`) in GitHub repo settings. Deferred by user.
  Unblocks: deployment to Chub + the whole Phase-5 on-platform
  verification chain below.

---

## High priority — orphan risk (built-but-unused)

- **Wave 2E components (14) have no example consumer.** All 14
  introspect-aware UI primitives shipped under `src/lib/ui/` (DECISIONS
  §16, ROADMAP "Wave 2E ✅") but no `examples/*/Stage.tsx` imports any of
  them (ActorPanel, StatBar/StatTier, ScoreBoard, TileGrid, HexGrid,
  GraphView, BodyDiagram, TimelinePanel, RegistryGallery, ChoiceList,
  ModalPicker, FormBuilder, SlotPicker) — confirmed via grep, none
  consumed. Wire concrete consumers: ActorPanel/world-state →
  world-primary; StatBar/ScoreBoard → turn-combat; BodyDiagram →
  tits-body; FormBuilder/SlotPicker → composite-showcase. This is also
  UX-AUDIT R2 (replace JSON dumps with player-facing components) made
  concrete. Without a consumer the components are unverified in a real
  stage and the build:examples gate never exercises them.
- **Wave 2F 3D substrate has no real consumer.** Only `examples/_3d-demo`
  exercises `src/lib/3d/*`; no production (non-underscore) example uses
  it. Either wire a real 3D example or keep `_3d-demo` as the canonical
  demo and say so explicitly. Orphan risk for the entire 3D subsystem.
- **`@experimental` still on the entire `src/lib/3d/*` subsystem.**
  ROADMAP claims Wave 2F un-experimentalized 3D, but `@experimental`
  markers are still present on `3d/scene.tsx`, `3d/loader.tsx`,
  `3d/use-three-handle.ts`, `3d/assets.ts`, `3d/physics.ts`,
  `3d/camera-rigs.tsx`, `3d/use-frame-loop.ts` (confirmed via grep). Doc
  and code disagree — either remove the markers (if Wave 2F is genuinely
  done and `_3d-demo` counts as a caller) or correct the ROADMAP.
- **`embeddings.ts` remains `@experimental` with 0 effective callers.**
  Its only importer (`synergy/semantic-recall-overlay.ts`) itself has 0
  callers (DECISIONS §7 re-audit). Chosen policy: keep until a RAG
  example exists. Track: ship a RAG/semantic-recall example or delete.
  (This is the live half of UX-AUDIT R7 — chat-window.ts was already
  resolved: `@experimental` removed once `sliding-window-chat.ts` landed.)

---

## Bugs & known issues

- **Dev-runner re-render bug.** `src/TestRunner.tsx` uses a manual
  `_refresh()`; button clicks in the dev runner don't trigger a React
  re-render. Production Chub calls `render()` after hooks so prod is
  unaffected — dev-runner only. Flagged by the StageIntrospect agent.
  Fix: have the runner re-render on stage state change (e.g. bump a
  state counter after each lifecycle call) instead of the manual refresh.
- **`world-primary` ActionSurface verbs / FreeformInput are no-ops**
  (UX-AUDIT §3.8, Phase-5 blockers #1/#2). `examples/world-primary/Stage.tsx`
  renders verb buttons whose `onClick` sets a flag and the FreeformInput
  `onSubmit` is empty. With StageIntrospect now shipped (DECISIONS §14
  area, `src/lib/introspect/`), the fix is to route clicks through
  `invokeVerb` / `availableVerbs`. `(verify` current state — some wiring
  may have landed alongside the 2E retrofit). High priority: this is the
  flagship example and the most-visible broken affordance.
- **`world-primary` trigger-resolver signature wrapper** (DECISIONS §N).
  The `getLocation` trigger resolver wraps `worldResolvers(world).getLocation`
  with an `unknown`-actor guard because the trigger resolver API is
  two-arg `(actor: unknown, state: S)` while world is single-arg
  `(actor: string)`. Possible API cleanup: align the two signatures so
  the bridge wrapper isn't needed.
- **`freeformPipeline` "extend" policy is a TODO throw.**
  `src/lib/patterns/freeform-pipeline.ts` (TODO at the policy switch):
  the `extend` sandbox policy was removed from the type (DECISIONS §4)
  but a TODO comment remains for re-adding it if a stage needs it.
  Low priority; decide keep-as-documented vs delete the comment.

---

## Test & CI coverage gaps

- **Unit-test coverage is thin.** Only three suites exist:
  `src/lib/rng.test.ts`, `src/lib/physics.test.ts`,
  `src/lib/3d/assets.test.ts` (confirmed). The 30+ primitives and ~40
  composers in `src/lib/patterns/` are untested. Add focused tests for
  the load-bearing primitives (predicate/trigger evaluation, context
  assembler budget allocation, world graph scope queries, stats/tiers,
  effects kinetics).
- **`3d/assets.test.ts` fails on a `three` optional-peer-dep resolution
  error** (DECISIONS §16). Pre-existing, unrelated to Wave 2E. Either
  install/stub `three` for the test env or skip the suite when the peer
  dep is absent so `bun run test` is clean.
- **`promote-example.mjs` has no CI coverage** (early audit). The promote
  path (strips factory scripts, writes `scripts/deploy.mjs` shim via
  `_deploy-core.mjs`, DECISIONS §2) is never exercised in CI. Add a smoke
  step that promotes one example and asserts the output tree builds.
- **No "first-load contract" assertion** (UX-AUDIT Phase-5 blocker #4).
  No scenario asserts a stage renders non-empty on `load()` with zero
  state. Add `scenarios/<name>.first-load.smoke.json` per example.
- **No deploy-status check command** (UX-AUDIT Phase-5 blocker #3 / R11).
  No `bun run check-deploy`; verifying "did it ship?" needs raw
  `gh run` knowledge. Ship `scripts/check-deploy.mjs` (overlaps R11
  "Phase 2 progress surface": current STATUS task index + last commit +
  last CI status).

---

## Documentation gaps

- **`embeddings.ts` has no module doc** (DECISIONS §11 "Still without
  docs"). No `EMBEDDINGS.md` (confirmed). Write it when embeddings stops
  being experimental, or note it as intentionally undocumented-while-experimental.
- **PATTERNS.md is out of sync with shipped composers** (UX-AUDIT R6,
  Lens-2 RED). ~28 top-level + ~22 synergy composers exist; PATTERNS.md
  recipes still point at raw primitives (e.g. recipe 1 shows raw
  `Inventory`, not `inventoryPattern`) and §0 shows the old
  `PersistenceStore`+`bindStore` ceremony instead of the `withPersistence`
  HOC (DECISIONS §1). Sync pass: one recipe per shipped composer + a
  "use withPersistence" §0 note.
- **README too thin to be a front door** (UX-AUDIT R3). Add what-this-is
  paragraph, a `bun run dev` screenshot/GIF, 5-line quickstart, mention
  `promote-example.mjs` as the exit ramp.
- **`yarn` vs `bun` doc conflict** (UX-AUDIT R5). README/CLAUDE say
  `yarn`; CI + lockfile are `bun`. Pick one (bun) and update README,
  CLAUDE.md, flake.nix; note in DECISIONS.
- **`DESIGN.example.md` worked example** (UX-AUDIT R8). Blank DESIGN.md
  skeleton is high-opacity; a worked example (world-primary reverse-
  engineered) helps Phase-1 authors. `(verify` — `DESIGN.example.md`
  exists at root per `ls`; confirm it's actually populated as the R8
  deliverable rather than a stub).
- **Document three composer return shapes (or unify)** (UX-AUDIT R10).
  `*Bundle` (extracted) vs `ComposedSubsystem<S>` (synergy) vs ad-hoc
  (newly built) — three shapes, no documented discriminant. Write a
  CONVENTIONS.md entry naming when to use which, or unify.

---

## Composer / primitive follow-ups

- **`macro.ts` lift.** `synergy/scripted-quick-reply-macro.ts` embeds an
  inline `MacroStep<S>` union (`quiet`/`show`/`set`). If branching/loops/
  nested macros arrive, lift `MacroStep` to a top-level `src/lib/macro.ts`.
- **`ActorPool.toMap()` / iterator.** `scenePattern` had to hand-extract
  `Map<ActorId, Actor>` from ActorPool; a `toMap()` or iterator would
  tidy this.
- **`PriorityHandlerRegistry<E>` extraction.** Wave 2A's
  `SceneConsequenceRegistry` is a thin sort-then-walk wrapper; extract a
  generic primitive if a second use surfaces.
- **Optional-peer-dep lazy-import helper.** `embeddings.ts` uses
  `const specifier = "@xenova/transformers"; import(specifier)` to keep
  tsc happy when the optional dep is absent. Document as the canonical
  pattern; possibly extract a tiny helper (same shape needed for `three`).
- **Centralize `statTiers` on `ActorPool`.** `ActorDeps.statTiers`
  (`Record<string, TierFn>`) is repeated at every `ActorPool.fromJSON`
  site; a constructor option propagating into fromJSON would centralize
  it. Defer until Wave 3 dogfooding surfaces it as friction.
- **Retrofit the 8 original synergy patterns into the `ComposedSubsystem`
  shape (optional).** The 8 originals (llm-narrates-programmatic-tracks,
  programmatic-narrates-llm-decides, llm-constrained-by-procgen,
  procgen-validates-llm, cache-by-key, fallback-chain, seed-from-player,
  hierarchical-summarization) are shipped; a consistency pass could align
  any that diverge from the synergy `types.ts` contract. `(verify` which,
  if any, still diverge).
- **Composer scaffolding script** (UX-AUDIT R9). `bun run new:composer
  <name>` that stamps the WHAT/WHY/SHAPE header + return-shape stub +
  empty `examples/<name>/` + registry entry. Companion to R6/R10.
- **`chunked` reorg of `src/lib/patterns/`** (UX-AUDIT R12). 28 flat
  composers exceed Miller; group into `world/`, `character/`, `combat/`,
  `world-mech/` (+ existing `synergy/`). Low priority; import churn.

---

## Build / safety

- **`build-example.mjs` interrupt-unsafe** (UX-AUDIT R4, Lens-1 RED).
  Backup/wipe/restore dance around `public/`; a `kill -9` mid-build
  leaves `public/` wiped and can permanently destroy the template on a
  later run. Fix: snapshot to `public/.factory-template/` at scaffold
  time and build from that, never the live `public/`. `(verify` — partly
  mitigated by the `npx`→`bunx` fix in DECISIONS §15, but the data-loss
  hazard itself is separate and likely still open).

---

## Verification gaps (need live Chub host — chained behind CHUB_AUTH_TOKEN)

- **Phase 5 manual browser verification of the composed delegator.**
  Was waiting on the UX audit (now done) — unblocked design-wise, but the
  five Phase-5 blockers (UX-AUDIT) gate it: #1/#2 world-primary no-ops,
  #3 deploy-status, #4 first-load contract, #5 experimental integration
  paths. Clear those + deploy to actually run it.
- **Persistence per-branch behavior unverified locally.** TestRunner
  doesn't simulate Chub's message tree / swipes / branch nav, so the
  `persistence/chub.ts` assumption that `setState(messageState)` fires on
  every swipe/tree-jump is unconfirmed. Smoke tests to run on-platform:
  (1) inventory `<take>` then swipe → item returns; (2) tits-body drink
  then swipe → TF persists; (3) composite-showcase save/install/load →
  install undone. Fallback if (1) fails: inject cursor MomentId into the
  messageState payload (`__cursor` per shard) and reconcile in
  beforePrompt — infra (`history.navigate`, `store.navigateAll`) already
  exists; only chub.ts cursor-tracking wiring needed.
- **PlaceholderRegistry live-LLM loop unverified.** composite-showcase's
  `<invent>` → placeholder MOD → `generator.textGen` → `MODS.replace`
  loop typechecks and builds but the end-to-end (placeholder appears
  `pending=true` next turn, replaced after textGen, equip works) needs
  the real Chub generator service.
- **Generative-registry live-LLM gap.** Wave 3 examples must exercise
  `generativeRegistry` end-to-end against live Chub `textGen` to validate
  the retry-with-augmented-prompt loop. Sibling to the PlaceholderRegistry
  gap above.

---

## Future waves / game-shapes (ROADMAP-derived, lower priority)

Most composers exist; what's missing is **example stages** demonstrating
each game-shape. From ROADMAP "Shipping catalog — 20 game-shapes", all
Wave-3 pending:

- **IF axis (after Wave 2B):** CCA-shape, Zork-shape, HHGTTG-shape.
- **Erotic-RPG axis (after Wave 2A):** CoC-shape, TiTS-shape; LT-shape
  (needs 2A+2B).
- **Managerial axis (after Wave 2C):** FC-shape, FS-shape.
- **Warframe-shape (after Wave 2D):** form/grafting/puppet composers
  exist; needs the example.
- **Slice-of-life axis (after Wave 1.5 + 2A):** Pregnancy-sim,
  Breeding-sim, Subject-life-sim, Facility-management (#17–#20).
- **3D game-shapes (after 2F+2G+2H):** Dungeon-crawler, ARPG, Souls,
  Platformer, Spacesim, RTS, Walking-sim (#10–#16).

Remaining `💭` / unbuilt substrate the 3D shapes depend on:

- **Wave 2F remainder.** `3d/camera-rigs/*` distinct from controller
  patterns, `3d/ui/{TileGrid3D,VoronoiInfluenceMap3D,GraphView3D}.tsx`.
  (Note: `3d/physics.ts`, `3d/assets.ts`, `3d/controllers.tsx`,
  `3d/camera-rigs.tsx` now exist — see the `@experimental` item above;
  `(verify` what of the original 2F list is genuinely still missing).
- **Wave 2G — sensory.** `sensory/{audio,input,particles,post-fx}.ts`
  not yet designed. `input.ts` blocks Wave 2H controllers.
- **Wave 2H — controllers + AI.** `patterns/controllers/{fps,third-person,
  top-down,platformer,vehicle,cursor}.ts` (CONTROLLERS.md design exists,
  blocked on 2G `input.ts`); `ai/{pathfinding,perception}.ts` +
  `patterns/behavior-tree.ts` not designed.
- **`focusPattern`** — `(verify`: ROADMAP §16 marks it SHIPPED at
  `patterns/lifecycle/focus.ts`; DECISIONS §13 earlier said unshipped.
  Trust ROADMAP (newer) but confirm the file exists.

---

## Direction threads (carry-over; not tasks)

- **Frontend pivot** — "the roleplay frontend that is just good." Two
  open sub-flavors: (1) port the design into `~/git/rhizone/crescent/`
  (LuaJIT) to test portability past Chub; (2) sketch a standalone
  non-Chub roleplay frontend (world-state primary, chat as side-panel,
  structured input, single-shot prompting). Prior session leaned toward a
  fresh-session opus pass, possibly a quick mining pass first (SillyTavern
  frontend, Risu, Agnaistic). Load-bearing inputs:
  `src/lib/{README,COMPOSITION,ROADMAP}.md` + CLAUDE.md north stars.
- **Forward designs to Crescent.** Once the patterns layer is polished,
  evaluate forwarding primitives + patterns + persistence model +
  COMPOSITION.md framings to Crescent. Ports: patterns catalog,
  persistence model, composable-context-construction, single-shot north
  star, decision-audit reductions. Stays chub-specific: StageBase
  lifecycle, React UI primitives, chub-host persistence backends.
- **Mining queue** (ROADMAP): live Chub host branch behavior; Warframe
  wiki for Form mechanics; remaining scene prior-art (TiTS/LT/FoE) if
  scene composition needs deepening.

---

## Recently completed (excluded from the lists above; context only)

- Wave 2E — all 14 UI components shipped + barrel + ActionSurface
  introspect retrofit (DECISIONS §16). [orphan-consumer follow-up above]
- 33 composers + `world.ts` primitive (DECISIONS §13).
- `world-primary` migrated to `world.ts` (DECISIONS §N).
- StageIntrospect interface + INTROSPECT.md (DECISIONS §14).
- Lint enabled in CI + `@typescript-eslint` plugin (DECISIONS §9, §12).
- vitest + canary test (DECISIONS §10); 23 module docs (DECISIONS §11).
- `withPersistence` HOC; all 8 examples use it (DECISIONS §1).
- `scheduler.ts` deleted; `freeform-pipeline` "extend" removed from type
  (DECISIONS §3, §4); GENERATE.md corrected (§5).
- deploy.yml modernized: checkout@v4 + setup-bun@v2 + bun (CICD-AUDIT).
- `chat-window.ts` un-experimentalized; `sliding-window-chat.ts` +
  `focusPattern` shipped (ROADMAP §15/§16). `embeddings.ts` still
  experimental — see High-priority list.
- `build:examples` mandatory-verification rule + `npx`→`bunx` fix
  (DECISIONS §15).
- UX-AUDIT R1 (StageIntrospect) shipped.
