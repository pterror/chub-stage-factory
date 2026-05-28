/*
 * patterns/dialogue.ts — Fsm with say/choices semantics + predicate-gated
 *                         transitions. Enables Zork-shape (#2).
 *
 * WHAT: `dialoguePattern(init)` wires an Fsm whose states carry dialogue
 *       payloads (a `say` string) and player-facing `choices`. Each choice
 *       has an optional `Predicate<S>` guard; `availableChoices(state, refs,
 *       resolvers)` filters to the ones that pass. `choose(id, data?)` is the
 *       single dispatch surface: it fires the underlying `Fsm.dispatch` with
 *       the choice id and returns the new state's `say` string.
 *
 *       Composes: `Fsm` + `Predicate` + `evaluate`.
 *
 * WHY: Zork-shape needs a dialogue FSM that gates choices on world predicates
 *      (has-item, stat-tier, world-flag). The raw Fsm exposes transitions as
 *      event handlers — useful but not the dialogue surface. This pattern adds
 *      the dialogue vocabulary (say / choices) without any new mechanics.
 *
 * SHAPE:
 *   interface DialogueChoice<S>
 *     { id; label; when?: Predicate<S> }
 *   interface DialogueState<S>
 *     { say: string; choices: DialogueChoice<S>[] }
 *   type DialogueFsmDef<C, S> = Record<string, StateDef<C> & DialogueState<S>>
 *   interface DialogueBundle<C, S, A>
 *     { fsm; current(); say(): string;
 *       availableChoices(state, refs, resolvers?): DialogueChoice<S>[];
 *       choose(id, data?): string | null }
 *   function dialoguePattern<C, S, A>(init): DialogueBundle<C, S, A>
 */

import { Fsm, type StateDef } from "../../fsm";
import { type Predicate, type Refs, type Resolvers, evaluate } from "../../predicate";

export interface DialogueChoice<S = unknown> {
  /** Choice id, used as the Fsm event name. */
  id: string;
  /** Player-visible label. */
  label: string;
  /** Guard: if omitted the choice is always visible. */
  when?: Predicate<S>;
}

export interface DialogueStateDef<C, S = unknown, E = unknown> extends StateDef<C, E> {
  /** Line(s) the NPC says on entering this state. */
  say: string;
  /** Choices presented to the player while in this state. */
  choices?: DialogueChoice<S>[];
}

export interface DialogueBundleInit<C, S = unknown, E = unknown> {
  initial: string;
  ctx: C;
  states: Record<string, DialogueStateDef<C, S, E>>;
}

export interface DialogueBundle<C, S = unknown, E = unknown> {
  fsm: Fsm<C, E>;
  /** Current state name. */
  current(): string;
  /** The `say` string for the current state. */
  say(): string;
  /** Choices filtered by their `when` predicate against the provided state. */
  availableChoices(state: S, refs: Refs, resolvers?: Resolvers<S>): DialogueChoice<S>[];
  /**
   * Dispatch a choice. Fires `Fsm.dispatch(id, data)`. Returns the new
   * state's `say` string, or null if the fsm emitted no transition.
   */
  choose(id: string, data?: unknown): string | null;
  /** Raw states map — for inspection / dynamic mutation by stage author. */
  states: Record<string, DialogueStateDef<C, S, E>>;
}

export function dialoguePattern<C, S = unknown, E = unknown>(
  init: DialogueBundleInit<C, S, E>,
): DialogueBundle<C, S, E> {
  const fsm = new Fsm<C, E>(init.initial, init.ctx);
  for (const [name, def] of Object.entries(init.states)) {
    // Register each state; choices piggyback on the def's `on` map.
    // We pass the def through as-is — Fsm only reads known fields.
    fsm.defineState(name, def);
  }

  const currentDef = (): DialogueStateDef<C, S, E> | undefined =>
    init.states[fsm.current()];

  return {
    fsm,
    states: init.states,
    current(): string {
      return fsm.current();
    },
    say(): string {
      return currentDef()?.say ?? "";
    },
    availableChoices(state: S, refs: Refs, resolvers?: Resolvers<S>): DialogueChoice<S>[] {
      const def = currentDef();
      if (!def?.choices) return [];
      return def.choices.filter((c) =>
        c.when ? evaluate(c.when, state, refs, resolvers) : true,
      );
    },
    choose(id: string, data?: unknown): string | null {
      const before = fsm.current();
      fsm.dispatch(id, data);
      const after = fsm.current();
      // Return the new say if a transition occurred, or current say if not.
      if (after !== before || init.states[after]) {
        return currentDef()?.say ?? null;
      }
      return null;
    },
  };
}
