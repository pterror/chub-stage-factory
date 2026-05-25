/*
 * _test-counter/Stage.tsx — minimal stage for composed-mode smoke testing.
 *
 * Behaviour:
 *   - beforePrompt: increments messageState.count, sets modifiedMessage to
 *     "[<id>:<count>] <original content>" to demonstrate pipelining.
 *   - afterResponse: increments messageState.responseCount.
 *   - messageState: { count: number; responseCount: number; lastContent: string }
 *
 * Prefixed with `_` so promote-example.mjs walks skip it (examples/ is deleted
 * wholesale; no special filter needed).
 */

import { ReactElement } from "react";
import { StageBase, StageResponse, InitialData, Message } from "@chub-ai/stages-ts";
import { LoadResponse } from "@chub-ai/stages-ts/dist/types/load";

interface CounterState {
  count: number;
  responseCount: number;
  lastContent: string;
  instanceId: string;
}

type CounterConfig = { instanceId?: string } | null;

export class TestCounterStage extends StageBase<null, null, CounterState, CounterConfig> {
  private ms: CounterState;

  constructor(data: InitialData<null, null, CounterState, CounterConfig>) {
    super(data);
    const id = (data.config as any)?.instanceId ?? "counter";
    this.ms = data.messageState ?? {
      count: 0,
      responseCount: 0,
      lastContent: "",
      instanceId: id,
    };
  }

  async load(): Promise<Partial<LoadResponse<null, null, CounterState>>> {
    return {
      success: true,
      error: null,
      initState: null,
      chatState: null,
      messageState: { ...this.ms },
    };
  }

  async setState(state: CounterState): Promise<void> {
    if (state) this.ms = { ...this.ms, ...state };
  }

  async beforePrompt(
    msg: Message,
  ): Promise<Partial<StageResponse<null, CounterState>>> {
    this.ms = {
      ...this.ms,
      count: this.ms.count + 1,
      lastContent: msg.content ?? "",
    };
    const tag = `[${this.ms.instanceId}:${this.ms.count}]`;
    const modified = `${tag} ${msg.content ?? ""}`.trim();
    return {
      messageState: { ...this.ms },
      modifiedMessage: modified,
    };
  }

  async afterResponse(
    _msg: Message,
  ): Promise<Partial<StageResponse<null, CounterState>>> {
    this.ms = { ...this.ms, responseCount: this.ms.responseCount + 1 };
    return {
      messageState: { ...this.ms },
    };
  }

  render(): ReactElement {
    return (
      <div style={{ fontFamily: "monospace", padding: "8px" }}>
        <strong>TestCounter [{this.ms.instanceId}]</strong>
        <div>count: {this.ms.count}</div>
        <div>responseCount: {this.ms.responseCount}</div>
        <div>lastContent: {this.ms.lastContent}</div>
      </div>
    );
  }
}
