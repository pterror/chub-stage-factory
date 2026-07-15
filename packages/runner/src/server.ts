import { Hono } from "hono";
import { streamText } from "ai";
import { getModel, isProviderName } from "./providers.ts";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface ChatRequest {
  messages: ChatMessage[];
  provider?: string;
  model?: string;
}

interface RunnerConfig {
  provider: string;
  model: string;
  apiKey: string;
}

function configFromEnv(): RunnerConfig {
  return {
    provider: process.env.RUNNER_LLM_PROVIDER ?? "openai",
    model: process.env.RUNNER_LLM_MODEL ?? "gpt-4o",
    apiKey: process.env.RUNNER_LLM_API_KEY ?? "",
  };
}

let runtimeConfig: RunnerConfig = configFromEnv();

export const app = new Hono();

app.get("/api/config", (c) => {
  return c.json({
    provider: runtimeConfig.provider,
    model: runtimeConfig.model,
    hasApiKey: runtimeConfig.apiKey.length > 0,
  });
});

app.post("/api/config", async (c) => {
  const body = await c.req.json<Partial<RunnerConfig>>().catch(() => null);
  if (!body) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (body.provider !== undefined) {
    if (!isProviderName(body.provider)) {
      return c.json({ error: `Unsupported provider: ${body.provider}` }, 400);
    }
    runtimeConfig.provider = body.provider;
  }
  if (body.model !== undefined) {
    runtimeConfig.model = body.model;
  }
  if (body.apiKey !== undefined) {
    runtimeConfig.apiKey = body.apiKey;
  }
  return c.json({
    provider: runtimeConfig.provider,
    model: runtimeConfig.model,
    hasApiKey: runtimeConfig.apiKey.length > 0,
  });
});

app.post("/api/chat", async (c) => {
  const body = await c.req.json<ChatRequest>().catch(() => null);
  if (!body || !Array.isArray(body.messages)) {
    return c.json({ error: "Request body must include a messages array" }, 400);
  }

  const provider = body.provider ?? runtimeConfig.provider;
  const modelId = body.model ?? runtimeConfig.model;
  const apiKey = runtimeConfig.apiKey;

  if (!apiKey) {
    return c.json(
      { error: "No API key configured. Set RUNNER_LLM_API_KEY or POST /api/config." },
      400,
    );
  }

  if (!isProviderName(provider)) {
    return c.json({ error: `Unsupported provider: ${provider}` }, 400);
  }

  try {
    const model = getModel(provider, apiKey, modelId);
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
