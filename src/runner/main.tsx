/**
 * main.tsx — Stage Runner UI entry point.
 *
 * URL params:
 *   ?bundle=<url>      Stage bundle URL to load into iframe
 *   ?scenario=<name>   Pre-select a scenario (filename without path/ext)
 *
 * Control bar: bundle URL input, scenario dropdown, step/auto-run/reset,
 *              mock mode toggle.
 * Main split: iframe panel (left) + Inspector (right).
 */

import React, { useState, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { IframeHost } from "./IframeHost.js";
import { Inspector } from "./Inspector.js";
import { NullMocks, PassthroughMocks, RecordReplayMocks } from "./mocks.js";
import type { MockSurface } from "./mocks.js";
import { parseScenario } from "./scenario.js";
import type { Scenario } from "./scenario.js";
import type { IframeHostHandle, MessageLogEntry } from "./IframeHost.js";
import type { InitData } from "./protocol.js";

// ---------------------------------------------------------------------------
// Load all scenario files via Vite glob import
// ---------------------------------------------------------------------------
const scenarioModules = import.meta.glob("/scenarios/*.json", { eager: true });
const scenarioMap: Record<string, Scenario> = {};
for (const [path, mod] of Object.entries(scenarioModules)) {
  try {
    const scenario = parseScenario((mod as { default: unknown }).default ?? mod);
    const name = path.replace(/^\/scenarios\//, "").replace(/\.json$/, "");
    scenarioMap[name] = scenario;
  } catch (e) {
    console.warn(`[runner] failed to parse scenario ${path}:`, e);
  }
}

// ---------------------------------------------------------------------------
// URL params
// ---------------------------------------------------------------------------
const urlParams = new URLSearchParams(window.location.search);
const initialBundle = urlParams.get("bundle") ?? "";
const initialScenario = urlParams.get("scenario") ?? "";

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------
type MockMode = "null" | "passthrough" | "record-replay";

function makeMocks(mode: MockMode): MockSurface {
  switch (mode) {
    case "passthrough": return new PassthroughMocks();
    case "record-replay": return new RecordReplayMocks();
    default: return new NullMocks();
  }
}

// ---------------------------------------------------------------------------
// State tracking for inspector
// ---------------------------------------------------------------------------
interface LiveState {
  messageState: unknown;
  chatState: unknown;
  initState: unknown;
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    background: "#0f0f0f",
    color: "#e0e0e0",
    fontFamily: "system-ui, sans-serif",
    fontSize: 13,
  },
  controlBar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    background: "#111",
    borderBottom: "1px solid #2a2a2a",
    flexWrap: "wrap",
  },
  input: {
    background: "#1a1a1a",
    border: "1px solid #333",
    borderRadius: 4,
    color: "#e0e0e0",
    padding: "4px 8px",
    fontFamily: "monospace",
    fontSize: 12,
  },
  select: {
    background: "#1a1a1a",
    border: "1px solid #333",
    borderRadius: 4,
    color: "#e0e0e0",
    padding: "4px 8px",
    fontFamily: "system-ui, sans-serif",
    fontSize: 12,
    cursor: "pointer",
  },
  btn: {
    background: "#222",
    border: "1px solid #444",
    borderRadius: 4,
    color: "#ccc",
    padding: "4px 10px",
    cursor: "pointer",
    fontSize: 12,
  },
  btnPrimary: {
    background: "#1a4a8a",
    border: "1px solid #2a6ad8",
    color: "#fff",
  },
  main: {
    display: "flex",
    flex: 1,
    overflow: "hidden",
  },
  iframePanel: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  inspectorPanel: {
    width: 380,
    borderLeft: "1px solid #2a2a2a",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
};

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
function RunnerApp() {
  const [bundleUrl, setBundleUrl] = useState(initialBundle);
  const [activeBundleUrl, setActiveBundleUrl] = useState(initialBundle);
  const [scenarioKey, setScenarioKey] = useState(initialScenario);
  const [mockMode, setMockMode] = useState<MockMode>("null");
  const [mocks, setMocks] = useState<MockSurface>(() => makeMocks("null"));
  const [log, setLog] = useState<MessageLogEntry[]>([]);
  const [liveState, setLiveState] = useState<LiveState>({
    messageState: null,
    chatState: null,
    initState: null,
  });
  const [stepIndex, setStepIndex] = useState(0);
  const [autoRunning, setAutoRunning] = useState(false);
  const iframeRef = useRef<IframeHostHandle>(null);

  const scenario = scenarioKey ? scenarioMap[scenarioKey] : null;
  const steps = scenario?.steps ?? [];

  const handleMockModeChange = useCallback((mode: MockMode) => {
    setMockMode(mode);
    setMocks(makeMocks(mode));
  }, []);

  const handleMessage = useCallback((entry: MessageLogEntry) => {
    setLog((prev) => [...prev, entry]);

    // Track live state from host→iframe responses that carry state
    if (entry.direction === "host→iframe") return;
    const type = entry.type;
    if (["INIT", "BEFORE", "AFTER"].includes(type)) {
      const d = entry.data as Record<string, unknown>;
      setLiveState((prev) => ({
        messageState: d.messageState !== undefined ? d.messageState : prev.messageState,
        chatState: d.chatState !== undefined ? d.chatState : prev.chatState,
        initState: d.initState !== undefined ? d.initState : prev.initState,
      }));
    }
  }, []);

  const handleLoad = useCallback(() => {
    setActiveBundleUrl(bundleUrl);
    setLog([]);
    setLiveState({ messageState: null, chatState: null, initState: null });
    setStepIndex(0);
  }, [bundleUrl]);

  const handleStep = useCallback(() => {
    const step = steps[stepIndex];
    if (!step || !iframeRef.current) return;
    switch (step.type) {
      case "before":
        iframeRef.current.send({ messageType: "BEFORE", data: step.message });
        break;
      case "after":
        iframeRef.current.send({ messageType: "AFTER", data: step.message });
        break;
      case "set":
        iframeRef.current.send({ messageType: "SET", data: step.state });
        break;
      case "call":
        iframeRef.current.send({ messageType: "CALL", data: { functionName: step.functionName, parameters: step.args } });
        break;
    }
    setStepIndex((i) => Math.min(i + 1, steps.length));
  }, [steps, stepIndex]);

  const handleAutoRun = useCallback(async () => {
    if (!scenario || !iframeRef.current) return;
    setAutoRunning(true);
    for (let i = stepIndex; i < steps.length; i++) {
      const step = steps[i];
      switch (step.type) {
        case "before":
          iframeRef.current.send({ messageType: "BEFORE", data: step.message });
          break;
        case "after":
          iframeRef.current.send({ messageType: "AFTER", data: step.message });
          break;
        case "set":
          iframeRef.current.send({ messageType: "SET", data: step.state });
          break;
        case "call":
          iframeRef.current.send({ messageType: "CALL", data: { functionName: step.functionName, parameters: step.args } });
          break;
      }
      setStepIndex(i + 1);
      await new Promise((r) => setTimeout(r, 200));
    }
    setAutoRunning(false);
  }, [scenario, steps, stepIndex]);

  const handleReset = useCallback(() => {
    setLog([]);
    setLiveState({ messageState: null, chatState: null, initState: null });
    setStepIndex(0);
    // Reload iframe by forcing src change cycle
    setActiveBundleUrl("");
    setTimeout(() => setActiveBundleUrl(bundleUrl), 50);
  }, [bundleUrl]);

  const initData: InitData = scenario?.init ?? {};

  return (
    <div style={styles.root}>
      {/* Control bar */}
      <div style={styles.controlBar}>
        <input
          style={{ ...styles.input, width: 260 }}
          type="text"
          placeholder="Bundle URL (leave blank for local)"
          value={bundleUrl}
          onChange={(e) => setBundleUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLoad()}
        />
        <button style={{ ...styles.btn, ...styles.btnPrimary }} onClick={handleLoad}>
          Load
        </button>

        <select
          style={styles.select}
          value={scenarioKey}
          onChange={(e) => {
            setScenarioKey(e.target.value);
            setStepIndex(0);
          }}
        >
          <option value="">— no scenario —</option>
          {Object.keys(scenarioMap).map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>

        <button
          style={styles.btn}
          onClick={handleStep}
          disabled={stepIndex >= steps.length || !scenario}
          title={`Step ${stepIndex + 1} / ${steps.length}`}
        >
          Step ({stepIndex + 1}/{steps.length})
        </button>
        <button
          style={{ ...styles.btn, ...styles.btnPrimary }}
          onClick={handleAutoRun}
          disabled={autoRunning || stepIndex >= steps.length || !scenario}
        >
          {autoRunning ? "Running…" : "Auto-run"}
        </button>
        <button style={styles.btn} onClick={handleReset}>Reset</button>

        <select
          style={styles.select}
          value={mockMode}
          onChange={(e) => handleMockModeChange(e.target.value as MockMode)}
        >
          <option value="null">Mocks: null</option>
          <option value="passthrough">Mocks: passthrough</option>
          <option value="record-replay">Mocks: record-replay</option>
        </select>
      </div>

      {/* Main split */}
      <div style={styles.main}>
        <div style={styles.iframePanel}>
          {activeBundleUrl ? (
            <IframeHost
              ref={iframeRef}
              src={activeBundleUrl}
              initData={initData}
              mocks={mocks}
              onMessage={handleMessage}
              style={{ flex: 1, width: "100%", height: "100%" }}
            />
          ) : (
            <div style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#444",
              fontSize: 14,
            }}>
              Enter a bundle URL above and click Load,<br />
              or leave blank to load the local dev build.
            </div>
          )}
        </div>

        <div style={styles.inspectorPanel}>
          <Inspector
            messageState={liveState.messageState}
            chatState={liveState.chatState}
            initState={liveState.initState}
            log={log}
            mockMode={mockMode}
            mocks={mocks}
            onMockModeChange={handleMockModeChange}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<RunnerApp />);
}
