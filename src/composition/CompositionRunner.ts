import { ReactElement } from "react";
import { StageBase, InitialData, StageResponse } from "@chub-ai/stages-ts";
import { LoadResponse } from "@chub-ai/stages-ts/dist/types/load";
import { getExample } from "../../examples/registry";
import type { DelegatorConfigComposed, LayoutKind } from "./types";
import { mergeComposedResponses } from "./merge";
import { CompositionLayout } from "../lib/ui/CompositionLayout";
import {
  hasIntrospect,
  type StageIntrospect,
  type VerbDescriptor,
  type StageDescriptor,
  type InvocationResult,
} from "../lib/introspect";

/**
 * CompositionRunner — helper that manages a set of child StageBase instances
 * and fans out lifecycle calls to them, namespacing all state by instance id.
 *
 * It is NOT a StageBase itself; Stage holds either an `inner` (single path)
 * or a `runner` (composed path) and dispatches accordingly.
 */
export class CompositionRunner {
  children: Map<string, StageBase<any, any, any, any>>;
  instanceIds: string[];
  layout: LayoutKind;

  private lastMessageState: Record<string, any> = {};
  private lastChatState: Record<string, any> = {};

  constructor(data: InitialData<any, any, any, DelegatorConfigComposed>) {
    const cfg = data.config!;
    this.layout = cfg.layout;

    // Validate unique ids
    const seenIds = new Set<string>();
    for (const inst of cfg.instances) {
      if (seenIds.has(inst.id)) {
        throw new Error(
          `[CompositionRunner] duplicate instance id: "${inst.id}"`,
        );
      }
      seenIds.add(inst.id);
    }

    // Build hookOrder: validated hookOrder entries first, then remaining in declaration order
    const declaredIds = cfg.instances.map((i) => i.id);
    if (cfg.hookOrder && cfg.hookOrder.length > 0) {
      const missing = cfg.hookOrder.filter((id) => !seenIds.has(id));
      if (missing.length > 0) {
        throw new Error(
          `[CompositionRunner] hookOrder references unknown ids: ${missing.join(", ")}`,
        );
      }
      const hookSet = new Set(cfg.hookOrder);
      const tail = declaredIds.filter((id) => !hookSet.has(id));
      this.instanceIds = [...cfg.hookOrder, ...tail];
    } else {
      this.instanceIds = declaredIds;
    }

    // Construct children
    this.children = new Map();
    for (const inst of cfg.instances) {
      const entry = getExample(inst.stage);
      if (!entry) {
        throw new Error(
          `[CompositionRunner] unknown stage "${inst.stage}" for instance "${inst.id}"`,
        );
      }
      const projected: InitialData<any, any, any, any> = {
        ...data,
        config: { instanceId: inst.id },
        messageState: (data.messageState as any)?.[inst.id] ?? null,
        chatState: (data.chatState as any)?.[inst.id] ?? null,
        initState: (data.initState as any)?.[inst.id] ?? null,
      };
      this.children.set(inst.id, entry.factory(projected));
    }
  }

  async load(): Promise<Partial<LoadResponse<any, any, any>>> {
    const results = await Promise.all(
      this.instanceIds.map(async (id) => ({
        id,
        resp: await this.children.get(id)!.load(),
      })),
    );

    const initState: Record<string, any> = {};
    const messageState: Record<string, any> = {};
    const chatState: Record<string, any> = {};
    let error: string | null = null;
    let success = true;

    for (const { id, resp } of results) {
      if (resp.initState !== undefined) initState[id] = resp.initState;
      if (resp.messageState !== undefined) messageState[id] = resp.messageState;
      if (resp.chatState !== undefined) chatState[id] = resp.chatState;

      if (resp.error != null && error == null) {
        error = resp.error;
      }
      if (resp.success === false) {
        success = false;
      }
    }

    // Populate caches with load() results.
    this.lastMessageState = { ...messageState };
    this.lastChatState = { ...chatState };

    return {
      success,
      error,
      initState: Object.keys(initState).length > 0 ? initState : null,
      messageState: Object.keys(messageState).length > 0 ? messageState : null,
      chatState: Object.keys(chatState).length > 0 ? chatState : null,
    };
  }

  async setState(state: any): Promise<void> {
    for (const id of this.instanceIds) {
      // If state is null/undefined entirely, treat all keys as absent (use cache).
      // If state is an object, use `id in state` to distinguish present-but-null
      // (explicit reset) from absent (fall back to cache).
      const resolved =
        state != null && typeof state === "object" && id in state
          ? state[id]
          : this.lastMessageState[id] ?? null;
      await this.children.get(id)!.setState(resolved);
    }
  }

  async beforePrompt(
    msg: Parameters<StageBase<any, any, any, any>["beforePrompt"]>[0],
  ): Promise<ReturnType<StageBase<any, any, any, any>["beforePrompt"]>> {
    type Resp = ReturnType<StageBase<any, any, any, any>["beforePrompt"]> extends Promise<infer R> ? R : never;
    let acc: Resp = {};
    // Pipeline: each child sees the previous child's modifiedMessage (if non-null).
    let pipedMessage = msg;
    let lastModifiedMessage: string | null = null;
    for (const id of this.instanceIds) {
      const childResp: Partial<StageResponse<any, any>> = await this.children.get(id)!.beforePrompt(pipedMessage);
      acc = mergeComposedResponses(acc, id, childResp);
      // Update per-instance state caches.
      if (childResp?.messageState !== undefined) {
        this.lastMessageState[id] = childResp.messageState;
      }
      if (childResp?.chatState !== undefined) {
        this.lastChatState[id] = childResp.chatState;
      }
      // Thread modifiedMessage forward.
      if (childResp?.modifiedMessage != null) {
        lastModifiedMessage = childResp.modifiedMessage;
        pipedMessage = { ...pipedMessage, content: lastModifiedMessage as string };
      }
    }
    return { ...acc, modifiedMessage: lastModifiedMessage };
  }

  async afterResponse(
    msg: Parameters<StageBase<any, any, any, any>["afterResponse"]>[0],
  ): Promise<ReturnType<StageBase<any, any, any, any>["afterResponse"]>> {
    type Resp = ReturnType<StageBase<any, any, any, any>["afterResponse"]> extends Promise<infer R> ? R : never;
    let acc: Resp = {};
    // Pipeline: each child sees the previous child's modifiedMessage (if non-null).
    let pipedMessage = msg;
    let lastModifiedMessage: string | null = null;
    for (const id of this.instanceIds) {
      const childResp: Partial<StageResponse<any, any>> = await this.children.get(id)!.afterResponse(pipedMessage);
      acc = mergeComposedResponses(acc, id, childResp);
      // Update per-instance state caches.
      if (childResp?.messageState !== undefined) {
        this.lastMessageState[id] = childResp.messageState;
      }
      if (childResp?.chatState !== undefined) {
        this.lastChatState[id] = childResp.chatState;
      }
      // Thread modifiedMessage forward.
      if (childResp?.modifiedMessage != null) {
        lastModifiedMessage = childResp.modifiedMessage;
        pipedMessage = { ...pipedMessage, content: lastModifiedMessage as string };
      }
    }
    return { ...acc, modifiedMessage: lastModifiedMessage };
  }

  render(): ReactElement {
    return CompositionLayout({
      layout: this.layout,
      panels: this.instanceIds.map((id) => ({
        id,
        node: this.children.get(id)!.render(),
      })),
    });
  }

  /* -------------------- StageIntrospect (fan-out) -------------------- *
   * The runner implements StageIntrospect when ANY child does. Child
   * verb names are namespaced by instance id ("<id>:<name>") so they
   * don't collide. Children that do not implement StageIntrospect
   * contribute zero verbs but still appear in describe() output.
   *
   * Per INTROSPECT.md: invokeVerb routes through the child's beforePrompt
   * (because the child's invokeVerb implementation must do so).
   * ------------------------------------------------------------------ */

  /** True when at least one child implements StageIntrospect. */
  hasIntrospectableChild(): boolean {
    for (const id of this.instanceIds) {
      if (hasIntrospect(this.children.get(id))) return true;
    }
    return false;
  }

  availableVerbs(): VerbDescriptor[] {
    const out: VerbDescriptor[] = [];
    for (const id of this.instanceIds) {
      const child = this.children.get(id);
      if (!hasIntrospect(child)) continue;
      for (const v of child.availableVerbs()) {
        out.push({
          ...v,
          name: `${id}:${v.name}`,
          group: v.group ?? id,
        });
      }
    }
    return out;
  }

  describe(): StageDescriptor {
    const lines: string[] = [];
    const details: Record<string, unknown> = {};
    let verbCount = 0;
    for (const id of this.instanceIds) {
      const child = this.children.get(id);
      if (hasIntrospect(child)) {
        const d = (child as StageIntrospect).describe();
        lines.push(`[${id}] ${d.summary}`);
        details[id] = d.details ?? null;
        verbCount += d.verbCount ?? (child as StageIntrospect).availableVerbs().length;
      } else {
        lines.push(`[${id}] (no introspect)`);
        details[id] = null;
      }
    }
    return {
      summary: lines.join("\n"),
      details,
      verbCount,
    };
  }

  async invokeVerb(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<InvocationResult> {
    const sep = name.indexOf(":");
    if (sep <= 0) {
      return { ok: false, error: `composed verb "${name}" must be "<instanceId>:<verb>"` };
    }
    const id = name.slice(0, sep);
    const inner = name.slice(sep + 1);
    const child = this.children.get(id);
    if (!child) {
      return { ok: false, error: `unknown instance id "${id}"` };
    }
    if (!hasIntrospect(child)) {
      return { ok: false, error: `instance "${id}" does not implement StageIntrospect` };
    }
    const result = await (child as StageIntrospect).invokeVerb(inner, args);
    // Mirror state into the runner's caches so subsequent setState calls
    // fall back correctly.
    if (result.messageState !== undefined) {
      this.lastMessageState[id] = result.messageState;
    }
    if (result.chatState !== undefined) {
      this.lastChatState[id] = result.chatState;
    }
    return result;
  }
}
