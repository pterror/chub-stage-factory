import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

export type ProviderName = "openai" | "anthropic";

export function isProviderName(name: string): name is ProviderName {
  return name === "openai" || name === "anthropic";
}

export function getProvider(name: string, apiKey: string) {
  if (!isProviderName(name)) {
    throw new Error(`Unsupported provider: ${name}`);
  }
  switch (name) {
    case "openai":
      return createOpenAI({ apiKey });
    case "anthropic":
      return createAnthropic({ apiKey });
  }
}

export function getModel(
  providerName: string,
  apiKey: string,
  modelId: string,
): LanguageModel {
  const provider = getProvider(providerName, apiKey);
  return provider(modelId);
}
