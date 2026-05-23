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
3. Implement it. Edit `src/Stage.tsx`, `src/TestRunner.tsx`, `public/chub_meta.yaml`, etc.
4. Run `yarn build` to verify it typechecks and compiles. Fix errors before moving on.
5. Commit with a conventional message. Push.
6. Update `STATUS.md` (mark done, note blockers).
7. End the iteration. The loop schedules the next.

Exit the loop when `STATUS.md` shows all tasks complete and the latest push passed the deploy workflow.

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
nix develop          # provides node@21.7.1 + yarn (via flake)
yarn install
yarn dev             # http://localhost:5173, runs src/TestRunner.tsx
yarn build           # tsc + vite build → dist/
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
- Don't skip `yarn build`. A broken build wastes a deploy cycle.
- Don't `--no-verify` anything.
- Don't commit `node_modules/`, `dist/`, or anything in `.gitignore`.
- Commit per logical chunk, not per file. Conventional commit messages.
- If a build error persists across two iterations, stop the loop and write the blocker to `STATUS.md` for the user.

## Context Is The Only Scarce Resource

Every byte that enters the main session stays in the main session for its entire lifetime. File contents, command output, search results — once read, it lingers in cache and shapes every downstream token. There is no "just looking."

**All exploration runs in subagents.** Investigations, audits, surveys, "let me check," "let me find" — if the purpose of a tool sequence is to find out something you don't yet know, it runs in a subagent. The subagent returns a distilled summary; the raw output stays in the subagent.

Reading a reference stage's source to understand a pattern is exploration — spawn a subagent and have it return the pattern, not the source.

## Subagent Prompts

A subagent prompt is composed in a "spec-writing" register that subtly changes what feels in-scope. Specific failure modes to name:

**Never tell a subagent "do not commit."** Delegation does not strip the commit step from completed work. If a subagent modifies files and the work is done, either the subagent commits, or the next thing the delegator does after it returns is commit — not summarize, not report. The phrase "do not commit" in your own prompt is the tell that you are about to leave work uncommitted.

**Do not delegate judgment.** Phrases like "if extraction is awkward, just duplicate" or "based on your findings, fix the bug" push synthesis onto the agent. If you are punting a decision into the prompt, you do not yet have enough understanding to delegate. Investigate first; write the prompt with the decision already made.

**Do not ask for a diff summary.** Subagent self-reports describe intent, not effect. After a code-modifying subagent returns, read `git diff` yourself. Skip the "report what you changed" instruction — it produces text you cannot trust and that pollutes main context.

**Do not re-explain CLAUDE.md.** Subagents inherit it. Repeating project layout or repo conventions in the prompt dilutes the actual task instructions and signals half-trust in the inheritance. Trust it or don't read it.

**Line numbers are orientation, not anchors.** Files shift between your read and the subagent's read. When citing locations, tell the subagent to find the lines by content ("the block that does X"), not by number.

**Name files explicitly; do not outsource the grep.** "Wherever it appears" invites scope creep. Grep first, list the exact files in the prompt.

**If the task is smaller than the prompt describing it, do it inline.** A subagent dispatch pays a full system-prompt + CLAUDE.md cache cost. One-shot bash commands and single-line edits should run in the main session with `Bash` or `Edit`.

**Match agent type to deliverable shape.** `Explore` is for lookup and search — finding files, symbols, references — not analytical synthesis. For audits, surveys, and pattern analysis whose deliverable is a report, use `general-purpose` with an explicit Opus model. For tasks whose deliverable is files on disk, use `general-purpose` with the tier matched to the work (Sonnet for mechanical, Opus for architectural).

**On unsatisfying subagent output, change something before retrying.** Same prompt + same model + same agent type = same result. Escalate model tier (Sonnet → Opus), narrow the prompt, or switch agent type. Identical retries are waste.

**Dispatch independent subagents in parallel.** Multiple Agent tool_use blocks in a single assistant message run concurrently. Serial Agent dispatch across sequential turns is the default failure mode and trades wall time for nothing. If two subagents do not depend on each other's output, they belong in the same message.

**Pair `isolation: worktree` with `run_in_background: true`.** A worktree implies meaningful write work. Foregrounding it blocks the main session for the entire run. Background unless the worktree's immediate output is what you need to act on next.

**Always set `subagent_type` and `model` explicitly.** Defaulting either collapses tier choice into an invisible decision. The model and agent type are part of the spec; name them every time, even when the choice is obvious. See the existing `Subagent model tiers` section above for which tier fits which work.

## Durability

Subagent reports, mid-session realizations, "I'll remember this" — none of these outlast the session. Anything worth keeping goes into `DESIGN.md`, `STATUS.md`, code, or a commit.

**Commit completed work immediately.** Uncommitted work is lost work. In Phase 2, every iteration ends in a push — that is the durability mechanism.

## Authenticity

When asked to analyze a reference stage, read it. Do not synthesize from conversation memory or what the stage probably does.

**Something unexpected is a signal.** A build error you don't understand, a deploy that succeeded without `extension_id` being written back, a `messageState` that didn't restore on swipe — stop and find out why. Do not accept the anomaly and proceed.

## Discipline

Corrections from the user are conversation, not material for new rules. A single correction does not warrant a CLAUDE.md edit. Rules are added when a failure mode is observed repeatedly and the rule names the failure it prevents.

Do not announce actions ("I will now…"). Act.

## References

- Upstream template: https://github.com/CharHubAI/extension-template
- Chub stages docs: https://docs.chub.ai/docs/stages
- SDK: `@chub-ai/stages-ts` (^0.3.7)
- Reference stages: see [Reference stages](#reference-stages) above.
