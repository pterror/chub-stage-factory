import ReactDOM from "react-dom/client";
import { DEFAULT_INITIAL } from "@chub-ai/stages-ts";
import { StageRunner } from "./StageRunner.tsx";
// "@stage" resolves to STAGE_PATH/src when set (see vite.config.ts), or
// this factory's own ../../src by default.
import { Stage } from "@stage/Stage.tsx";
import "./runner.css";

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let testInit: any = {};
  try {
    // External stages may not ship a test-init.json; fall back to
    // DEFAULT_INITIAL alone if the import fails.
    testInit = (await import("@stage/assets/test-init.json")).default;
  } catch {
    // no test-init.json for this stage; DEFAULT_INITIAL only
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const initData: any = { ...DEFAULT_INITIAL, ...testInit };

  ReactDOM.createRoot(document.getElementById("root")!).render(
    // StrictMode intentionally omitted: Stage lifecycle hooks (load/beforePrompt/
    // afterResponse) are not idempotent under double-invocation, matching the
    // convention in the root src/main.tsx.
    <StageRunner stageFactory={(data) => new Stage(data)} initData={initData} />,
  );
}

main();
