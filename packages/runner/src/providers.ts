import { createOpenAI, openai } from "@ai-sdk/openai";
import { createAnthropic, anthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

const providerMap = { openai, anthropic };

const providerNames = new Set(Object.keys(providerMap) as (keyof typeof providerMap)[]);

export function isProviderName(name: string): name is keyof typeof providerMap {
  return providerNames.has(name as keyof typeof providerMap);
}

export const PROVIDER_ENV_VARS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

export function parseModelSpec(spec: string): {
  providerName: string;
  modelName: string;
} {
  const lastColon = spec.lastIndexOf(":");
  if (lastColon === -1) {
    throw new Error(
      `Invalid model spec: ${spec}. Expected format: provider:model or host:port:model`,
    );
  }
  const providerName = spec.slice(0, lastColon);
  const modelName = spec.slice(lastColon + 1);
  if (!providerName || !modelName) {
    throw new Error(
      `Invalid model spec: ${spec}. Expected format: provider:model or host:port:model`,
    );
  }
  return { providerName, modelName };
}

function normalizeBaseUrl(providerName: string): string {
  if (providerName.startsWith("http://") || providerName.startsWith("https://")) {
    return providerName;
  }
  return `https://${providerName}`;
}

function getProvider(providerName: string, apiKey?: string) {
  if (isProviderName(providerName)) {
    if (apiKey) {
      if (providerName === "openai") {
        return createOpenAI({ apiKey });
      }
      if (providerName === "anthropic") {
        return createAnthropic({ apiKey });
      }
    }
    return providerMap[providerName];
  }
  return createOpenAICompatible({
    name: providerName,
    baseURL: normalizeBaseUrl(providerName),
    apiKey,
  });
}

export function getModel(spec: string, apiKey?: string): LanguageModel {
  const { providerName, modelName } = parseModelSpec(spec);
  const provider = getProvider(providerName, apiKey);
  return provider(modelName);
}

export function getApiKeyEnvVar(providerName: string): string | undefined {
  return PROVIDER_ENV_VARS[providerName];
}

export function getApiKeyFromEnv(providerName: string): string | undefined {
  const envVar = getApiKeyEnvVar(providerName);
  if (!envVar) return undefined;
  return process.env[envVar] || undefined;
}

export const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "openai:gpt-4o";
