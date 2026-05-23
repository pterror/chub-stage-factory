/*
 * ExamplePicker — dev-mode sidebar+pane UI for browsing example stages.
 *
 * Lists every entry in examples/registry.ts plus the user's own src/Stage.tsx
 * (labeled "User stage"). Mounting an example unmounts the previous one.
 * Intentionally minimal styling; this is dev-only scaffolding.
 */

import { useState } from "react";
import { DEFAULT_INITIAL, StageBase } from "@chub-ai/stages-ts";
import { Stage as UserStage } from "./Stage";
import { TestStageRunner } from "./TestRunner";
import { EXAMPLES, ExampleEntry } from "../examples/registry";

const USER_ENTRY: ExampleEntry = {
  name: "__user__",
  label: "User stage (src/Stage.tsx)",
  description: "Your own stage scaffold. Edit src/Stage.tsx then refresh.",
  primitives: [],
  factory: (d) => new UserStage(d),
  testInit: {},
};

const ALL = [USER_ENTRY, ...EXAMPLES];

function Entry({ entry }: { entry: ExampleEntry }) {
  // Key on entry.name forces remount when the user picks a different example.
  return (
    <TestStageRunnerForEntry key={entry.name} entry={entry} />
  );
}

function TestStageRunnerForEntry({ entry }: { entry: ExampleEntry }) {
  // Build a one-shot factory that injects entry.testInit + DEFAULT_INITIAL.
  const factory = (data: Parameters<typeof entry.factory>[0]) => {
    const merged = { ...DEFAULT_INITIAL, ...entry.testInit, ...data } as typeof data;
    return entry.factory(merged) as StageBase<unknown, unknown, unknown, unknown>;
  };
  return <TestStageRunner factory={factory} />;
}

export function ExamplePicker() {
  const [selected, setSelected] = useState<string>(USER_ENTRY.name);
  const entry = ALL.find((e) => e.name === selected) ?? USER_ENTRY;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", height: "100vh", fontFamily: "sans-serif" }}>
      <nav style={{ borderRight: "1px solid #444", overflow: "auto", background: "#1b1b1b", color: "#ddd" }}>
        <h2 style={{ padding: "0.6rem 0.8rem", margin: 0, fontSize: "0.85rem", letterSpacing: "0.1em", textTransform: "uppercase", borderBottom: "1px solid #333" }}>
          Stage examples
        </h2>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {ALL.map((e) => {
            const active = e.name === selected;
            return (
              <li key={e.name}>
                <button
                  onClick={() => setSelected(e.name)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "0.6rem 0.8rem",
                    background: active ? "#2d4d6e" : "transparent",
                    color: active ? "#fff" : "#ccc",
                    border: "none",
                    borderBottom: "1px solid #2a2a2a",
                    cursor: "pointer",
                    font: "inherit",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{e.label}</div>
                  <div style={{ fontSize: "0.75rem", opacity: 0.7, marginTop: "0.15rem" }}>
                    {e.description}
                  </div>
                  {e.primitives.length > 0 && (
                    <div style={{ fontSize: "0.65rem", opacity: 0.5, marginTop: "0.2rem" }}>
                      {e.primitives.join(" · ")}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <main style={{ overflow: "auto", background: "#0c0c0c" }}>
        <Entry entry={entry} />
      </main>
    </div>
  );
}
