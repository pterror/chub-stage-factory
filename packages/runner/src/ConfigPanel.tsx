import { useEffect, useState } from "react";

interface RunnerConfigView {
  provider: string;
  model: string;
  hasApiKey: boolean;
}

export function ConfigPanel() {
  const [collapsed, setCollapsed] = useState(true);
  const [config, setConfig] = useState<RunnerConfigView | null>(null);
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data: RunnerConfigView) => {
        setConfig(data);
        setProvider(data.provider);
        setModel(data.model);
      })
      .catch(() => setStatus("Failed to load config."));
  }, []);

  async function handleSave() {
    setSaving(true);
    setStatus(null);
    try {
      const body: Record<string, string> = { provider, model };
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
            ? `${config.provider} / ${config.model} ${config.hasApiKey ? "(key set)" : "(no key)"}`
            : "loading…"}
        </span>
      </div>
      {!collapsed && (
        <div className="config-panel-body">
          <label>
            Provider
            <select value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="openai">openai</option>
              <option value="anthropic">anthropic</option>
            </select>
          </label>
          <label>
            Model
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gpt-4o"
            />
          </label>
          <label>
            API Key
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={config?.hasApiKey ? "•••• (unchanged)" : "sk-…"}
            />
          </label>
          <button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          {status && <span className="config-status">{status}</span>}
        </div>
      )}
    </div>
  );
}
