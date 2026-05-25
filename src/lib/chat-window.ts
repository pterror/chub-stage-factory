// @experimental — used by 0-1 callers; API may change.
/*
 * chat-window.ts — bounded recent-turns window with summarize-on-roll-out.
 *
 * WHAT: A tiny FIFO of the last N chat `Message`s (Chub's Message type),
 *       plus an optional `summarizeOlder` hook fired with the turns that
 *       roll out as new ones come in. Implements `ContextContributor` so it
 *       drops into a `ContextAssembler` with no adapter; renders its turns
 *       verbatim as a single context section. `toJSON`/`fromJSON` persist
 *       the buffer (the hook is stage-author code, re-attached on load).
 *
 * WHY: Every chat-bound stage wants the same primitive: "keep the last N
 *      turns raw; capture the rest as Timeline events / summarized prose
 *      before they drop." This is the verbatim half. The summarize hook
 *      lets the stage author wire in `Timeline.push` + tag-parser
 *      extraction without ChatWindow having to know about either.
 *
 * SHAPE:
 *   type Turn = Message                                       // re-exported
 *   interface ChatWindowOptions
 *     { id?; priority?; size; summarizeOlder?: (rolled) => void }
 *   class ChatWindow implements ContextContributor
 *     id; priority; size
 *     constructor(opts)
 *     push(turn): Turn[]               // rolled-out turns
 *     pushAll(turns)
 *     turns(): readonly Turn[]
 *     last(): Turn | undefined
 *     count(): number
 *     clear()
 *     contribute(ctx): Section | null  // ContextContributor surface
 *     toJSON(): Turn[]
 *     static fromJSON(data, opts): ChatWindow
 */

import type { Message } from "@chub-ai/stages-ts/dist/types/message";
import type { AssemblyContext, ContextContributor, Section } from "./context";
import { estimateTokens } from "./context";

export type Turn = Message;

export interface ChatWindowOptions {
  /** ContextContributor id; defaults to "chat-window". */
  id?: string;
  /** ContextContributor priority; defaults to 80 (high — recent turns are
   *  near-essential context for any chat-bound stage). */
  priority?: number;
  /** Maximum verbatim turns retained. Older turns drop FIFO (and feed
   *  `summarizeOlder` if provided). */
  size: number;
  /** Called with the turns that just rolled out of the window. Stage
   *  authors typically push these into a Timeline (with tag-parser
   *  extraction or LLM summarization) so information persists even after
   *  the verbatim text doesn't. */
  summarizeOlder?: (rolled: Turn[]) => void;
}

export class ChatWindow implements ContextContributor {
  readonly id: string;
  readonly priority: number;
  readonly size: number;
  private buffer: Turn[] = [];
  private summarizeOlder?: (rolled: Turn[]) => void;

  constructor(opts: ChatWindowOptions) {
    this.id = opts.id ?? "chat-window";
    this.priority = opts.priority ?? 80;
    this.size = Math.max(0, opts.size);
    this.summarizeOlder = opts.summarizeOlder;
  }

  /** Append a turn; if the buffer overflows, the rolled-out turns are
   *  returned (and also handed to `summarizeOlder` if configured). */
  push(turn: Turn): Turn[] {
    this.buffer.push(turn);
    const rolled: Turn[] = [];
    while (this.buffer.length > this.size) rolled.push(this.buffer.shift()!);
    if (rolled.length && this.summarizeOlder) this.summarizeOlder(rolled);
    return rolled;
  }

  pushAll(turns: Iterable<Turn>): void {
    for (const t of turns) this.push(t);
  }

  turns(): readonly Turn[] {
    return this.buffer;
  }

  last(): Turn | undefined {
    return this.buffer[this.buffer.length - 1];
  }

  count(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer = [];
  }

  contribute(_ctx: AssemblyContext): Section | null {
    if (this.buffer.length === 0) return null;
    const lines = this.buffer.map((m) => {
      const speaker = m.isBot ? "assistant" : "user";
      return `${speaker}: ${m.content}`;
    });
    const content = `<recent-turns>\n${lines.join("\n")}\n</recent-turns>`;
    return {
      id: this.id,
      content,
      tokens: estimateTokens(content),
      optional: false,
    };
  }

  toJSON(): Turn[] {
    return this.buffer.slice();
  }

  static fromJSON(data: Turn[], opts: ChatWindowOptions): ChatWindow {
    const w = new ChatWindow(opts);
    // bypass push() to avoid firing summarizeOlder on restore
    w.buffer = data.slice(-w.size);
    return w;
  }
}
