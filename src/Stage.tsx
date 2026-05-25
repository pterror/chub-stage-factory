import {ReactElement} from "react";
import {StageBase, StageResponse, InitialData, Message} from "@chub-ai/stages-ts";
import {LoadResponse} from "@chub-ai/stages-ts/dist/types/load";
import {getExample} from "../examples/registry";
import type {ExampleName} from "../examples/registry";
import type {DelegatorConfigComposed} from "./composition/types";
import {parseComposedInstances} from "./composition/types";
import {CompositionRunner} from "./composition/CompositionRunner";

/***
 DelegatorConfig — discriminated union over registered example names.
 Single variant: { stage: ExampleName } selects one example to delegate to.
 Composed variant: carries instances, layout, and optional hookOrder.
 Phase 3: composed variant introduced; single-stage chats remain valid.
 ***/
export type DelegatorConfigSingle = { stage: ExampleName };
export type DelegatorConfig = DelegatorConfigSingle | DelegatorConfigComposed;

/** Raw config shape as Chub hands it in from config_schema YAML fields. */
interface RawChubConfig {
  stage?: string;
  composed_instances?: string[];
  layout?: string;
  hook_order?: string[];
}

/***
 Top-level delegator stage.
 ConfigType is a discriminated union over registered examples; the
 delegator instantiates the chosen example's StageBase and forwards
 every lifecycle call to it.
 ***/
export class Stage extends StageBase<any, any, any, DelegatorConfig> {

    inner?: StageBase<any, any, any, any>;
    runner?: CompositionRunner;

    constructor(data: InitialData<any, any, any, DelegatorConfig>) {
        super(data);
        const raw = data.config as RawChubConfig | null;

        // Detect composed mode: layout is tabs|stack OR composed_instances is non-empty
        const isComposed =
          (raw?.layout === "tabs" || raw?.layout === "stack") ||
          (Array.isArray(raw?.composed_instances) && (raw!.composed_instances!.length > 0));

        if (isComposed) {
            const instances = parseComposedInstances(raw?.composed_instances ?? []);
            const layout = (raw?.layout === "tabs" || raw?.layout === "stack")
                ? raw!.layout as "tabs" | "stack"
                : "stack";
            const composedConfig: DelegatorConfigComposed = {
                kind: "composed",
                instances,
                layout,
                hookOrder: raw?.hook_order,
            };
            const composedData: InitialData<any, any, any, DelegatorConfigComposed> = {
                ...data,
                config: composedConfig,
            };
            this.runner = new CompositionRunner(composedData);
        } else {
            // Single-stage path — unchanged from Phase 1/2
            const stageName = (raw?.stage ?? "world-primary") as string;
            const entry = getExample(stageName) ?? (() => {
                console.warn(`[delegator] unknown stage "${stageName}", falling back to world-primary`);
                return getExample("world-primary")!;
            })();
            this.inner = entry.factory(data);
        }
    }

    async load(): Promise<Partial<LoadResponse<any, any, any>>> {
        if (this.runner) return this.runner.load();
        return this.inner!.load();
    }

    async setState(state: any): Promise<void> {
        if (this.runner) return this.runner.setState(state);
        return this.inner!.setState(state);
    }

    async beforePrompt(userMessage: Message): Promise<Partial<StageResponse<any, any>>> {
        if (this.runner) return this.runner.beforePrompt(userMessage);
        return this.inner!.beforePrompt(userMessage);
    }

    async afterResponse(botMessage: Message): Promise<Partial<StageResponse<any, any>>> {
        if (this.runner) return this.runner.afterResponse(botMessage);
        return this.inner!.afterResponse(botMessage);
    }

    render(): ReactElement {
        if (this.runner) return this.runner.render();
        return this.inner!.render();
    }
}
