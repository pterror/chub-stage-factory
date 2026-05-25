/**
 * protocol.ts — postMessage wire types for the Chub stage iframe protocol.
 *
 * Ground truth: node_modules/@chub-ai/stages-ts/dist/components/ReactRunner.js
 *               node_modules/@chub-ai/stages-ts/dist/services/messaging.js
 *               node_modules/@chub-ai/stages-ts/dist/services/generation-service.js
 *
 * Pure module — no DOM, no React. Importable from both browser and Node.
 */

// ---------------------------------------------------------------------------
// Host → iframe message types
// ---------------------------------------------------------------------------

/** Lifecycle message types the host sends into the iframe. */
export type HostMessageType = "INIT" | "BEFORE" | "AFTER" | "SET" | "CALL";

/** Message shape the host sends: { messageType, data } */
export interface HostMessage {
  messageType: HostMessageType;
  data: unknown;
}

// --- INIT ---
export interface InitData {
  environment?: "development" | "staging" | "production" | "testing";
  initState?: unknown;
  characters?: Record<string, unknown>;
  config?: unknown;
  messageState?: unknown;
  users?: Record<string, unknown>;
  chatState?: unknown;
}

export interface InitResponse {
  success: boolean;
  error: string | null;
  chatState: unknown;
  initState: unknown;
  messageState: unknown;
}

// --- BEFORE ---
export interface BeforeData {
  anonymizedId?: string;
  content?: string;
  isBot?: boolean;
  promptForId?: string;
  identity?: string;
  isMain?: boolean;
}

export interface BeforeResponse {
  chatState: unknown;
  systemMessage: string | null;
  error: string | null;
  extensionMessage: string | null;
  modifiedMessage: string | null;
  messageState: unknown;
  stageDirections: string | null;
}

// --- AFTER ---
export type AfterData = BeforeData;
export type AfterResponse = BeforeResponse;

// --- SET ---
export type SetData = unknown; // MessageStateType — opaque
export type SetResponse = Record<string, never>;

// --- CALL ---
export interface CallData {
  functionName: string;
  parameters?: unknown;
}

export interface CallResponse {
  functionName: string;
  result: unknown;
}

// ---------------------------------------------------------------------------
// Iframe → host message types (outbound service calls)
// ---------------------------------------------------------------------------

/** Generation service request types (GENERATION_REQUESTS enum). */
export type GenerationRequestType =
  | "TEXT2IMAGE"
  | "IMAGE2IMAGE"
  | "ANIMATE"
  | "INPAINT"
  | "REMOVE_BG"
  | "TEXT2VIDEO"
  | "TEXT2MUSIC"
  | "FOLEY"
  | "TEXT2SPEECH"
  | "TEXT2TEXT";

/** Messaging service request types (MESSAGING_REQUESTS enum). */
export type MessagingRequestType =
  | "IMPERSONATE"
  | "CHAT_STATE"
  | "ENVIRONMENT"
  | "NUDGE";

/** All outbound message types from iframe to host. */
export type OutboundMessageType = GenerationRequestType | MessagingRequestType;

/** Shape sent by the iframe for outbound service calls. */
export interface OutboundMessage {
  messageType: OutboundMessageType;
  data: Record<string, unknown> & { uuid: string };
}

/** The host replies back with messageType = uuid from the outbound message. */
export interface OutboundResponse {
  messageType: string; // the uuid
  data: unknown;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export interface ErrorMessage {
  messageType: "ERROR";
  data: {
    name: string;
    message: string;
    stack?: string;
  };
}

// ---------------------------------------------------------------------------
// Dedup key
// ---------------------------------------------------------------------------

/**
 * Compute the dedup key used by ReactRunner to detect repeated identical
 * messages and return the cached previous response.
 *
 * Key: `"${messageType}: ${JSON.stringify(data)}"`
 */
export function dedupKey(messageType: HostMessageType, data: unknown): string {
  return `${messageType}: ${JSON.stringify(data)}`;
}

// ---------------------------------------------------------------------------
// Encoder helpers
// ---------------------------------------------------------------------------

export function encodeHostMessage(
  messageType: HostMessageType,
  data: unknown,
): HostMessage {
  return { messageType, data };
}

export function encodeInit(data: InitData): HostMessage {
  return encodeHostMessage("INIT", data);
}

export function encodeBefore(data: BeforeData): HostMessage {
  return encodeHostMessage("BEFORE", data);
}

export function encodeAfter(data: AfterData): HostMessage {
  return encodeHostMessage("AFTER", data);
}

export function encodeSet(state: unknown): HostMessage {
  return encodeHostMessage("SET", state);
}

export function encodeCall(functionName: string, parameters?: unknown): HostMessage {
  return encodeHostMessage("CALL", { functionName, parameters });
}
