/**
 * Inspector.tsx — three-tab panel: State / Messages / Mocks.
 */

import React, { useState } from "react";
import type { MessageLogEntry } from "./IframeHost.js";
import type { MockSurface, RecordReplayMocks } from "./mocks.js";

type MockMode = "null" | "passthrough" | "record-replay";

interface InspectorProps {
  messageState: unknown;
  chatState: unknown;
  initState: unknown;
  log: MessageLogEntry[];
  mockMode: MockMode;
  mocks: MockSurface;
  onMockModeChange: (mode: MockMode) => void;
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    background: "#1a1a1a",
    color: "#e0e0e0",
    fontFamily: "monospace",
    fontSize: 13,
  },
  tabs: {
    display: "flex",
    borderBottom: "1px solid #333",
    background: "#111",
  },
  tab: {
    padding: "8px 16px",
    cursor: "pointer",
    border: "none",
    background: "transparent",
    color: "#888",
    fontSize: 13,
    fontFamily: "monospace",
  },
  tabActive: {
    color: "#e0e0e0",
    borderBottom: "2px solid #4a9eff",
  },
  content: {
    flex: 1,
    overflow: "auto",
    padding: 12,
  },
  pre: {
    margin: 0,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  },
  logEntry: {
    marginBottom: 8,
    padding: "4px 8px",
    borderRadius: 4,
    background: "#222",
  },
  logEntryOutbound: {
    borderLeft: "3px solid #f4a261",
  },
  logEntryInbound: {
    borderLeft: "3px solid #4a9eff",
  },
  logMeta: {
    color: "#666",
    fontSize: 11,
    marginBottom: 2,
  },
  section: {
    marginBottom: 16,
  },
  label: {
    color: "#888",
    fontSize: 11,
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  select: {
    background: "#222",
    color: "#e0e0e0",
    border: "1px solid #444",
    borderRadius: 4,
    padding: "4px 8px",
    fontFamily: "monospace",
    fontSize: 13,
    cursor: "pointer",
  },
};

export function Inspector({
  messageState,
  chatState,
  initState,
  log,
  mockMode,
  mocks,
  onMockModeChange,
}: InspectorProps) {
  const [activeTab, setActiveTab] = useState<"state" | "messages" | "mocks">("state");

  const tabStyle = (t: typeof activeTab): React.CSSProperties => ({
    ...styles.tab,
    ...(activeTab === t ? styles.tabActive : {}),
  });

  return (
    <div style={styles.root}>
      <div style={styles.tabs}>
        <button style={tabStyle("state")} onClick={() => setActiveTab("state")}>State</button>
        <button style={tabStyle("messages")} onClick={() => setActiveTab("messages")}>
          Messages ({log.length})
        </button>
        <button style={tabStyle("mocks")} onClick={() => setActiveTab("mocks")}>Mocks</button>
      </div>

      <div style={styles.content}>
        {activeTab === "state" && (
          <>
            <StateSection label="messageState" value={messageState} />
            <StateSection label="chatState" value={chatState} />
            <StateSection label="initState" value={initState} />
          </>
        )}

        {activeTab === "messages" && (
          <div>
            {log.length === 0 && <span style={{ color: "#555" }}>No messages yet.</span>}
            {[...log].reverse().map((entry) => (
              <div
                key={entry.id}
                style={{
                  ...styles.logEntry,
                  ...(entry.direction === "host→iframe"
                    ? styles.logEntryInbound
                    : styles.logEntryOutbound),
                }}
              >
                <div style={styles.logMeta}>
                  {entry.timestamp.toISOString().slice(11, 23)} &nbsp;
                  {entry.direction === "host→iframe" ? "↓ host→iframe" : "↑ iframe→host"}
                  &nbsp; <strong>{entry.type}</strong>
                </div>
                <pre style={styles.pre}>{JSON.stringify(entry.data, null, 2)}</pre>
              </div>
            ))}
          </div>
        )}

        {activeTab === "mocks" && (
          <div>
            <div style={styles.section}>
              <div style={styles.label}>Mock mode</div>
              <select
                style={styles.select}
                value={mockMode}
                onChange={(e) => onMockModeChange(e.target.value as MockMode)}
              >
                <option value="null">null (canned)</option>
                <option value="passthrough">passthrough</option>
                <option value="record-replay">record-replay</option>
              </select>
            </div>

            {mockMode === "record-replay" && (
              <div style={styles.section}>
                <div style={styles.label}>Recorded fixtures</div>
                <RecordedFixtures mocks={mocks} />
              </div>
            )}

            <div style={styles.section}>
              <div style={styles.label}>Active services</div>
              <div style={{ color: "#666", fontSize: 12 }}>
                generator: {Object.keys(mocks.generator).join(", ")}
              </div>
              <div style={{ color: "#666", fontSize: 12, marginTop: 4 }}>
                messenger: {Object.keys(mocks.messenger).join(", ")}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StateSection({ label, value }: { label: string; value: unknown }) {
  return (
    <div style={styles.section}>
      <div style={styles.label}>{label}</div>
      <pre style={{ ...styles.pre, color: value == null ? "#555" : "#c8e6c9" }}>
        {value == null ? "null" : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function RecordedFixtures({ mocks }: { mocks: MockSurface }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rrMocks = mocks as any as RecordReplayMocks;
  const fixtures =
    typeof rrMocks.getFixtures === "function" ? rrMocks.getFixtures() : null;

  if (!fixtures || fixtures.size === 0) {
    return <div style={{ color: "#555", fontSize: 12 }}>No fixtures recorded yet.</div>;
  }

  return (
    <div>
      {[...fixtures.entries()].map(([key]) => (
        <div key={key} style={{ color: "#888", fontSize: 12, marginBottom: 2 }}>
          {key}
        </div>
      ))}
    </div>
  );
}
