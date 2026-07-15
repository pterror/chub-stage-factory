import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { StageBase } from "@chub-ai/stages-ts";

export interface ChatDisplayMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  siblingIndex: number;
  siblingCount: number;
}

export interface ChatUIProps {
  stage: StageBase<any, any, any, any>;
  messages: ChatDisplayMessage[];
  onSend: (content: string) => void;
  onSwipe: (nodeId: string, delta: number) => void;
  onRegenerate: () => void;
  loading: boolean;
  error: string | null;
  onStageUpdate: () => void;
  position?: "ADJACENT" | "NONE" | "COVER" | "FULLSCREEN";
  // For FULLSCREEN/COVER: whether the overlaid chat is currently shown.
  // Ignored for ADJACENT/NONE, which never hide the chat panel.
  chatOpen?: boolean;
}

export function ChatUI({
  stage,
  messages,
  onSend,
  onSwipe,
  onRegenerate,
  loading,
  error,
  position = "ADJACENT",
  chatOpen = false,
}: ChatUIProps) {
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, loading]);

  function handleSubmit() {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    onSend(trimmed);
    setInput("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const lastMessage = messages[messages.length - 1];
  const canRegenerate = lastMessage?.role === "assistant" && !loading;

  // FULLSCREEN overlays the whole chat panel (history + input) on toggle.
  // COVER always shows the input bar but overlays just the history on toggle.
  const chatPanelClass =
    position === "FULLSCREEN"
      ? `chat-panel chat-panel-overlay ${chatOpen ? "chat-panel-open" : ""}`
      : "chat-panel";
  const historyHidden = position === "COVER" && !chatOpen;

  return (
    <div className="runner-body">
      <div className="stage-panel">{stage.render()}</div>
      <div className={chatPanelClass}>
        {error && <div className="error-banner">{error}</div>}
        <div className="message-list" ref={listRef} hidden={historyHidden}>
          {messages.length === 0 && (
            <div className="empty-hint">Send a message to start the chat.</div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`message-row ${m.role}`}>
              <div className={`message-bubble ${m.role}`}>
                <div className="message-content">
                  {m.content || (loading && m.role === "assistant" ? "…" : "")}
                </div>
                {m.role === "assistant" && m.siblingCount > 1 && (
                  <div className="swipe-controls">
                    <button
                      type="button"
                      disabled={m.siblingIndex <= 0}
                      onClick={() => onSwipe(m.id, -1)}
                    >
                      ‹
                    </button>
                    <span className="swipe-indicator">
                      {m.siblingIndex + 1}/{m.siblingCount}
                    </span>
                    <button
                      type="button"
                      disabled={m.siblingIndex >= m.siblingCount - 1}
                      onClick={() => onSwipe(m.id, 1)}
                    >
                      ›
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && <div className="loading-indicator">Generating…</div>}
        </div>
        <div className="chat-input-row">
          <textarea
            className="chat-textarea"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
            rows={2}
            disabled={loading}
          />
          <div className="chat-input-actions">
            <button
              type="button"
              className="send-btn"
              onClick={handleSubmit}
              disabled={loading || !input.trim()}
            >
              Send
            </button>
            {canRegenerate && (
              <button type="button" className="regenerate-btn" onClick={onRegenerate}>
                Regenerate
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
