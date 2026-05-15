---
description: Phase 1 — co-design the stage with the user. Iterate on DESIGN.md until every field is concrete. Do NOT implement.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
---

# /design-stage

Enter the Phase 1 co-design conversation defined in `CLAUDE.md` §"Phase 1 — Co-design".

## What to do

1. Read `CLAUDE.md` and the current `DESIGN.md`.
2. Ask the user about their stage concept: what the stage does, gameplay/UX, state model, config, manifest fields.
3. Iterate on `DESIGN.md` until **every required field is concrete** and the gameplay/UX is unambiguous. The bar: an autonomous loop can implement it without further questions.
4. Do **NOT** begin implementation. No edits to `src/`, `public/chub_meta.yaml`, or anything outside `DESIGN.md` (and `STATUS.md` if useful for planning notes).

## Handoff

When the user signals they're ready (e.g. "ok go"), tell them:

> Phase 1 done. Run `/build-stage` to enter the autonomous loop.

Do not auto-transition. The user runs `/build-stage` explicitly.
