---
description: Phase 2 — autonomous build loop. Reads DESIGN.md and STATUS.md, picks the next task, implements, builds, commits, repeats. Exits when STATUS.md shows all done.
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, ScheduleWakeup]
---

# /build-stage

Enter the Phase 2 autonomous build described in `CLAUDE.md` §"Phase 2 — Autonomous build". This command invokes `/loop` in self-paced mode with the iteration body below.

## Iteration body

Each `/loop` iteration:

1. Read `DESIGN.md` and `STATUS.md`. If `STATUS.md` does not exist or has no task list, generate one from `DESIGN.md` and write it.
2. Pick the next unchecked task.
3. Implement it. Edit `src/Stage.tsx`, `src/TestRunner.tsx`, `public/chub_meta.yaml`, etc. Do not ask the user questions — if `DESIGN.md` is ambiguous, make a reasonable choice and record it in `STATUS.md` under "decisions made autonomously".
4. Run `yarn build`. Fix errors before moving on. If the same build error persists across two iterations, stop the loop and write the blocker to `STATUS.md`.
5. `git add` only intended files (never `node_modules/`, `dist/`, gitignored paths). Commit with a conventional message. `git push`.
6. Update `STATUS.md`: mark the task done, note blockers or autonomous decisions.
7. Schedule the next iteration via `ScheduleWakeup` (pass `/loop` re-entry).

## Exit conditions (stop scheduling the next wakeup)

- `STATUS.md` shows all tasks checked **and** the latest push succeeded the deploy workflow.
- A build error has persisted across two consecutive iterations (write blocker, stop).
- An unresolvable ambiguity blocks progress (record in `STATUS.md`, stop).

When exiting, do not call `ScheduleWakeup` — the loop ends naturally.

## Invocation

This command effectively runs:

```
/loop <iteration body above, with this repo's CLAUDE.md hard rules applied>
```

with no interval, so the model self-paces between iterations.
