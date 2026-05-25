/**
 * mocks.ts — Mock implementations for outbound service calls.
 *
 * Three modes:
 *   NullMocks        — deterministic canned responses (always succeed, no I/O)
 *   PassthroughMocks — forward to a real endpoint via env-configured URL
 *   RecordReplayMocks — key by (methodName, JSON(args)); persist fixtures to a dir
 *
 * All three implement the same surface defined by MockSurface.
 *
 * Environment variables (browser: import.meta.env.VITE_*, Node: process.env.*):
 *   VITE_PASSTHROUGH_URL / PASSTHROUGH_URL — base URL for passthrough calls
 */

import type {
  GenerationRequestType,
  MessagingRequestType,
} from "./protocol.js";

// ---------------------------------------------------------------------------
// Method surface
// ---------------------------------------------------------------------------

export interface GeneratorMock {
  makeImage(req: unknown): Promise<unknown>;
  imageToImage(req: unknown): Promise<unknown>;
  animateImage(req: unknown): Promise<unknown>;
  inpaintImage(req: unknown): Promise<unknown>;
  removeBackground(req: unknown): Promise<unknown>;
  makeVideo(req: unknown): Promise<unknown>;
  makeMusic(req: unknown): Promise<unknown>;
  makeSound(req: unknown): Promise<unknown>;
  speak(req: unknown): Promise<unknown>;
  textGen(req: unknown): Promise<unknown>;
}

export interface MessengerMock {
  impersonate(req: unknown): Promise<unknown>;
  updateChatState(req: unknown): Promise<unknown>;
  updateEnvironment(req: unknown): Promise<unknown>;
  nudge(req: unknown): Promise<unknown>;
}

export interface MockSurface {
  generator: GeneratorMock;
  messenger: MessengerMock;
  /**
   * Handle an outbound message from the iframe by type name.
   * Returns the response payload to send back.
   */
  handleOutbound(type: GenerationRequestType | MessagingRequestType, data: unknown): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

function getEnv(key: string): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    return process.env[key];
  }
  // Browser: import.meta.env
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (import.meta as any).env?.[`VITE_${key}`];
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Mapping: outbound type → generator/messenger method
// ---------------------------------------------------------------------------

const GENERATION_TYPE_TO_METHOD: Record<string, keyof GeneratorMock> = {
  TEXT2IMAGE: "makeImage",
  IMAGE2IMAGE: "imageToImage",
  ANIMATE: "animateImage",
  INPAINT: "inpaintImage",
  REMOVE_BG: "removeBackground",
  TEXT2VIDEO: "makeVideo",
  TEXT2MUSIC: "makeMusic",
  FOLEY: "makeSound",
  TEXT2SPEECH: "speak",
  TEXT2TEXT: "textGen",
};

const MESSAGING_TYPE_TO_METHOD: Record<string, keyof MessengerMock> = {
  IMPERSONATE: "impersonate",
  CHAT_STATE: "updateChatState",
  ENVIRONMENT: "updateEnvironment",
  NUDGE: "nudge",
};

function dispatchToSurface(
  surface: MockSurface,
  type: string,
  data: unknown,
): Promise<unknown> {
  const genMethod = GENERATION_TYPE_TO_METHOD[type];
  if (genMethod) {
    return surface.generator[genMethod](data);
  }
  const msgMethod = MESSAGING_TYPE_TO_METHOD[type];
  if (msgMethod) {
    return surface.messenger[msgMethod](data);
  }
  return Promise.resolve({ success: false, error: `unknown type: ${type}` });
}

// ---------------------------------------------------------------------------
// NullMocks — deterministic canned responses
// ---------------------------------------------------------------------------

export class NullMocks implements MockSurface {
  generator: GeneratorMock = {
    makeImage: () => Promise.resolve({ url: "", seed: 0 }),
    imageToImage: () => Promise.resolve({ url: "", seed: 0 }),
    animateImage: () => Promise.resolve({ url: "", seed: 0 }),
    inpaintImage: () => Promise.resolve({ url: "", seed: 0 }),
    removeBackground: () => Promise.resolve({ url: "", seed: 0 }),
    makeVideo: () => Promise.resolve({ url: "", seed: 0 }),
    makeMusic: () => Promise.resolve({ url: "", seed: 0 }),
    makeSound: () => Promise.resolve({ url: "", seed: 0 }),
    speak: () => Promise.resolve({ url: "", seed: 0 }),
    textGen: () => Promise.resolve({ result: "A null mock text response." }),
  };

  messenger: MessengerMock = {
    impersonate: () => Promise.resolve({ success: true, error: null, identity: "null-mock-id" }),
    updateChatState: () => Promise.resolve({ success: true, error: null }),
    updateEnvironment: () => Promise.resolve({ success: true, error: null }),
    nudge: () => Promise.resolve({ success: true, error: null, identity: "null-mock-id" }),
  };

  handleOutbound(type: GenerationRequestType | MessagingRequestType, data: unknown): Promise<unknown> {
    return dispatchToSurface(this, type, data);
  }
}

// ---------------------------------------------------------------------------
// PassthroughMocks — forward to a real endpoint
// ---------------------------------------------------------------------------

export class PassthroughMocks implements MockSurface {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? getEnv("PASSTHROUGH_URL") ?? "http://localhost:4000";
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  generator: GeneratorMock = {
    makeImage: (req) => this.post("/generation/text2image", req),
    imageToImage: (req) => this.post("/generation/image2image", req),
    animateImage: (req) => this.post("/generation/animate", req),
    inpaintImage: (req) => this.post("/generation/inpaint", req),
    removeBackground: (req) => this.post("/generation/remove-bg", req),
    makeVideo: (req) => this.post("/generation/text2video", req),
    makeMusic: (req) => this.post("/generation/text2music", req),
    makeSound: (req) => this.post("/generation/foley", req),
    speak: (req) => this.post("/generation/text2speech", req),
    textGen: (req) => this.post("/generation/text2text", req),
  };

  messenger: MessengerMock = {
    impersonate: (req) => this.post("/messaging/impersonate", req),
    updateChatState: (req) => this.post("/messaging/chat-state", req),
    updateEnvironment: (req) => this.post("/messaging/environment", req),
    nudge: (req) => this.post("/messaging/nudge", req),
  };

  handleOutbound(type: GenerationRequestType | MessagingRequestType, data: unknown): Promise<unknown> {
    return dispatchToSurface(this, type, data);
  }
}

// ---------------------------------------------------------------------------
// RecordReplayMocks — key by (methodName, JSON(args)), persist fixtures
// ---------------------------------------------------------------------------

export type FixtureStore = Map<string, unknown>;

function fixtureKey(method: string, args: unknown): string {
  return `${method}:${JSON.stringify(args)}`;
}

export class RecordReplayMocks implements MockSurface {
  private fixtures: FixtureStore;
  /** Directory to persist fixtures (Node only). */
  private fixtureDir: string | null;
  private fallback: MockSurface;

  constructor(options?: {
    fixtures?: FixtureStore;
    fixtureDir?: string;
    fallback?: MockSurface;
  }) {
    this.fixtures = options?.fixtures ?? new Map();
    this.fixtureDir = options?.fixtureDir ?? null;
    this.fallback = options?.fallback ?? new NullMocks();

    if (this.fixtureDir) {
      this.loadFixturesFromDir(this.fixtureDir);
    }
  }

  private loadFixturesFromDir(dir: string): void {
    // Node-only: dynamic require to keep browser-safe
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { readdirSync, readFileSync } = require("node:fs");
      const { join } = require("node:path");
      const files: string[] = readdirSync(dir).filter((f: string) => f.endsWith(".json"));
      for (const file of files) {
        const key = file.replace(/\.json$/, "").replace(/__/g, ":");
        const value = JSON.parse(readFileSync(join(dir, file), "utf8"));
        this.fixtures.set(key, value);
      }
    } catch {
      // Not in Node or dir doesn't exist — skip
    }
  }

  private persistFixture(key: string, value: unknown): void {
    if (!this.fixtureDir) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { mkdirSync, writeFileSync } = require("node:fs");
      const { join } = require("node:path");
      mkdirSync(this.fixtureDir, { recursive: true });
      const filename = key.replace(/:/g, "__") + ".json";
      writeFileSync(join(this.fixtureDir, filename), JSON.stringify(value, null, 2));
    } catch {
      // Ignore persistence errors
    }
  }

  private async call(method: string, args: unknown): Promise<unknown> {
    const key = fixtureKey(method, args);
    if (this.fixtures.has(key)) {
      return this.fixtures.get(key);
    }
    const result = await this.fallback.handleOutbound(method as GenerationRequestType, args);
    this.fixtures.set(key, result);
    this.persistFixture(key, result);
    return result;
  }

  generator: GeneratorMock = {
    makeImage: (req) => this.call("TEXT2IMAGE", req),
    imageToImage: (req) => this.call("IMAGE2IMAGE", req),
    animateImage: (req) => this.call("ANIMATE", req),
    inpaintImage: (req) => this.call("INPAINT", req),
    removeBackground: (req) => this.call("REMOVE_BG", req),
    makeVideo: (req) => this.call("TEXT2VIDEO", req),
    makeMusic: (req) => this.call("TEXT2MUSIC", req),
    makeSound: (req) => this.call("FOLEY", req),
    speak: (req) => this.call("TEXT2SPEECH", req),
    textGen: (req) => this.call("TEXT2TEXT", req),
  };

  messenger: MessengerMock = {
    impersonate: (req) => this.call("IMPERSONATE", req),
    updateChatState: (req) => this.call("CHAT_STATE", req),
    updateEnvironment: (req) => this.call("ENVIRONMENT", req),
    nudge: (req) => this.call("NUDGE", req),
  };

  handleOutbound(type: GenerationRequestType | MessagingRequestType, data: unknown): Promise<unknown> {
    return this.call(type, data);
  }

  getFixtures(): ReadonlyMap<string, unknown> {
    return this.fixtures;
  }
}
