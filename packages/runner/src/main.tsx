import ReactDOM from "react-dom/client";
import { DEFAULT_INITIAL } from "@chub-ai/stages-ts";
import { StageRunner } from "./StageRunner.tsx";
import { Stage } from "../../../src/Stage.tsx";
import testInit from "../../../src/assets/test-init.json";
import "./runner.css";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const initData: any = { ...DEFAULT_INITIAL, ...testInit };

ReactDOM.createRoot(document.getElementById("root")!).render(
  // StrictMode intentionally omitted: Stage lifecycle hooks (load/beforePrompt/
  // afterResponse) are not idempotent under double-invocation, matching the
  // convention in the root src/main.tsx.
  <StageRunner stageFactory={(data) => new Stage(data)} initData={initData} />,
);
