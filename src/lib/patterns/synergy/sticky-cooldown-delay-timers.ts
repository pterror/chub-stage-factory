/*
 * sticky-cooldown-delay-timers.ts — SillyTavern WI Timed Effects
 * composer. Per-entry `sticky` (force fire for N turns after first
 * fire), `cooldown` (block fire for N turns after first fire), and
 * `delay` (block fire until N turns from now / from registration)
 * timers — all driven by a single Scheduler tick that decrements the
 * counter map.
 *
 * Composes: Registry + ConditionalTrigger.cooldown + Scheduler turn
 * counter + a Shard-shaped state map. Not a new state machine.
 *
 * Source: SillyTavern WI Timed Effects.
 */

import type { ComposedSubsystem } from "./types";

export interface TimerState {
  sticky: number;
  cooldown: number;
  delay: number;
}

export interface TimedEntry {
  id: string;
  sticky?: number;
  cooldown?: number;
  delay?: number;
}

export interface StickyCooldownDelayTimersOptions {
  entries: TimedEntry[];
}

export interface StickyCooldownState {
  timers: Record<string, TimerState>;
}

export function stickyCooldownDelayTimersPattern(
  opts: StickyCooldownDelayTimersOptions,
): ComposedSubsystem<StickyCooldownState> {
  const state: StickyCooldownState = { timers: {} };
  for (const e of opts.entries) {
    state.timers[e.id] = {
      sticky: e.sticky ?? 0,
      cooldown: 0,
      delay: e.delay ?? 0,
    };
  }

  function shouldFire(id: string): boolean {
    const t = state.timers[id];
    if (!t) return true;
    if (t.delay > 0) return false;
    if (t.cooldown > 0) return false;
    return true;
  }

  function markFired(id: string): void {
    const t = state.timers[id];
    const cfg = opts.entries.find((e) => e.id === id);
    if (!t || !cfg) return;
    if (cfg.sticky) t.sticky = cfg.sticky;
    if (cfg.cooldown) t.cooldown = cfg.cooldown;
  }

  function tick(_now: number): void {
    for (const [, t] of Object.entries(state.timers)) {
      if (t.delay > 0) t.delay--;
      if (t.sticky > 0) t.sticky--;
      if (t.cooldown > 0) t.cooldown--;
    }
  }

  return {
    state,
    hooks: { tick, shouldFire, markFired } as unknown as ComposedSubsystem<StickyCooldownState>["hooks"],
    shards: [{ id: "wi-timers", value: state }],
  };
}
