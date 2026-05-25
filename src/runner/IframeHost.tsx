/**
 * IframeHost.tsx — iframe element + parent-side postMessage handler.
 *
 * Sends INIT on iframe-ready and exposes a method to send subsequent
 * host→iframe messages. Logs every message both directions.
 */

import React, { useRef, useEffect, useImperativeHandle, forwardRef, useCallback } from "react";
import type { HostMessage, InitData, OutboundMessage, OutboundMessageType, GenerationRequestType, MessagingRequestType } from "./protocol.js";
import type { MockSurface } from "./mocks.js";

export interface MessageLogEntry {
  id: number;
  timestamp: Date;
  direction: "host→iframe" | "iframe→host";
  type: string;
  data: unknown;
}

export interface IframeHostHandle {
  send(msg: HostMessage): void;
  getLog(): MessageLogEntry[];
}

interface IframeHostProps {
  src: string;
  initData: InitData;
  mocks: MockSurface;
  onMessage?: (entry: MessageLogEntry) => void;
  style?: React.CSSProperties;
}

let logIdCounter = 0;

export const IframeHost = forwardRef<IframeHostHandle, IframeHostProps>(
  function IframeHost({ src, initData, mocks, onMessage, style }, ref) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const logRef = useRef<MessageLogEntry[]>([]);
    const initSentRef = useRef(false);

    function addEntry(entry: MessageLogEntry) {
      logRef.current.push(entry);
      onMessage?.(entry);
    }

    const sendToIframe = useCallback((msg: HostMessage) => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) return;
      const entry: MessageLogEntry = {
        id: logIdCounter++,
        timestamp: new Date(),
        direction: "host→iframe",
        type: msg.messageType,
        data: msg.data,
      };
      addEntry(entry);
      iframe.contentWindow.postMessage(msg, "*");
    }, []);

    useImperativeHandle(ref, () => ({
      send: sendToIframe,
      getLog: () => logRef.current,
    }));

    useEffect(() => {
      const handleMessage = async (event: MessageEvent) => {
        const iframe = iframeRef.current;
        if (!iframe) return;
        if (event.source !== iframe.contentWindow) return;

        const { messageType, data } = event.data as { messageType: string; data: unknown };
        if (!messageType) return;

        const entry: MessageLogEntry = {
          id: logIdCounter++,
          timestamp: new Date(),
          direction: "iframe→host",
          type: messageType,
          data,
        };
        addEntry(entry);

        // Lifecycle replies are handled by the iframe itself — just log them.
        // Outbound service calls (generation/messaging) need to be answered.
        const isServiceCall = [
          "TEXT2IMAGE", "IMAGE2IMAGE", "ANIMATE", "INPAINT", "REMOVE_BG",
          "TEXT2VIDEO", "TEXT2MUSIC", "FOLEY", "TEXT2SPEECH", "TEXT2TEXT",
          "IMPERSONATE", "CHAT_STATE", "ENVIRONMENT", "NUDGE",
        ].includes(messageType);

        if (isServiceCall) {
          const d = data as Record<string, unknown> & { uuid: string };
          const uuid = d.uuid;
          try {
            const response = await mocks.handleOutbound(
              messageType as GenerationRequestType | MessagingRequestType,
              data,
            );
            iframe.contentWindow?.postMessage({ messageType: uuid, data: response }, "*");
          } catch (err) {
            iframe.contentWindow?.postMessage({
              messageType: uuid,
              data: { error: String(err) },
            }, "*");
          }
        }

        // Handle ERROR from iframe
        if (messageType === "ERROR") {
          console.error("[IframeHost] iframe error:", data);
        }
      };

      window.addEventListener("message", handleMessage);
      return () => window.removeEventListener("message", handleMessage);
    }, [mocks]);

    // Send INIT when iframe loads
    const handleLoad = useCallback(() => {
      if (initSentRef.current) return;
      initSentRef.current = true;
      sendToIframe({ messageType: "INIT", data: initData });
    }, [initData, sendToIframe]);

    // Reset when src changes
    useEffect(() => {
      initSentRef.current = false;
      logRef.current = [];
    }, [src]);

    return (
      <iframe
        ref={iframeRef}
        src={src}
        onLoad={handleLoad}
        style={{
          border: "none",
          background: "#fff",
          ...style,
        }}
        sandbox="allow-scripts allow-same-origin"
        title="Stage"
      />
    );
  },
);
