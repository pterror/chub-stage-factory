/*
 * sliding-window-chat.ts — bounded verbatim chat window + timeline capture
 * for rolled-out turns. As turns age out of the ChatWindow FIFO, their
 * content is pushed to a Timeline so the information persists as a
 * summarised event even after the verbatim text is gone.
 *
 * Composes: ChatWindow (chat-window.ts) + context.ts (ContextAssembler /
 * ContextContributor already implemented by ChatWindow) + Timeline.
 *
 * Source: SillyTavern Summarize extension sliding-window; AID Memory System
 * "rolling summary" pattern — verbatim recent turns + summarised distant turns.
 * (SYNERGY.md §"sliding-window-chat").
 *
 * NOTE: The "I want a 200-turn raw history" path requires explicit
 * `size: 200` plus awareness of what that costs in context tokens.
 * The defaults (5–10 turns) are intentional; see `size` option below.
 */

import type { Timeline } from "../../timeline";
import { ChatWindow, type ChatWindowOptions, type Turn } from "../../chat-window";
import type { ComposedSubsystem } from "./types";

export interface SlidingWindowChatOptions<E> {
  /**
   * Max verbatim turns retained. Older turns roll out into the timeline.
   * Defaults to 8 — roughly one exchange with multi-part replies.
   * Stages that want a wider verbatim window must opt in explicitly.
   */
  size?: number;
  /** Timeline that receives rolled-out turns as events. */
  timeline: Timeline<E>;
  /**
   * Convert a rolled-out Turn into a timeline event payload.
   * Called for each turn as it rolls out of the window.
   * Default: `(t) => ({ role: t.isBot ? "assistant" : "user", content: t.content })`.
   */
  toEvent?: (turn: Turn) => E;
  /** ChatWindow id forwarded to ContextAssembler. Default: "sliding-window-chat". */
  id?: string;
  /** ChatWindow priority. Default: 80. */
  priority?: number;
}

export interface SlidingWindowChatState {
  /** The live ChatWindow. Its `contribute` method fulfils ContextContributor. */
  window: ChatWindow;
  /** Count of turns rolled out so far (informational). */
  rolledCount: number;
}

/**
 * `slidingWindowChatPattern(opts)` returns a `ComposedSubsystem` whose state
 * owns the `ChatWindow`. The window itself is a `ContextContributor`, so
 * register `state.window` directly with a `ContextAssembler`.
 *
 * Typical stage wiring:
 *
 *   ```ts
 *   const swc = slidingWindowChatPattern({ size: 8, timeline });
 *   assembler.register(swc.state.window);  // window IS a ContextContributor
 *
 *   // In beforePrompt / afterResponse:
 *   swc.state.window.push(incomingTurn);
 *   ```
 */
export function slidingWindowChatPattern<E>(
  opts: SlidingWindowChatOptions<E>,
): ComposedSubsystem<SlidingWindowChatState> & {
  /** Push a turn into the window. Rolled-out turns are captured to the timeline. */
  push(turn: Turn): void;
  /** Push all turns (e.g. on stage load). Rolled-out turns captured to timeline. */
  pushAll(turns: Iterable<Turn>): void;
} {
  const id = opts.id ?? "sliding-window-chat";
  const size = opts.size ?? 8;
  const toEvent: (turn: Turn) => E =
    opts.toEvent ??
    ((t) =>
      ({
        role: t.isBot ? "assistant" : "user",
        content: t.content,
      }) as unknown as E);

  const window = new ChatWindow({
    id,
    priority: opts.priority ?? 80,
    size,
    summarizeOlder(rolled: Turn[]) {
      const now = Date.now();
      for (const turn of rolled) {
        opts.timeline.push(toEvent(turn), now);
        state.rolledCount += 1;
      }
    },
  } satisfies ChatWindowOptions);

  const state: SlidingWindowChatState = { window, rolledCount: 0 };

  function push(turn: Turn): void {
    window.push(turn);
  }

  function pushAll(turns: Iterable<Turn>): void {
    window.pushAll(turns);
  }

  return {
    state,
    // ChatWindow IS already a ContextContributor; expose as contributors array
    // so orchestrators that walk ComposedSubsystem.contributors pick it up.
    contributors: [window],
    shards: [
      {
        id,
        // Persist the verbatim window turns for save/load.
        get value() {
          return window.toJSON();
        },
      },
    ],
    push,
    pushAll,
  };
}
