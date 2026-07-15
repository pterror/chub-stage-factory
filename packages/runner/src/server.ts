import { Hono, type Context } from "hono";
import { streamText } from "ai";
import {
  DEFAULT_MODEL,
  getApiKeyEnvVar,
  getApiKeyFromEnv,
  getModel,
  parseModelSpec,
} from "./providers.ts";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
}

interface RunnerConfig {
  defaultModel: string;
  apiKeys: Record<string, string>;
}

const runtimeConfig: RunnerConfig = {
  defaultModel: DEFAULT_MODEL,
  apiKeys: {},
};

function resolveApiKey(providerName: string): string | undefined {
  return runtimeConfig.apiKeys[providerName] ?? getApiKeyFromEnv(providerName);
}

function configView() {
  const { providerName } = parseModelSpec(runtimeConfig.defaultModel);
  return {
    defaultModel: runtimeConfig.defaultModel,
    providerName,
    envVar: getApiKeyEnvVar(providerName) ?? null,
    hasApiKey: Boolean(resolveApiKey(providerName)),
  };
}

const CHUB_PROXY_ROUTES: Array<{ path: string; target: string }> = [
  { path: "/chub-proxy", target: "https://inference.chub.ai" },
  { path: "/chub-api-proxy", target: "https://api.chub.ai" },
];

function createChubProxyHandler(prefix: string, target: string) {
  return async (c: Context) => {
    const url = new URL(c.req.url);
    const upstreamUrl = `${target}${url.pathname.slice(prefix.length)}${url.search}`;

    const headers = new Headers(c.req.raw.headers);
    headers.set("Referer", "https://chub.ai/");
    headers.set("Origin", "https://chub.ai");
    headers.delete("host");

    const upstreamResponse = await fetch(upstreamUrl, {
      method: c.req.method,
      headers,
      body: ["GET", "HEAD"].includes(c.req.method) ? undefined : c.req.raw.body,
      // @ts-expect-error duplex is required for streaming request bodies in undici
      duplex: ["GET", "HEAD"].includes(c.req.method) ? undefined : "half",
    });

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: upstreamResponse.headers,
    });
  };
}

export const app = new Hono();

for (const { path, target } of CHUB_PROXY_ROUTES) {
  app.all(`${path}/*`, createChubProxyHandler(path, target));
}

app.get("/api/config", (c) => {
  return c.json(configView());
});

app.post("/api/config", async (c) => {
  const body = await c.req.json<{ model?: string; apiKey?: string }>().catch(() => null);
  if (!body) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (body.model !== undefined) {
    try {
      parseModelSpec(body.model);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid model spec";
      return c.json({ error: message }, 400);
    }
    runtimeConfig.defaultModel = body.model;
  }
  if (body.apiKey) {
    const { providerName } = parseModelSpec(runtimeConfig.defaultModel);
    runtimeConfig.apiKeys[providerName] = body.apiKey;
  }
  return c.json(configView());
});

app.post("/api/chat", async (c) => {
  const body = await c.req.json<ChatRequest>().catch(() => null);
  if (!body || !Array.isArray(body.messages)) {
    return c.json({ error: "Request body must include a messages array" }, 400);
  }

  const spec = body.model ?? runtimeConfig.defaultModel;

  try {
    const { providerName } = parseModelSpec(spec);
    const apiKey = resolveApiKey(providerName);
    const model = getModel(spec, apiKey);
    const result = streamText({
      model,
      messages: body.messages,
    });
    return result.toDataStreamResponse();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown LLM error";
    return c.json({ error: message }, 502);
  }
});

export default app;
