# CLAUDE.md

A self-contained Claude Code workspace for designing and shipping a single Chub stage.

## What this repo is

This repo is a **factory for one stage**. Clone it, co-design with the user, fill in `DESIGN.md`, then run the autonomous loop until the stage is shipped to Chub.

The skeleton under `src/`, `public/`, `.github/workflows/` is the upstream [CharHubAI/extension-template](https://github.com/CharHubAI/extension-template). The deploy workflow auto-creates the Chub extension on first push to `main` and writes the `extension_id` back into `public/chub_meta.yaml`.

## Self-contained

This repo ships its own slash commands under `.claude/commands/` — `/design-stage` for Phase 1, `/build-stage` for Phase 2, `/loop` as the underlying autonomous driver. No global Claude Code config needed.

## Two-phase workflow

### Phase 1 — Co-design (interactive, with the user)

The user opens this repo and describes what they want. You ask clarifying questions until `DESIGN.md` is filled out concretely enough that an autonomous loop can implement it without further input. **The bar for "concrete enough" is: every field in `DESIGN.md` is filled, and the gameplay/UX is unambiguous.**

When the user runs `/build-stage`, Phase 1 ends. Do not start implementing during Phase 1 — design fidelity matters more than speed.

### Phase 2 — Autonomous build (no further user input)

Driven by `/build-stage`, which invokes `/loop` (self-paced). Each iteration:

1. Read `DESIGN.md` and `STATUS.md` (creating `STATUS.md` on first run).
2. Pick the next unchecked item from `STATUS.md`'s task list, or generate the task list if empty.
3. Implement it. Edit `src/Stage.tsx`, `src/TestRunner.tsx`, `public/chub_meta.yaml`, etc.
4. Run `yarn build` to verify it typechecks and compiles. Fix errors before moving on.
5. Commit with a conventional message. Push.
6. Update `STATUS.md` (mark done, note blockers).
7. End the iteration. The loop schedules the next.

Exit the loop when `STATUS.md` shows all tasks complete and the latest push succeeded the deploy workflow.

## Chub stage API — what you're writing

Stage class lives in `src/Stage.tsx`, extends `StageBase<InitStateType, ChatStateType, MessageStateType, ConfigType>` from `@chub-ai/stages-ts`. Lifecycle:

- **`constructor(data: InitialData<...>)`** — receives `characters`, `users`, `config`, `messageState`, `chatState`, `initState`, `environment`. Set up internal fields. Do not do async work here.
- **`async load()`** — runs once after construction. Return `{ success, error?, initState?, chatState? }`. `success: false` disables the stage. Procedurally-generated static content (map, roster) belongs in `initState` here.
- **`async setState(state: MessageStateType)`** — called when the user swipes/jumps to a different message. Restore message-scoped state from `state`.
- **`async beforePrompt(userMessage: Message)`** — fires before the LLM call. Return `{ stageDirections?, modifiedMessage?, messageState?, systemMessage?, chatState?, error? }`. `stageDirections` is ephemeral prompt-append; `modifiedMessage` replaces the user's text; `systemMessage` shows in the log and is sent on the *next* LLM call.
- **`async afterResponse(botMessage: Message)`** — fires after the LLM responds. Same return shape.
- **`render(): ReactElement`** — React render. Pure, no side effects. Triggered after every hook.

`Message`: `{ content: string, anonymizedId: string, isBot: boolean }`.

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
- `config_schema` (JSON schema for user-facing config form)
- `state_schema.init/message/chat` (optional but recommended)

Auto-filled by deploy workflow on first push, do not write yourself:
- `extension_id`
- `github_path`

## Local dev

```sh
nix develop          # provides node@21.7.1 + yarn (via flake)
yarn install
yarn dev             # http://localhost:5173, runs src/TestRunner.tsx
yarn build           # tsc + vite build → dist/
```

`src/TestRunner.tsx` is the dev harness — it instantiates the Stage with `src/assets/test-init.json` because there's no real chat UI locally. Update test data as the design evolves.

## Deployment

GitHub Actions on push to `main`/`master` or `v*` tag. Requires repo secret `CHUB_AUTH_TOKEN` (get via [Chub token API](https://api.chub.ai/openapi/swagger#/User%20Account/create_projects_token_account_tokens_projects_post)).

First push:
1. Workflow creates the Chub extension via API.
2. Writes `extension_id` into `public/chub_meta.yaml` and commits back.
3. Zips `dist/` and uploads to `https://api.chub.ai/extension/{STAGE_ID}/upload`.

Subsequent pushes: build → zip → upload.

**Before pushing for real**, confirm `CHUB_AUTH_TOKEN` is set in the GitHub repo settings. The workflow fails fast if not.

## Hard rules for Phase 2 (autonomous mode)

- Don't ask the user questions. If `DESIGN.md` is ambiguous, make a reasonable choice and note it in `STATUS.md` under "decisions made autonomously".
- Don't skip `yarn build`. A broken build wastes a deploy cycle.
- Don't `--no-verify` anything.
- Don't commit `node_modules/`, `dist/`, or anything in `.gitignore`.
- Commit per logical chunk, not per file. Conventional commit messages.
- If a build error is persistent across two iterations, stop the loop and write the blocker to `STATUS.md` for the user.

## References

- Upstream template: https://github.com/CharHubAI/extension-template
- Chub stages docs: https://docs.chub.ai/docs/stages
- SDK: `@chub-ai/stages-ts` (^0.3.7)
- Reference stages (real ones): `Lord-Raven/statosphere`, `Lord-Raven/bar-keeper`, `CharHubAI/expressions-extension`
