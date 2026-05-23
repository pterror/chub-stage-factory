import { ReactRunner } from "@chub-ai/stages-ts";
import { Stage } from "./Stage";
import { TestStageRunner } from "./TestRunner";
import { ExamplePicker } from "./ExamplePicker";
import { getExample } from "../examples/registry";

function App() {
  const isDev = import.meta.env.MODE === "development";
  const exampleName = ((import.meta.env.VITE_EXAMPLE as string | undefined) ?? "").trim();
  console.info(`Running in ${import.meta.env.MODE}` + (exampleName ? ` (example=${exampleName})` : ""));

  if (exampleName) {
    const entry = getExample(exampleName);
    if (!entry) {
      return (
        <div style={{ padding: 16, fontFamily: "monospace", color: "#c33" }}>
          Unknown VITE_EXAMPLE=&quot;{exampleName}&quot;. Check examples/registry.ts.
        </div>
      );
    }
    if (isDev) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const factory = (d: any) => entry.factory({ ...entry.testInit, ...d });
      return <TestStageRunner factory={factory} />;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return <ReactRunner factory={(d: any) => entry.factory(d)} />;
  }

  if (isDev) return <ExamplePicker />;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <ReactRunner factory={(data: any) => new Stage(data)} />;
}

export default App;
