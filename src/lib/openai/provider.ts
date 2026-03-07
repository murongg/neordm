import type { Model } from "@mariozechner/pi-ai";
import {
  DEFAULT_AI_SETTINGS,
  type OpenAiApiStyle,
  type AiProviderConfig,
  getActiveAiProviderConfig,
} from "../aiSettings";

const OPENAI_RESPONSES_CONTEXT_WINDOW = 128_000;
const OPENAI_RESPONSES_MAX_TOKENS = 16_384;
type OpenAiModelApi = "openai-responses" | "openai-completions";
const OPENAI_RESPONSES_BASE_URL_SUFFIX_PATTERN =
  /\/(?:chat\/completions|responses)\/?$/i;

function normalizeBaseUrl(baseUrl: string) {
  const fallbackBaseUrl = DEFAULT_AI_SETTINGS.providers.openai.baseUrl;
  const trimmedBaseUrl = baseUrl.trim() || fallbackBaseUrl;
  const normalizedBaseUrl = trimmedBaseUrl.replace(
    OPENAI_RESPONSES_BASE_URL_SUFFIX_PATTERN,
    ""
  );

  return normalizedBaseUrl.replace(/\/+$/, "");
}

export function getValidatedOpenAIConfig(config: AiProviderConfig) {
  const apiKey = config.apiKey.trim();
  const model = config.model.trim();
  const baseUrl = normalizeBaseUrl(config.baseUrl);

  if (!apiKey) {
    throw new Error("Please configure your OpenAI API key in Settings → AI.");
  }

  if (!model) {
    throw new Error("Please configure an OpenAI model in Settings → AI.");
  }

  return {
    apiKey,
    model,
    baseUrl,
  };
}

export function createConfiguredOpenAIModel(
  config: AiProviderConfig
): Model<OpenAiModelApi> {
  const validatedConfig = getValidatedOpenAIConfig(config);
  const apiStyle: OpenAiApiStyle = config.apiStyle;

  return {
    id: validatedConfig.model,
    name: validatedConfig.model,
    api: apiStyle === "chat-completions" ? "openai-completions" : "openai-responses",
    provider: "openai",
    baseUrl: validatedConfig.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: OPENAI_RESPONSES_CONTEXT_WINDOW,
    maxTokens: OPENAI_RESPONSES_MAX_TOKENS,
    ...(apiStyle === "chat-completions"
      ? {
          compat: {
            supportsStore: false,
            supportsStrictMode: false,
            maxTokensField: "max_tokens" as const,
          },
        }
      : {}),
  };
}

export function createConfiguredOpenAIModelFromSettings(
  settings: Parameters<typeof getActiveAiProviderConfig>[0]
) {
  return createConfiguredOpenAIModel(getActiveAiProviderConfig(settings));
}
