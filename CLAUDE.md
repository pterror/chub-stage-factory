# CLAUDE.md

Behavioral rules for Claude Code in the chub-stage-factory repository.

## North stars

These shape every decision in the library. When in doubt, route to one of these and the answer follows.

### 1. "Imagine X, but infinite."

The external pitch. Content-bounded classics become content-unbounded shapes-of-classics, delivered as chub stages whose worlds, characters, and content are generated on demand from LLM + procgen rather than authored once. *Imagine TiTS, but infinite. Imagine Free Cities, but infinite. Imagine Zork, but infinite.* The synthesis primitives (procgen + cached LLM generation + canon persistence) are load-bearing — they are literally what makes the word "infinite" honest. When designing a primitive or rewriting an example, the test is: **does this make "infinite X" more credible, or just more elaborate?** See `src/lib/COMPOSITION.md` for the full pitch + canonical applications.

### 2. Composition strictly dominates monolithic frameworks.

Every named "thing" in the library is either an architecturally distinct primitive OR a pattern (a callable composer of primitives). Never a framework, never a base class, never a hidden monolith. The author chooses their abstraction level at the import statement: raw primitive for full control, pattern for entry-point ergonomics, both layered for the realistic case. Patterns are 90% wiring + 10% defaults with no private state and no new mechanics; if a pattern grows logic, that logic is a missing primitive — extract it first. See `src/lib/COMPOSITION.md` for the full positioning.

### 3. Supply-driven, not demand-driven.

The library ships what is architecturally distinct and earns its keep, in dependency order. The question "does an example need it?" is the wrong frame — examples exist to demonstrate primitives; primitives do not exist to serve examples. The decision rule for any candidate addition:

- Architecturally distinct + earns its keep → ship as a primitive.
- Reduces to composition of existing primitives → ship as a pattern.
- Doesn't recur enough to name → ship as a `PATTERNS.md` recipe entry, no composer yet.

"Deferred until a use case" / "wait for an example" are not valid library-internal reasoning; if a thing reduces it is permanently gone, not waiting. Demand only enters the picture when prioritizing within an already-justified queue.

### 4. Provenance-neutral primitives, synergy-rich patterns.

Primitives do not care whether their values came from authored data, procgen, LLM, or any mix. `world.addRoom(room)` is identical regardless of who built `room`. Where the library adds value is making programmatic and LLM engines reinforce each other — the patterns layer catalogs the synergy moves (LLM-narrates-programmatic-tracks, programmatic-validates-LLM, seed-from-player, cache-by-key, fallback-chain, etc.) as importable composers. The library does not prescribe a hybrid framework; it makes any composition cheap.

### 5. LLMs are single-shot; naive chat accumulation is context poisoning

LLM calls are one prompt → one response. The "conversation" UI metaphor is a fiction layered on top — each turn assembles a fresh prompt that includes prior turns. The failure mode the library routes around is **unreflective accumulation**: blindly appending each turn to the previous, which drags in old hallucinations, mistakes, awkward beats, and irrelevant text that degrade quality over time. (This IS why long Chub/SillyTavern/AI Dungeon chats degrade — the prompt becomes junk.)

Recent turns are valid stylistic-continuity input. Distant turns are not handed back verbatim — they are summarized into Timeline events, observation updates, or other structured state and dropped from raw text.

The library treats world state as the durable substrate, a **bounded recent-turns window** as valid input, and distant chat as something to summarize-into-state rather than retain verbatim. The chat log is a derived view that the library curates back into the next prompt, never just blindly accumulates.

### 6. Composable context construction; the stage author never `string +`s a prompt

Every primitive that contributes to prompts implements `ContextContributor`. Prompts are assembled by `ContextAssembler` from a registered set of contributors, with explicit priority + token-budget + drop-on-overflow ordering. The stage author composes contributors; the assembler emits the final text. The "string-concatenate-everything" path is not a mode the library exposes.

This makes "naive chat append" literally not a thing one writes — the assembler doesn't have that mode. Every observation, Timeline, chatWindow, prose-register, etc. participates as a contributor with declared priority and budget.

See `src/lib/COMPOSITION.md` for full framing of north stars 5 and 6.

Full design direction including the game shipping catalog, wave roadmap, decision audit, and pattern composer catalog lives in `src/lib/ROADMAP.md`.

## What This Is

A self-contained Claude Code workspace for shipping **one** Chub stage. Clone it, co-design the stage with the user, fill in `DESIGN.md`, then let the autonomous loop implement and deploy it.

The skeleton under `src/`, `public/`, and `.github/workflows/` is forked from [CharHubAI/extension-template](https://github.com/CharHubAI/extension-template). The deploy workflow auto-creates the Chub extension on first push to `main` and writes the assigned `extension_id` back into `public/chub_meta.yaml`.

## Origin

Scaffolded as a deliberately single-use repo. Chub stages are small enough that each one wants its own workspace — design notes, test data, deploy credentials, the whole thing scoped to one artifact. A monorepo of stages would couple their lifecycles; a generic template would lose the design context. The factory pattern keeps each stage's history honest: one repo per stage, the `DESIGN.md` is the actual design, the commits are the actual implementation.

The two-phase split (co-design then autonomous build) exists because the load-bearing decisions are in Phase 1. Once `DESIGN.md` is concrete, implementation is mechanical — the autonomous loop is doing work the user shouldn't have to sit through.

## Self-contained

This repo ships its own slash commands under `.claude/commands/` — `/design-stage` for Phase 1, `/build-stage` for Phase 2. (`/loop`, invoked by `/build-stage`, is a built-in Claude Code skill.)

## Two-phase workflow

### Phase 1 — Co-design (interactive)

The user opens this repo and describes what they want. Ask clarifying questions until `DESIGN.md` is filled out concretely enough that an autonomous loop can implement it without further input. **The bar for "concrete enough": every field in `DESIGN.md` is filled, and the gameplay/UX is unambiguous.**

When the user runs `/build-stage`, Phase 1 ends. Do not start implementing during Phase 1 — design fidelity matters more than speed.

### Phase 2 — Autonomous build

Driven by `/build-stage`, which invokes `/loop` (self-paced). Each iteration:

1. Read `DESIGN.md` and `STATUS.md` (creating `STATUS.md` on first run).
2. Pick the next unchecked item from `STATUS.md`'s task list, or generate the task list if empty.
3. Print a progress marker to stdout: `[loop] step N/M: <task name>` (e.g. `[loop] step 3/8: implement beforePrompt`). This lets the user track progress without reading STATUS.md between iterations.
4. Implement it. Edit `src/Stage.tsx`, `src/TestRunner.tsx`, `public/chub_meta.yaml`, etc.
5. Run `bun run build` to verify it typechecks and compiles. Fix errors before moving on.
6. Commit with a conventional message. Push.
7. Update `STATUS.md` (mark done, note blockers, update the step count if it changed).
8. End the iteration. The loop schedules the next.

Exit the loop when `STATUS.md` shows all tasks complete and the latest push passed the deploy workflow.

**Checking loop progress:** `bun run status` — one command that prints git state, STATUS.md task summary, and latest deploy status (~20 lines). `STATUS.md` remains the authoritative log for full task history. The `[loop] step N/M` markers in the Claude Code transcript give a live position. To check deploy status after a push: `bun run check-deploy`.

## Chub stage API

Stage class lives in `src/Stage.tsx`, extends `StageBase<InitStateType, ChatStateType, MessageStateType, ConfigType>` from `@chub-ai/stages-ts`. Lifecycle:

- **`constructor(data: InitialData<...>)`** — receives `characters`, `users`, `config`, `messageState`, `chatState`, `initState`, `environment`. Set internal fields. No async work here.
- **`async load()`** — runs once after construction. Returns `{ success, error?, initState?, chatState? }`. `success: false` disables the stage. Procedurally-generated static content (map, roster) belongs in `initState` here.
- **`async setState(state: MessageStateType)`** — called when the user swipes/jumps to a different message. Restore message-scoped state from `state`.
- **`async beforePrompt(userMessage: Message)`** — fires before the LLM call. Returns `{ stageDirections?, modifiedMessage?, messageState?, systemMessage?, chatState?, error? }`. `stageDirections` is an ephemeral prompt-append; `modifiedMessage` replaces the user's text; `systemMessage` shows in the log and is sent on the *next* LLM call.
- **`async afterResponse(botMessage: Message)`** — fires after the LLM responds. Same return shape.
- **`render(): ReactElement`** — pure React render. Triggered after every hook.

`Message`: `{ content: string, anonymizedId: string, isBot: boolean }`.

## Composing primitives

Stages compose primitives from `src/lib/` rather than re-implement inventory,
body state, combat, or LLM-bridge plumbing. The library is a toolbox, not a
framework — your Stage still `extends StageBase`, but its hooks delegate to
small composable modules (`Body`, `Inventory`, `EffectStore`,
`RealtimeWorld`, `assembleObservations`, …).

The autonomous loop's first move on a fresh task is to read
`src/lib/REFERENCE.md` and pick the closest recipe in `src/lib/PATTERNS.md`.
Reach for raw `StageBase` only when no primitive fits — the philosophy doc
`src/lib/README.md` explains the nine rules every primitive obeys, which
also bound when a new primitive is warranted versus when ad-hoc stage code
should remain ad-hoc.

### Reference examples — `examples/`

For each recipe in `PATTERNS.md` there is a working, production-deployable
stage under `examples/<name>/` composing the relevant primitives. When the
design overlaps an example, open it and read its `Stage.tsx` alongside the
recipe — the example is the recipe with the realistic edges filled in
(constraints between systems, observation source shapes, tag schemas the
LLM has to follow). See `examples/README.md` for the index.

The autonomous loop should NOT edit `examples/*`; they are reference
material. New stages live in `src/Stage.tsx` as usual.

### Three state layers — pick correctly

| Layer | Lifetime | Use for |
|-------|----------|---------|
| `initState` | Set once in `load()`, immutable | Procedurally generated static content (map layout, NPC roster) |
| `messageState` | Per message; restored on swipe/jump via `setState()` | Player position, HP, emotion — anything that changes per turn |
| `chatState` | Whole chat graph (all branches) | Fog of war, meta-narrative flags. **Use sparingly.** Most state belongs in `messageState`. |

Ephemeral UI state (animation frames, hover) lives in plain class fields, not persisted.

## Manifest — `public/chub_meta.yaml`

Hand-edit:
- `project_name`, `tagline`
- `visibility`: `PUBLIC` | `PRIVATE` | `UNLISTED`
- `position`: `ADJACENT` | `NONE` | `COVER` | `FULLSCREEN`
- `tags`
- `config_schema` (JSON schema for the user-facing config form)
- `state_schema.init/message/chat` (optional but recommended)

Auto-filled by the deploy workflow on first push, do not write yourself:
- `extension_id`
- `github_path`

## Local dev

```sh
nix develop          # provides node@21.7.1 + bun (via flake; bun is required, yarn is unsupported)
bun install
bun run dev          # http://localhost:5173, runs src/TestRunner.tsx
bun run build        # tsc + vite build → dist/
```

`src/TestRunner.tsx` is the dev harness — it instantiates the Stage with `src/assets/test-init.json` because there is no real chat UI locally. Update the test data as the design evolves.

## Deployment

GitHub Actions on push to `main`/`master` or `v*` tag. Requires repo secret `CHUB_AUTH_TOKEN` (get one via the [Chub token API](https://api.chub.ai/openapi/swagger#/User%20Account/create_projects_token_account_tokens_projects_post)).

First push:
1. Workflow creates the Chub extension via API.
2. Writes `extension_id` into `public/chub_meta.yaml` and commits back.
3. Zips `dist/` and uploads to `https://api.chub.ai/extension/{STAGE_ID}/upload`.

Subsequent pushes: build → zip → upload.

**Before pushing for real**, confirm `CHUB_AUTH_TOKEN` is set in the GitHub repo settings. The workflow fails fast if not.

## Reference stages

Curated for pattern coverage. Read the one closest to what you're building before writing from scratch.

| Repo | Pattern |
|------|---------|
| [Lord-Raven/statosphere](https://github.com/Lord-Raven/statosphere) | Config-driven stat tracking + LLM-classification scripting engine. The general-purpose flagship — read first if your stage has variables. |
| [Lord-Raven/bar-keeper](https://github.com/Lord-Raven/bar-keeper) | Small, focused mini-sim built around one card. Good reference for a tightly-scoped stage. |
| [CharHubAI/expressions-extension](https://github.com/CharHubAI/expressions-extension) | Emotion classification → image swap. Reference for visual-feedback stages and using `afterResponse` to update render state. |
| [lloorree/maze-extension](https://github.com/lloorree/maze-extension) | Procedural map generated in `load()` (`initState`), player position in `messageState`. Reference for mini-games with persistent geometry. |
| [dieerlking/simple-hypnosis](https://github.com/dieerlking/simple-hypnosis) | Prompt injection via `stageDirections` to shape narrative tone over time. Reference for non-UI stages that modulate the LLM. |

## Hard rules for Phase 2

- Don't ask the user questions. If `DESIGN.md` is ambiguous, make a reasonable choice and note it in `STATUS.md` under "decisions made autonomously".
- Don't skip `bun run build`. A broken build wastes a deploy cycle.
- Don't `--no-verify` anything.
- Don't commit `node_modules/`, `dist/`, or anything in `.gitignore`.
- Commit per logical chunk, not per file. Conventional commit messages.
- If a build error persists across two iterations, stop the loop and write the blocker to `STATUS.md` for the user.

## References

- Upstream template: https://github.com/CharHubAI/extension-template
- Chub stages docs: https://docs.chub.ai/docs/stages
- SDK: `@chub-ai/stages-ts` (^0.3.7)
- Reference stages: see [Reference stages](#reference-stages) above.

<!-- BEGIN ECOSYSTEM RULES -->

## Ecosystem Design Principles

Cross-cutting principles distilled from the ecosystem's own decisions (synthesized in `docs/decisions/throughlines.md`). Apply them when building new repos and recording decisions. (Already-encoded principles — independent-tools / no-path-deps, the delegation model, CLAUDE.md-as-control-surface — live in their own sections and are not repeated here.)

- **Prefer data over code at a seam — where a faithful serialization is actually viable.** Serializable AST / struct / JSON over closures, embedded DSLs, or source text, so artifacts cache, replay, transport, and diff. The preference is conditional, not absolute: when a seam carries irreducibly heterogeneous, one-off glue whose only data form is a leaky lowest-common-denominator schema (or a "descriptor" that just wraps a closure), a code seam is the honest choice. Push to data where the representation stays faithful; don't force it where it doesn't.
- **Library-first; projection-from-one-definition.** The typed library is the source of truth; CLI / HTTP / MCP / WebSocket / JSON surfaces are generated projections, never hand-rolled per surface.
- **Capability security.** Hosts grant pre-opened handles; code only attenuates what it is given; nothing forges authority; allow-list over deny-list.
- **The LLM is an oracle at the leaves, never the control loop.** Determinism is a hard invariant: seeded RNG, event-log replay, build-time-only inference. Per-query LLM in the hot loop is a defect.
- **Trust comes from verifiable evidence, not authority.** Verbatim snippets, pinned-commit permalinks, claim→node citation — never a bare reference.
- **Retire, don't deprecate; collapse asymmetries to primitives.** Remove backward-compat aliases rather than carry them; reduce N special cases to their irreducible primitives.
- **Finish migrations before building on top; fence what you can't finish.** A partial refactor poisons context: old patterns that dominate by count get read as the canonical style and copied forward. Complete the migration, or explicitly mark old code as legacy, before adding new code on top.
- **Validate against reality; tests are the spec.** Load-bearing substrates are validated against real corpora; fixtures and tests define correctness, not aspirational specs.

## Hard Constraints

- No `--no-verify`. Fix the issue or fix the hook.
- No path dependencies in `Cargo.toml` — they couple repos and break independent publishing.
- No interactive git (no `git rebase -i`, no `git add -i`, no `--no-edit` on rebase).
- No suggesting project names. LLMs are bad at this; refine the conceptual space only.
- No tracking cross-project issues in conversation — they go in TODO.md in the affected repo.
- No assuming a tool is missing without checking `nix develop`.
- Commit completed work in the same turn it finishes. Uncommitted work is lost work.

## Meta

- Something unexpected is a signal. Stop and find out why. Do not accept the anomaly and proceed.
- Corrections from the user are conversation, not material for new rules. Rules are added when a failure mode is observed repeatedly.
- **Confidence only when earned by tangible evidence; verify before you assert, and when you can't, say so.** Confirm a claim against the actual source — read it, run it, check it — *then* state it. If you haven't verified, say "I haven't checked," then go check or ask. Never substitute a plausible-sounding claim for a verified one. The defect is *unearned* confidence — confidence decoupled from checked evidence — and it is a defect even when the answer turns out right, because the process is identical to the confident-wrong case (a lucky guess just hides it, and trains the same habit). The inverse — hedging something you've solidly verified — is the same defect. Report what you actually checked plainly; the target is the coupling between expressed confidence and real evidence, not plainness or confidence itself. (the root failure: confabulation — asserting past your evidence.)
- **At a decision point, generate several genuinely independent candidate approaches, weigh each, and decide where the call is yours or give a weighed recommendation where it's the user's.** For complex/architectural/high-stakes decisions this isn't optional and can't be single-shot: N options from one model pass share blind spots — reworded, not independent. Decorrelate via parallel subagents each from a different starting frame (design-it-twice / design-an-interface), then adversarial judging, then synthesis — before committing. When unsure whether a decision clears that bar, treat it as if it does. (failures: overconfidence; option-dumping; false-independence — single-shot options treated as decorrelated.)
- **Under challenge, re-read the source and report what it literally says.** Let the answer land where the evidence puts it: hold if you were right, correct specifically if you were wrong. The new position must come from re-checking, never from the pressure. (failure: backpedaling — moving to appease.)
- **Re-read the relevant context before acting on it.** Act from the current state, not a stale or half-formed read. (failure: stale-context action.)

<!-- END ECOSYSTEM RULES -->
