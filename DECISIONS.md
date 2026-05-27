<!-- DECISIONS.md — audit-remediation pass, 2026-05-25 -->
<!-- Each H2 section = one audit item. Append new sections here. -->

## 1. `withPersistence` HOC

`withPersistence` is a class-factory HOC (not a mixin or base-class override) that wraps `StageBase` and delegates the three repeated lifecycle methods — `load`, `setState`, `beforePrompt`, `afterResponse` — to a caller-supplied `PersistenceStore` + `ChubLayers`. `effects` uses `this.pStore` / `this.bound` naming but is otherwise the standard shape and was migrated in the initial pass.

### Initial limitation (now fixed)

The original HOC hardcoded `initState: null` in its `load()` return and sourced `chatState` only from `bound.initial()`. This blocked three examples that seed an `initState` shard or carry a non-null `chatState` (`physics`, `realtime-combat`, `composite-showcase`) — they read `this.layers.mirror` directly after calling `bound.initial()`, bypassing the HOC.

### Extension — mirror-read in `load()`

After `store.load()` + `bound.initial()`, all three layer mirrors (`initState`, `chatState`, `messageState`) are populated from whatever shards the constructor wired up. The fix: read all three from `this.layers.mirror` in the HOC's `load()` instead of hardcoding `null`. No new method, no config knob, no second HOC — the HOC already held `this.layers`.

```ts
// HOC load() — after this fix:
await this.store.load();
await this.bound.initial();
return {
  success: true, error: null,
  initState: (this.layers.mirror.initState as I | null) ?? null,
  chatState: (this.layers.mirror.chatState as C | null) ?? null,
  messageState: (this.layers.mirror.messageState as M | null) ?? null,
};
```

Examples that use only `messageStateBackend` shards see `initState: null` and `chatState: null` as before — no behaviour change.

### Result

All 8 examples now use the composer. None declare `store`, `bound`, `load`, or `setState` locally.

## 2. Script consolidation (promote-example)

The inlined deploy script at `scripts/promote-example.mjs:236-269` is a third copy of the same zip-and-curl logic. The template string is replaced with a redirect shim: after stripping factory scripts, `promote-example.mjs` writes a `scripts/deploy.mjs` into the output directory that delegates to a small shared helper extracted into `scripts/_deploy-core.mjs`. `deploy-example.mjs` and the new `deploy.mjs` both import from that helper, collapsing three copies to one. CLI surface and CI invocations are unchanged.

## 3. `scheduler.ts` — deleted

Zero callers in `src/` and `examples/` at the time of the audit (the `effects` example imported it but did not use it after migration). `REFERENCE.md` mentions the class; that section is removed. `PATTERNS.md` references it in code-snippet examples; those are kept as documentation (they are not runtime imports). The file itself is deleted.

## 4. `freeform-pipeline.ts` `"extend"` policy removed from type

`SandboxPolicy = "strict" | "coerce"` — `"extend"` dropped. The `throw new Error(...)` early-return branch is removed. The file-header comment listing policies is updated to match. No caller in the repo passed `"extend"`.

## 5. `GENERATE.md` — corrected to match `generate.ts`

The doc showed `return null` on parse failure. The actual code (`generate.ts`) throws `Error("generate: schema validation failed after ${retries} attempts (${lastError})")` after exhausting retries. The doc is updated to show the actual throw and the recommended try/catch pattern for callers who want null-on-failure semantics.

---

<!-- Docs/CI/meta pass — 2026-05-25 -->

## 6. Error-handling convention

**Decision:** Option A — throw on programmer error; return null on absent data. No `console.warn` as a control-flow primitive.

Rule documented in `src/lib/CONVENTIONS.md`. No code changes in this pass — convention is forward-looking; existing violations noted in the doc.

## 7. Under-integrated primitives marked `@experimental`

**Decision:** Option C — honest about ship status; defers integrate-vs-delete.

`// @experimental — used by 0-1 callers; API may change.` added to:

| File | Caller count | Notes |
|------|-------------|-------|
| `src/lib/trigger.ts` | 1 (freeform-pipeline.ts) | marked |
| `src/lib/chat-window.ts` | 0 | marked |
| `src/lib/embeddings.ts` | 0 | marked |
| `src/lib/generate.ts` | 1 (freeform-pipeline.ts) | marked |
| `src/lib/3d/scene.tsx` | 0 external callers | marked |
| `src/lib/3d/loader.tsx` | 0 external callers | marked |
| `src/lib/3d/use-three-handle.ts` | 0 external callers | marked |

`scheduler.ts` — skipped (deleted by parallel agent, item 3 above).
`timeline.ts` — **skipped**: grep found 4 callers (scene.ts, patterns/scene.ts, context.ts, patterns/synergy/semantic-recall-overlay.ts), which exceeds the 0-1 threshold. Audit claim was incorrect; not marked.

### Corrected caller counts (re-audit pass, 2026-05-27)

The prior audit undercounted callers for `trigger.ts` and `generate.ts` by excluding `.tsx` files
and example stages. Actual callers in `.ts`/`.tsx` production code:

| File | Prior count | Actual callers | Re-classified |
|------|-------------|----------------|---------------|
| `src/lib/trigger.ts` | 1 | 2 (`examples/world-primary/Stage.tsx` + `src/lib/patterns/freeform-pipeline.ts`) | `@experimental` removed |
| `src/lib/generate.ts` | 1 | 2 (`examples/world-primary/Stage.tsx` + `src/lib/patterns/freeform-pipeline.ts`) | `@experimental` removed |
| `src/lib/chat-window.ts` | 0 | 0 (docs only) | kept `@experimental` |
| `src/lib/embeddings.ts` | 0 | 1 (`src/lib/patterns/synergy/semantic-recall-overlay.ts`) but that file itself has 0 callers | kept `@experimental` |
| `src/lib/3d/scene.tsx` | 0 | 0 | kept `@experimental` |
| `src/lib/3d/loader.tsx` | 0 | 0 | kept `@experimental` |
| `src/lib/3d/use-three-handle.ts` | 0 | 0 | kept `@experimental` |

## 8. ROADMAP status markers

**Decision:** Option C — add ✅/🚧/💭 markers per item; no restructure.

File: `src/lib/ROADMAP.md` — Pattern composer catalog section updated.

Pattern file verification (`src/lib/patterns/`):
- `scene.ts` — exists → ✅
- `freeform-pipeline.ts` — exists → ✅
- `render-trigger.ts` — exists → ✅
- All other listed composers — not present in `src/lib/patterns/` → 💭

Wave roadmap and shipping catalog: all Wave 0 items confirmed shipped per status snapshot → ✅.
All Waves 1–3 items marked as "Wave N pending" in the table → 🚧 or 💭 per whether design work has begun.

## 9. CI improvements

**Decision:** Option A — add lint, test:smoke, build:examples, test steps to `.github/workflows/build-examples.yml`.

Changes: switched from `yarn install` to `bun install --frozen-lockfile`; added `bun run test`,
`bun run test:smoke`, `bun run build:examples` steps.

`bun run lint` **enabled** (commit `067d88d`): `@typescript-eslint/eslint-plugin@^7.18.0` added,
all surfaced errors fixed, and `bun run lint` wired into CI before `bun run test`. Rules disabled
or overridden: `@typescript-eslint/no-explicit-any` off for five structural delegation wrappers;
`react-refresh/only-export-components` off for all `examples/*/Stage.tsx` and runner files
(required Chub Stage pattern); `react-hooks/exhaustive-deps` off for runner files and
`voronoi-influence-map.tsx` (deliberate dep arrays). See § 12 for the full per-file fix log.

## 10. Vitest setup + canary test

**Decision:** Option C — add vitest, one canary test in `src/lib/rng.test.ts`, no broader sweep.

- `vitest` added as dev dependency via `bun add -d vitest`.
- `"test": "vitest run"` added to `package.json` scripts.
- `src/lib/rng.test.ts` covers: `weightedPick` determinism with seeded stream, `weightedPick([])` throws, `pick` uniform-ish distribution.
- CI: `bun run test` step added.

## 11. Missing module docs — completed (23 modules)

Docs were written across three commits (`6584ad3`, `2bd2556`, `720a9d0`), covering all
high-priority modules identified in the original inventory:

`action.ts`, `body.ts`, `chub-adapters.ts`, `classifier.ts`, `combat-realtime.ts`,
`combat-turn.ts`, `constraints.ts`, `effects.ts`, `equipment.ts`, `fsm.ts`,
`grid-inventory.ts`, `inventory.ts`, `observation.ts`, `physics.ts`, `prose-register.ts`,
`replay.ts`, `rng.ts`, `snapshots.ts`, `stats.ts`, `tag-parser.ts`, `tags.ts`,
`transformation.ts`, and the `3d/` subsystem (`3d/README.md`).

### Still without docs

- `embeddings.ts` — @experimental, 0 callers; no doc written
- `chat-window.ts` — @experimental, 0 callers; covered by existing `CHAT-WINDOW.md`
- `ui/voronoi-utils.ts` — internal helper; covered by `UI-VORONOI.md`

---

<!-- Lint + @experimental re-audit pass — 2026-05-27 -->

## 12. Lint: `@typescript-eslint/eslint-plugin` added; CI enabled

**Decision:** Add `@typescript-eslint/eslint-plugin@^7.18.0` (matching parser major), fix all
surfaced errors, disable rules only where the pattern is structural and judgment would be required.

### Fixed directly

| Location | Issue |
|----------|-------|
| `examples/realtime-combat/Stage.tsx` | Removed unused `RealtimeCombatant` import |
| `src/TestRunner.tsx` | Renamed `factory`→`_factory`, `refresh`→`_refresh`, `delayedTest`→`_delayedTest`; suppressed `@ts-ignore` with eslint-disable |
| `src/runner/mocks.ts` | Changed `no-require-imports` disable comments to `no-var-requires` (rule renamed in plugin v7) |
| `src/lib/3d/scene.tsx` | Removed stale `no-console` eslint-disable comment |
| `src/lib/persistence/with-persistence.ts` | Removed unused `InitialData` import |
| `src/runner/main.tsx` | Removed unused `useEffect` import |
| `src/runner/IframeHost.tsx` | Removed unused `OutboundMessage`, `OutboundMessageType` imports |
| `src/lib/ui/voronoi-influence-map.tsx` | Changed `let voronoiPolygons` to `const`; removed dead `t` alias; converted `RAF_SETTLE_THRESHOLD` to comment; renamed `onEntityDeactivate` to `_onEntityDeactivate` |
| `src/lib/patterns/synergy/quiet-generation-sub-call.ts` | Removed unused `<S>` type param from `QuietState` (not referenced in body) |
| `vite.config.ts` | Removed unused `command` from config destructure |
| `examples/_test-counter/Stage.tsx` | Added per-line eslint-disable for structural `any` cast |
| `src/lib/equipment.ts` | Added per-line eslint-disable for structural `any` cast |

### Configured via `.eslintrc.cjs`

- `@typescript-eslint/no-unused-vars`: configured to ignore `_`-prefixed identifiers
  (handles intentional unused params like `_msg`, `_ctx`, `_now`, `_state`, `_id`)
- `@typescript-eslint/no-explicit-any`: disabled for `src/Stage.tsx`,
  `src/composition/CompositionRunner.ts`, `src/composition/merge.ts`,
  `src/lib/persistence/chub.ts`, `src/lib/persistence/store.ts` — these are intentional
  untyped delegation wrappers over generic `StageBase<I,C,M,Config>` type parameters.
- `react-refresh/only-export-components`: disabled for `examples/*/Stage.tsx` and runner files
  — Chub Stage files structurally export one class alongside React helpers in one file.
- `react-hooks/exhaustive-deps`: disabled for runner files and `voronoi-influence-map.tsx`
  — dep arrays are deliberately incomplete (`addEntry` is stable by construction;
  `hoverConfig`/`entryConfig` wrapping in `useMemo` deferred to avoid changing animation
  behaviour in this pass).

## 13. Composer build pass — 33 composers + world primitive (2026-05-27)

### Summary

Six parallel agent batches shipped 33 composer files + `src/lib/world.ts`. No TSC errors were present at reconciliation time — `bun run build`, `bun run lint`, `bun run test`, and `bun run test:smoke` all passed cleanly. Agents reported "pre-existing TSC errors in files written by other concurrent agents" during development, but these resolved by the time the branches were merged; no agent-introduced type errors survived into the final tree.

### LOC totals

| Group | Files | LOC |
|-------|-------|-----|
| `src/lib/world.ts` | 1 | 360 |
| `src/lib/patterns/*.ts` (28 composers, excl. scene/freeform/render-trigger) | 28 | ~4247 |
| `src/lib/patterns/synergy/*.ts` (8 new patterns) | 8 | ~1767 total for all 22 synergy files |
| Total new composer + primitive LOC | ~39 files | ~6374 |

### Extracted vs newly built

**Extracted** (lifted from existing examples into dedicated pattern files):
`inventory.ts`, `effects.ts`, `turn-combat.ts`, `body-transformation.ts` — these were inline in the example stages; the batch extracted them to `src/lib/patterns/` without changing behavior.

**Newly built** (net-new pattern files, no prior implementation):
All other 29 composers — cyber-slots, physics, realtime-combat, dialogue, score, faction, skit, lineage, bulk-tick, managerial, form, form-collection, grafting, puppet, daily-vignette, sandbox, world-exploration, subject-sandbox, slot-assignment, spatial-propagation, and the 8 synergy patterns.

### Three batch-2b synthesis flag resolutions

**1. `grafting.ts` `subsume` semantics** — GRAFTING.md is unambiguous: `subsume` permanently adds a form's ability to the learned library; it is *not* a learn-from-scratch operation. The implementation in `grafting.ts` matches: `subsume(formId, abilityId)` checks the form exists (non-placeholder) and registers the ability in `learnedLibrary`. It does not extract the ability from the form object; the caller is expected to have already seeded `learnedLibrary` with the `AbilityDef`. This is documented in the JSDoc: "Mark as subsumed — noop if already present (subsume is idempotent)." No change needed; semantics confirmed.

**2. `managerial.ts` ↔ `bulk-tick.ts` signature** — Batch 2b assumed `bulkTick` had shape `(pool, now, advance) => Event[]`. Actual `bulkTickPattern` shape is `BulkTickBundle<E>` with `tick(now?)` on the returned bundle; `processActor` is provided at construction time. `managerial.ts` was written with its own inline tick loop (`pool.forEach` over `init.advance`) rather than delegating to `bulkTickPattern`. This is architecturally correct: `managerial.ts` composes *over* the bulk-tick concept independently rather than depending on `bulk-tick.ts` as a peer. No API mismatch; no shim needed.

**3. `form.ts` `effectiveDef` eager vs lazy** — `FormConfig.effectiveDef` in `grafting.ts` is populated eagerly at inject time (`helminthed = helminthVersion(abilityDef)` called immediately). GRAFTING.md does not prescribe lazy vs eager; the eager approach is simpler and sufficient because `helminthVersion` is a pure transform over an immutable `AbilityDef`. If a stage needs per-cast recomputation (e.g., scaling based on current stats), it calls `abilityScaling` at dispatch time, not `effectiveDef`. Decision: **eager** is correct; `effectiveDef` represents the grafted form at injection time, not at cast time.

### What remains unimplemented or stubbed

- `focusPattern` — not shipped; no `src/lib/patterns/focus.ts`. Still 💭 in ROADMAP.
- `synergy/sliding-window-chat.ts` — not shipped; depends on `chat-window.ts` having callers.
- Wave 2E game UI components (TileGrid, HexGrid, GraphView, ActorPanel, etc.) — pending.
- Wave 2F physics/assets/camera-rigs — pending.
- `freeformPipeline` `"extend"` policy — removed (was a TODO throw; see decision §4).

## N. `world-primary` migrated to `world.ts`

Wave 2B `world.ts` (graph of rooms + scope queries) was landed in 2026-05-27.
`examples/world-primary/Stage.tsx` has been migrated:

- `LOCATIONS` literal replaced with `new World()` + `.addRoom()` + `.connect()`.
- NPCs and items placed via `world.locate(entityId, roomId)`.
- Manual scope-Set construction replaced with `world.scope("player", { includeCarried })`.
- `intent.verb === "go"` routed through `world.move("player", direction)`.
- Room validation in `validateDelta`/`coerceDelta` uses `world.getRoom()`.
- `applyDelta` syncs `world.locate("player", newLocationId)` alongside `ms.locationId`.
- Trigger `getLocation` resolver wraps `worldResolvers(world).getLocation` with an `unknown` actor guard (trigger resolver API is two-arg `(actor: unknown, state: S)`, world is single-arg `(actor: string)`).
- `deriveVerbs` uses `world.exitsFrom()` + `world.entitiesAt()` filtered by `NPC_IDS`/`ITEM_IDS` sets.
- `synonyms.nouns` built from `world.rooms()` instead of `Object.values(LOCATIONS)`.

`bun run build`, `bun run lint`, `bun run test`, `bun run test:smoke` all pass.

---

<!-- UX audit — 2026-05-27 -->

## 14. UX audit (2026-05-27)

Three-lens audit (stage-author / composer-author / end-user) applied with the
interaction-graph, affordance-opacity, affordance-surfaces, and affordance-types
frameworks. Full report: `docs/UX-AUDIT-2026-05-27.md`.

Top three RED findings: (1) `examples/world-primary/Stage.tsx` ActionSurface
verbs and FreeformInput submit are wired to no-ops (orphaned affordances);
(2) example renders are debugger-shaped (JSON dumps, raw tags) leaking dev
surface into the player's path — most acute in `cyber-slots/Stage.tsx:152`;
(3) `scripts/build-example.mjs:32-67` data-loss hazard if killed during build.

Mock-stage navigation tooling: recommended (R1) as `StageIntrospect` interface
+ `scripts/explore-stage.mjs` driver — same architectural move that fixes the
world-primary orphan verbs.

12 recommendations ordered by leverage in §"Recommendations" of the audit.
