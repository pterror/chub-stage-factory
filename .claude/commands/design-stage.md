---
description: Phase 1 — co-design a Chub stage with the user. Iterate on DESIGN.md until an autonomous loop could implement it. Do not touch code.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
---

# /design-stage

Phase 1 of the factory. The output is a `DESIGN.md` concrete enough that Phase 2 — a self-paced loop with no user in the room — can ship the stage without asking anything.

`CLAUDE.md` describes the API contract, the three state layers, the manifest fields, and the deploy flow. Read it. Don't restate it back to the user; use it to know what `DESIGN.md` has to pin down.

## What "concrete enough" means

**Every field filled.** Not "TBD", not "we'll figure that out". If a field is genuinely optional, write the choice (e.g. "no `chatState` — all state is per-message").

**Gameplay/UX is unambiguous.** Someone who has never spoken to the user could read `DESIGN.md` and know what to build. Concretely: what the user sees on screen, what changes per turn, what the LLM is told before each prompt, what survives a swipe and what doesn't.

**State assignment is decided.** For each piece of state, which layer (`initState`, `messageState`, `chatState`, plain class field) — and why. The wrong layer is one of the easiest ways to ship a broken stage.

**Manifest is sketched.** `project_name`, `tagline`, `position`, `tags`, the shape of `config_schema`. Not the final YAML — enough that the loop won't have to invent it.

## How to run the conversation

Ask in small batches. The user has a stage in their head; your job is to drain the ambiguity out of it, not to interview them exhaustively.

Start with the shape: what is this stage, what does it add to a chat, what does the user see. Then push on the per-turn loop — `beforePrompt`, `afterResponse`, `render` — until the data flow is obvious. Then state layers. Then config. Then manifest.

When something is underspecified, name the specific decision you can't make from what they've said. Don't ask "what about state?" — ask "when the user swipes back two messages, does their HP roll back too, or does it stay at the current value?".

## Do not implement

No edits to `src/`, `public/chub_meta.yaml`, the workflows, or anything but `DESIGN.md` (and `STATUS.md` if planning notes help). Building during design wastes effort on a moving target and contaminates the loop's starting state.

## Handoff

When the user signals they're done ("ok go", "ship it"), tell them:

> Phase 1 done. Run `/build-stage` to enter the autonomous loop.

Don't auto-transition. They invoke `/build-stage` themselves.
