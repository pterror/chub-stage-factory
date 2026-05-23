/*
 * fsm.ts — flat + hierarchical + pushdown state machines as pure functions.
 *
 * WHAT: Define states with `defineState({ on, enter?, exit?, parent? })`. The
 *       Fsm holds a current-state path (the chain from root to leaf for
 *       hierarchical machines) and an optional stack (for pushdown). Events
 *       are dispatched by name; the leaf's `on[event]` runs first, walking
 *       up the parent chain until a handler returns a transition or no
 *       handler exists.
 *
 * WHY: Rule #4 (pure-function transitions, mutable holder for current path),
 *       #5 (no auto-scheduler; state machines react to dispatched events only).
 *
 * SHAPE:
 *   type Transition<C> = { to?: string; push?: string; pop?: true; emit?: any[] } | void
 *   interface StateDef<C> {
 *     parent?: string;
 *     enter?: (ctx, fsm) => void;
 *     exit?: (ctx, fsm) => void;
 *     on?: Record<eventName, (ctx, eventData, fsm) => Transition<C>>;
 *   }
 *   class Fsm<C>
 *     constructor(initial, ctx, states?)
 *     defineState(name, def): this
 *     current(): string
 *     path(): string[]
 *     stack(): string[]
 *     dispatch(event, data?): any[]   // returns concatenated `emit` from handlers
 *     reset(initial?): void
 *     toJSON(): { initial, stack }
 *     static fromJSON(data, ctx, states?): Fsm<C>
 */

export interface TransitionObj<E = unknown> {
  to?: string;
  push?: string;
  pop?: true;
  emit?: E[];
}
export type Transition<E = unknown> = TransitionObj<E> | void;

export interface StateDef<C, E = unknown> {
  parent?: string;
  enter?: (ctx: C, fsm: Fsm<C, E>) => void;
  exit?: (ctx: C, fsm: Fsm<C, E>) => void;
  on?: Record<string, (ctx: C, data: unknown, fsm: Fsm<C, E>) => Transition<E>>;
}

export class Fsm<C, E = unknown> {
  ctx: C;
  private _states: Map<string, StateDef<C, E>> = new Map();
  private _stack: string[] = [];
  private _initial: string;

  constructor(initial: string, ctx: C, states?: Record<string, StateDef<C, E>>) {
    this.ctx = ctx;
    this._initial = initial;
    if (states) for (const [n, def] of Object.entries(states)) this._states.set(n, def);
    this._stack = [initial];
  }

  defineState(name: string, def: StateDef<C, E>): this {
    this._states.set(name, def);
    return this;
  }

  current(): string {
    return this._stack[this._stack.length - 1];
  }

  /** Path from root parent to current leaf. */
  path(): string[] {
    const leaf = this.current();
    const out: string[] = [];
    let cur: string | undefined = leaf;
    while (cur) {
      out.unshift(cur);
      cur = this._states.get(cur)?.parent;
    }
    return out;
  }

  stack(): string[] {
    return [...this._stack];
  }

  /**
   * Dispatch an event. Walks the parent chain of the current leaf looking
   * for a handler. The first one to return a non-void transition wins.
   */
  dispatch(event: string, data?: unknown): E[] {
    const chain: string[] = [];
    let cur: string | undefined = this.current();
    while (cur) {
      chain.push(cur);
      cur = this._states.get(cur)?.parent;
    }
    for (const name of chain) {
      const handler = this._states.get(name)?.on?.[event];
      if (!handler) continue;
      const t = handler(this.ctx, data, this);
      if (!t) continue;
      this._applyTransition(t);
      return t.emit ?? [];
    }
    return [];
  }

  private _applyTransition(t: TransitionObj<E>): void {
    if (t.pop) {
      const exiting = this._stack.pop();
      if (exiting) this._states.get(exiting)?.exit?.(this.ctx, this);
    }
    if (t.push) {
      const def = this._states.get(t.push);
      if (!def) throw new Error(`fsm: unknown state "${t.push}"`);
      this._stack.push(t.push);
      def.enter?.(this.ctx, this);
    }
    if (t.to) {
      const def = this._states.get(t.to);
      if (!def) throw new Error(`fsm: unknown state "${t.to}"`);
      // Run exit walking up to a common ancestor of leaf and new path.
      const oldPath = this.path();
      const newDef = def;
      const newPath: string[] = [];
      let cur: string | undefined = t.to;
      while (cur) {
        newPath.unshift(cur);
        cur = this._states.get(cur)?.parent;
      }
      // common prefix
      let common = 0;
      while (
        common < oldPath.length &&
        common < newPath.length &&
        oldPath[common] === newPath[common]
      )
        common++;
      // exit from leaf upward down to common
      for (let i = oldPath.length - 1; i >= common; i--) this._states.get(oldPath[i])?.exit?.(this.ctx, this);
      // replace leaf (or whole pushdown if there's no stack history)
      this._stack[this._stack.length - 1] = t.to;
      // enter from common downward to new leaf
      for (let i = common; i < newPath.length; i++) this._states.get(newPath[i])?.enter?.(this.ctx, this);
      void newDef;
    }
  }

  reset(initial?: string): void {
    this._stack = [initial ?? this._initial];
  }

  /** Serialize the stack + initial state. State defs (functions) are not serialized. */
  toJSON(): { initial: string; stack: string[] } {
    return { initial: this._initial, stack: [...this._stack] };
  }

  /**
   * Reconstruct an Fsm from a snapshot. States must be re-registered via the
   * `states` argument or via `defineState` after construction (they are not
   * serializable).
   */
  static fromJSON<C, E = unknown>(
    data: { initial: string; stack: string[] },
    ctx: C,
    states?: Record<string, StateDef<C, E>>,
  ): Fsm<C, E> {
    const fsm = new Fsm<C, E>(data.initial, ctx, states);
    fsm._stack = [...data.stack];
    return fsm;
  }
}
