---
description: Run a prompt or slash command on a recurring interval. Omit the interval to let the model self-pace. Use when the user wants a recurring task, polling, or repeated execution (e.g. "/loop 5m /foo", "keep running X"). Do NOT invoke for one-off tasks.
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, ScheduleWakeup, CronCreate]
---

# /loop

Drive a task on a schedule. Two modes:

## Dynamic (self-paced) — interval omitted

The user invoked `/loop <prompt>` with no interval. You execute one iteration of `<prompt>` now, then decide when to wake up next.

Each turn:

1. Do one iteration of the task described in `<prompt>`.
2. Decide whether the loop should continue. If the task's own exit condition is met (e.g. all work done, blocker requires user), stop — do not call `ScheduleWakeup`.
3. Otherwise call `ScheduleWakeup` with:
   - `prompt`: the same `/loop <prompt>` text verbatim, so the next firing re-enters this skill.
   - `delaySeconds`: pick based on what you're waiting for. Under 5 min (60–270s) keeps the prompt cache warm; longer waits (1200–1800s default) amortize a cache miss. Don't pick exactly 300s.
   - `reason`: one short sentence — "checking build", "waiting on deploy", etc.

Omitting the `ScheduleWakeup` call ends the loop.

## Fixed-interval — `/loop <interval> <prompt>`

Create a cron entry with `CronCreate` that fires `<prompt>` every `<interval>`. Confirm to the user. The user stops it with `CronDelete` / `CronList`.

## In this repo

`/build-stage` invokes this skill in dynamic mode to drive the autonomous build. Exit condition: `STATUS.md` shows all tasks complete OR a build error has persisted across two iterations (write blocker to `STATUS.md` and stop).
