import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_MESSAGE, StageBase } from "@chub-ai/stages-ts";
import { MessageNode, MessageTree } from "./tree.ts";
import { ChatDisplayMessage, ChatUI } from "./ChatUI.tsx";
import { ConfigPanel } from "./ConfigPanel.tsx";
import "./runner.css";

export interface StageRunnerProps {
  stageFactory: (data: any) => StageBase<any, any, any, any>;
  initData: any;
}

interface ChatCompletionMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

async function streamChatCompletion(
  messages: ChatCompletionMessage[],
  onDelta: (textSoFar: string) => void,
): Promise<string> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });

  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let done = false;

  while (!done) {
    const chunkResult = await reader.read();
    done = chunkResult.done;
    if (done) break;
    const value = chunkResult.value;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line) continue;
      const sep = line.indexOf(":");
      if (sep < 0) continue;
      const typeId = line.slice(0, sep);
      const rest = line.slice(sep + 1);
      if (typeId === "0") {
        try {
          const chunk = JSON.parse(rest) as string;
          text += chunk;
          onDelta(text);
        } catch {
          /* ignore malformed chunk */
        }
      } else if (typeId === "3") {
        let message = "LLM stream error";
        try {
          message = JSON.parse(rest) as string;
        } catch {
          /* keep default message */
        }
        throw new Error(message);
      }
    }
  }

  return text;
}

function toChatCompletionMessages(nodes: MessageNode[]): ChatCompletionMessage[] {
  return nodes
    .filter((n) => n.parentId !== null)
    .map((n) => ({ role: n.role, content: n.content }));
}

export function StageRunner({ stageFactory, initData }: StageRunnerProps) {
  const [stage] = useState(() => stageFactory(initData));
  const treeRef = useRef(new MessageTree());
  const [, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    stage
      .load()
      .then((res) => {
        if (cancelled) return;
        if (!res.success) {
          setLoadError(res.error ?? "Stage failed to load.");
        } else {
          setReady(true);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runCompletion = useCallback(
    async (
      contextNodes: MessageNode[],
      stageDirections: string | null,
      systemMessage: string | null,
      onDelta: (text: string) => void,
    ): Promise<string> => {
      const preface: ChatCompletionMessage[] = [];
      if (systemMessage) {
        preface.push({ role: "system", content: systemMessage });
      }
      if (stageDirections) {
        preface.push({ role: "system", content: stageDirections });
      }
      const messages = [...preface, ...toChatCompletionMessages(contextNodes)];
      return streamChatCompletion(messages, onDelta);
    },
    [],
  );

  const handleSend = useCallback(
    async (content: string) => {
      if (!content.trim() || loading) return;
      setError(null);
      const tree = treeRef.current;
      const userNode = tree.addMessage("user", content);
      refresh();
      setLoading(true);
      try {
        const before = await stage.beforePrompt({
          ...DEFAULT_MESSAGE,
          content,
          anonymizedId: "0",
          isBot: false,
        });
        if (before.error) {
          setError(before.error);
          return;
        }
        if (before.modifiedMessage != null) {
          userNode.content = before.modifiedMessage;
        }
        if (before.messageState !== undefined) {
          tree.setMessageState(userNode.id, before.messageState);
        }
        refresh();

        const contextPath = tree.getActivePath();
        const botNode = tree.addMessage("assistant", "");
        refresh();

        const finalText = await runCompletion(
          contextPath,
          before.stageDirections ?? null,
          before.systemMessage ?? null,
          (partial) => {
            botNode.content = partial;
            refresh();
          },
        );

        const after = await stage.afterResponse({
          ...DEFAULT_MESSAGE,
          content: finalText,
          anonymizedId: "1",
          isBot: true,
        });
        if (after.error) {
          setError(after.error);
        }
        botNode.content = after.modifiedMessage ?? finalText;
        if (after.messageState !== undefined) {
          tree.setMessageState(botNode.id, after.messageState);
        }
        refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [stage, loading, refresh, runCompletion],
  );

  const handleRegenerate = useCallback(async () => {
    const tree = treeRef.current;
    const leaf = tree.getActiveLeaf();
    if (leaf.role !== "assistant" || loading) return;
    setError(null);
    setLoading(true);
    try {
      const contextPath = tree.getActivePath().slice(0, -1);
      const newNode = tree.regenerate(leaf.id, "");
      refresh();

      const finalText = await runCompletion(contextPath, null, null, (partial) => {
        newNode.content = partial;
        refresh();
      });

      const after = await stage.afterResponse({
        ...DEFAULT_MESSAGE,
        content: finalText,
        anonymizedId: "1",
        isBot: true,
      });
      if (after.error) {
        setError(after.error);
      }
      newNode.content = after.modifiedMessage ?? finalText;
      if (after.messageState !== undefined) {
        tree.setMessageState(newNode.id, after.messageState);
      }
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [stage, loading, refresh, runCompletion]);

  const handleSwipe = useCallback(
    (nodeId: string, delta: number) => {
      const tree = treeRef.current;
      const newLeaf = tree.swipe(nodeId, delta);
      if (!newLeaf) return;
      if (newLeaf.messageState !== undefined) {
        stage.setState(newLeaf.messageState).then(refresh);
      } else {
        refresh();
      }
    },
    [stage, refresh],
  );

  if (loadError) {
    return (
      <div className="runner-root centered">
        <div className="error-banner">Stage failed to load: {loadError}</div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="runner-root centered">
        <div className="loading-indicator">Loading stage…</div>
      </div>
    );
  }

  const tree = treeRef.current;
  const messages: ChatDisplayMessage[] = tree
    .getActivePath()
    .filter((n) => n.parentId !== null)
    .map((n) => {
      const info = tree.getSiblingInfo(n.id);
      return {
        id: n.id,
        role: n.role,
        content: n.content,
        siblingIndex: info.current,
        siblingCount: info.total,
      };
    });

  return (
    <div className="runner-root">
      <ConfigPanel />
      <ChatUI
        stage={stage}
        messages={messages}
        onSend={handleSend}
        onSwipe={handleSwipe}
        onRegenerate={handleRegenerate}
        loading={loading}
        error={error}
        onStageUpdate={refresh}
      />
    </div>
  );
}
