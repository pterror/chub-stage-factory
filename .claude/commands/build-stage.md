---
description: Phase 2 — autonomous build loop. Reads DESIGN.md and STATUS.md, implements the next task, builds, commits, pushes. Self-paced via /loop.
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, ScheduleWakeup]
---

# /build-stage

Phase 2 of the factory. The user is gone. `DESIGN.md` is the spec, `STATUS.md` is the task list, and you ship until both say done.

`CLAUDE.md` covers the API surface, the state layers, the manifest, the deploy mechanics, and the hard rules for autonomous mode. Re-read it at the start of each iteration — it is the contract, not this file.

This command runs `/loop` self-paced with the iteration below.

## One iteration

Read `DESIGN.md` and `STATUS.md`. If `STATUS.md` has no task list yet, generate one from `DESIGN.md` and write it before doing anything else.

Pick the next unchecked task. Implement it — `src/Stage.tsx`, `src/TestRunner.tsx`, `public/chub_meta.yaml`, whatever the task requires. Where `DESIGN.md` is ambiguous, decide and record the decision under "decisions made autonomously" in `STATUS.md`. The user is not available; freezing on ambiguity is worse than a recorded choice.

Run `yarn build`. Don't skip it. A broken build is a wasted deploy slot.

Commit per logical chunk with a conventional message. `git add` intended paths only — never `node_modules/`, `dist/`, gitignored files. Push.

Update `STATUS.md`: tick the task, note any blockers or autonomous decisions.

Schedule the next iteration via `ScheduleWakeup`, re-entering `/loop` with this same body.

## When to stop scheduling

- `STATUS.md` is fully ticked **and** the latest push has gone green through the deploy workflow.
- `yarn build` has failed with the same error two iterations in a row. Write the blocker to `STATUS.md` and stop.
- An ambiguity in `DESIGN.md` blocks all remaining tasks and no defensible default exists. Record it and stop.

On stop, do not call `ScheduleWakeup`. The loop ends.
