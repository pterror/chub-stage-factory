import ReactDOM from "react-dom/client";
import { parse as parseYaml } from "yaml";
import { DEFAULT_INITIAL } from "@chub-ai/stages-ts";
import { StageRunner, type StagePosition } from "./StageRunner.tsx";
// "@stage" resolves to STAGE_PATH/src when set (see vite.config.ts), or
// this factory's own ../../src by default.
import { Stage } from "@stage/Stage.tsx";
// "@stage-public" resolves to STAGE_PATH/public (see vite.config.ts).
import chubMetaRaw from "@stage-public/chub_meta.yaml?raw";
import "./runner.css";

const VALID_POSITIONS: StagePosition[] = ["ADJACENT", "NONE", "COVER", "FULLSCREEN"];

function readStagePosition(): StagePosition {
  try {
    const meta = parseYaml(chubMetaRaw) as { position?: string } | null;
    const position = meta?.position;
    if (position && VALID_POSITIONS.includes(position as StagePosition)) {
      return position as StagePosition;
    }
  } catch {
    // chub_meta.yaml missing/unparsable/fully commented-out; fall back below.
  }
  return "ADJACENT";
}

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
  const position = readStagePosition();

  ReactDOM.createRoot(document.getElementById("root")!).render(
    // StrictMode intentionally omitted: Stage lifecycle hooks (load/beforePrompt/
    // afterResponse) are not idempotent under double-invocation, matching the
    // convention in the root src/main.tsx.
    <StageRunner
      stageFactory={(data) => new Stage(data)}
      initData={initData}
      position={position}
    />,
  );
}

main();
