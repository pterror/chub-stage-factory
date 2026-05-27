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

`bun run lint` **skipped**: `@typescript-eslint/eslint-plugin` is not in devDependencies and was
already failing before this pass. The step is noted in a comment in the workflow yaml; add the
package and re-enable before the next CI pass.

## 10. Vitest setup + canary test

**Decision:** Option C — add vitest, one canary test in `src/lib/rng.test.ts`, no broader sweep.

- `vitest` added as dev dependency via `bun add -d vitest`.
- `"test": "vitest run"` added to `package.json` scripts.
- `src/lib/rng.test.ts` covers: `weightedPick` determinism with seeded stream, `weightedPick([])` throws, `pick` uniform-ish distribution.
- CI: `bun run test` step added.

## 11. Missing module docs — deferred inventory

Decision: inventory only in this pass; no docs written.

### High-priority (exported, multi-caller, not @experimental)

- `action.ts`, `body.ts`, `chub-adapters.ts`, `classifier.ts`, `combat-realtime.ts`,
  `combat-turn.ts`, `constraints.ts`, `effects.ts`, `equipment.ts`, `fsm.ts`,
  `grid-inventory.ts`, `inventory.ts`, `observation.ts`, `physics.ts`, `prose-register.ts`,
  `replay.ts`, `rng.ts`, `snapshots.ts`, `stats.ts`, `tag-parser.ts`, `tags.ts`,
  `transformation.ts`

### Low-priority (@experimental or internal helper)

- `chat-window.ts` — @experimental, 0 callers
- `embeddings.ts` — @experimental, 0 callers
- `generate.ts` — **re-classified as production** (2 callers; @experimental removed)
- `trigger.ts` — **re-classified as production** (2 callers; @experimental removed)

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

## N. `world-primary` not migrated to `world.ts` yet

Wave 2B `world.ts` (graph of rooms + scope queries) was landed in 2026-05-27.
`examples/world-primary/Stage.tsx` predates the primitive and hand-rolls every
concept it captures: `LOCATIONS: Record<string, Location>` literal, manual
scope-Set construction in `beforePrompt`, deterministic `intent.verb === "go"`
movement logic, etc. Migrating cleanly requires reshaping how the example
seeds its world and how `freeformPipeline`'s `applyDelta` mutates location —
non-trivial enough to risk regressing the currently-green smoke scenario.

Deferred. TODO: in a follow-up, replace the inline LOCATIONS/NPCS literals
with `new World()` + `world.locate(…)`, pass `world.scope("player")` to
`parseIntent`, and route `intent.verb === "go"` through `world.move`. The
`worldResolvers(world)` helper is in place for that migration.
