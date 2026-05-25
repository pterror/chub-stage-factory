<!-- DECISIONS.md — audit-remediation pass, 2026-05-25 -->
<!-- Each H2 section = one audit item. Append new sections here. -->

## 1. `withPersistence` HOC

`withPersistence` is a class-factory HOC (not a mixin or base-class override) that wraps `StageBase` and delegates the three repeated lifecycle methods — `load`, `setState`, `beforePrompt`, `afterResponse` — to a caller-supplied `PersistenceStore` + `ChubLayers`. The HOC handles two shapes that appeared in the eight examples: (a) the simple five-field pattern (`{ success: true, error: null, initState: null, chatState, messageState }`) used by inventory, effects, tits-body, turn-combat, and cyber-slots; and (b) the mirror-read pattern used by physics, realtime-combat, and composite-showcase, which reads `this.layers.mirror` directly and may include `initState` or a non-null `chatState`. Shape (b) cannot be absorbed without adding mirror-read options that would make the HOC as verbose as the boilerplate — those three examples are left as-is per the spec. `effects` uses `this.pStore` / `this.bound` naming but is otherwise shape (a) and is migrated. All five migrated examples no longer declare `store`, `bound`, `load`, or `setState` locally.

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
- `generate.ts` — @experimental, 1 caller chain
- `trigger.ts` — @experimental, 1 caller
