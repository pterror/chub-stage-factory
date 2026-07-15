import { useEffect, useState } from "react";

interface RunnerConfigView {
  defaultModel: string;
  providerName: string;
  envVar: string | null;
  hasApiKey: boolean;
}

export function ConfigPanel() {
  const [collapsed, setCollapsed] = useState(true);
  const [config, setConfig] = useState<RunnerConfigView | null>(null);
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data: RunnerConfigView) => {
        setConfig(data);
        setModel(data.defaultModel);
      })
      .catch(() => setStatus("Failed to load config."));
  }, []);

  async function handleSave() {
    setSaving(true);
    setStatus(null);
    try {
      const body: Record<string, string> = { model };
      if (apiKey) {
        body.apiKey = apiKey;
      }
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error ?? "Failed to save config.");
        return;
      }
      setConfig(data);
      setApiKey("");
      setStatus("Saved.");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to save config.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="config-panel">
      <div className="config-panel-header" onClick={() => setCollapsed((c) => !c)}>
        <span>{collapsed ? "▸" : "▾"} Config</span>
        <span className="config-summary">
          {config
            ? `${config.defaultModel} ${config.hasApiKey ? "(key set)" : "(no key)"}`
            : "loading…"}
        </span>
      </div>
      {!collapsed && (
        <div className="config-panel-body">
          <label>
            Model spec
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="openai:gpt-4o"
            />
          </label>
          {config?.envVar && (
            <label>
              API Key
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={config?.hasApiKey ? "•••• (unchanged)" : "sk-…"}
              />
              <span className="config-hint">
                Detected from env var {config.envVar}
                {config.hasApiKey ? " (set)" : " (not set)"}
              </span>
            </label>
          )}
          {!config?.envVar && config && (
            <span className="config-hint">
              Unknown provider "{config.providerName}" — treated as an OpenAI-compatible base URL.
            </span>
          )}
          <button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          {status && <span className="config-status">{status}</span>}
        </div>
      )}
    </div>
  );
}
