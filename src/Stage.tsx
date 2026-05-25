import {ReactElement} from "react";
import {StageBase, StageResponse, InitialData, Message} from "@chub-ai/stages-ts";
import {LoadResponse} from "@chub-ai/stages-ts/dist/types/load";
import {getExample} from "../examples/registry";

/***
 DelegatorConfig — discriminated union over registered example names.
 Phase 1: single `stage` field selects the example to delegate to.
 Phase 3 will introduce a `kind` discriminator for composite modes.
 ***/
export type DelegatorConfig =
  | { stage: "world-primary" }
  | { stage: "inventory" }
  | { stage: "effects" }
  | { stage: "turn-combat" }
  | { stage: "tits-body" }
  | { stage: "cyber-slots" }
  | { stage: "physics" }
  | { stage: "realtime-combat" }
  | { stage: "composite-showcase" };

/***
 Top-level delegator stage.
 ConfigType is a discriminated union over registered examples; the
 delegator instantiates the chosen example's StageBase and forwards
 every lifecycle call to it.
 ***/
export class Stage extends StageBase<any, any, any, DelegatorConfig> {

    inner: StageBase<any, any, any, any>;

    constructor(data: InitialData<any, any, any, DelegatorConfig>) {
        super(data);
        const stageName = (data.config?.stage ?? "world-primary") as string;
        const entry = getExample(stageName) ?? (() => {
            console.warn(`[delegator] unknown stage "${stageName}", falling back to world-primary`);
            return getExample("world-primary")!;
        })();
        this.inner = entry.factory(data);
    }

    async load(): Promise<Partial<LoadResponse<any, any, any>>> {
        return this.inner.load();
    }

    async setState(state: any): Promise<void> {
        return this.inner.setState(state);
    }

    async beforePrompt(userMessage: Message): Promise<Partial<StageResponse<any, any>>> {
        return this.inner.beforePrompt(userMessage);
    }

    async afterResponse(botMessage: Message): Promise<Partial<StageResponse<any, any>>> {
        return this.inner.afterResponse(botMessage);
    }

    render(): ReactElement {
        return this.inner.render();
    }
}
