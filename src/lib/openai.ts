import type { LanguageModel } from "ai";
import type { ChatMessage, KeyValue, RedisConnection, RedisKey } from "../types";
import {
  DEFAULT_AI_SETTINGS,
  getActiveAiProviderConfig,
  type AiProviderConfig,
  type AiProviderId,
  type AiSettings,
} from "./aiSettings";
import { tauriProxyFetch } from "./tauriHttpProxy";

interface OpenAIAssistantRequest {
  settings: AiSettings;
  chatMessages: ChatMessage[];
  activeConnection?: Pick<RedisConnection, "name" | "host" | "port">;
  selectedDb: number;
  selectedKey: RedisKey | null;
  keyValue: KeyValue | null;
  keysCount: number;
}

interface OpenAIAssistantResponse {
  content: string;
  command?: string;
}

const MAX_CONTEXT_MESSAGES = 10;
const MAX_VALUE_PREVIEW_LENGTH = 2000;
const COMMAND_PREFIX_PATTERN = /^\s*COMMAND:\s*(.+)$/im;
const PROVIDER_DISPLAY_NAMES: Record<AiProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  xai: "xAI",
  "azure-openai": "Azure OpenAI",
  mistral: "Mistral",
  groq: "Groq",
  deepseek: "DeepSeek",
  together: "Together AI",
};

type ProviderInstance = {
  languageModel?: (modelId: string) => unknown;
  chat?: (modelId: string) => unknown;
  chatModel?: (modelId: string) => unknown;
} & ((modelId: string) => unknown);

type ProviderApiStyle = "chat" | "responses" | "generic";
type ProviderModelCandidate = {
  model: LanguageModel;
  apiStyle: ProviderApiStyle;
};

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}…`;
}

function stringifyContextValue(value: KeyValue["value"]) {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return truncateText(value, MAX_VALUE_PREVIEW_LENGTH);
  }

  return truncateText(
    JSON.stringify(value, null, 2),
    MAX_VALUE_PREVIEW_LENGTH
  );
}

function buildAssistantInstructions(autoSuggest: boolean) {
  const commandGuidance = autoSuggest
    ? "If a Redis command would be useful, include exactly one separate line in the format `COMMAND: <redis command>`."
    : "Do not include a `COMMAND:` line unless the user explicitly asks for a Redis command.";

  return [
    "You are NeoRDM, an expert Redis assistant inside a desktop Redis client.",
    "Help the user understand data structures, debug issues, and suggest safe Redis operations.",
    "Be concise, practical, and answer in the same language as the user when possible.",
    "Never claim you already executed a command or changed Redis data.",
    commandGuidance,
    "Do not wrap the `COMMAND:` line in code fences.",
  ].join("\n");
}

function isGenericRequestFailureMessage(message: string) {
  const normalized = message.trim().toLowerCase();

  return (
    normalized === "failed" ||
    normalized === "failed to fetch" ||
    normalized === "fetch failed" ||
    normalized === "network error" ||
    normalized === "load failed"
  );
}

function normalizeAiRequestError(
  error: unknown,
  providerId: AiProviderId,
  apiStyle: ProviderApiStyle,
  config: AiProviderConfig
) {
  const rawMessage =
    error instanceof Error ? error.message : String(error ?? "Unknown error");

  if (!isGenericRequestFailureMessage(rawMessage)) {
    return rawMessage;
  }

  const providerName = PROVIDER_DISPLAY_NAMES[providerId];
  const endpointType =
    apiStyle === "responses"
      ? "/responses"
      : apiStyle === "chat"
      ? "/chat/completions"
      : "the configured endpoint";
  const configuredBaseUrl = config.baseUrl.trim();
  const locationHint = configuredBaseUrl
    ? ` at ${configuredBaseUrl}`
    : "";

  return `${providerName} request failed${locationHint}. Check whether the upstream API endpoint is reachable from the Tauri backend for ${endpointType}.`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "Unknown error");
}

function shouldRetryWithAlternateApiStyle(
  error: unknown,
  currentApiStyle: ProviderApiStyle,
  nextApiStyle: ProviderApiStyle
) {
  const message = getErrorMessage(error).toLowerCase();

  if (currentApiStyle === nextApiStyle) {
    return false;
  }

  if (
    currentApiStyle === "chat" &&
    nextApiStyle === "responses" &&
    (message.includes("please use /v1/responses") ||
      message.includes("please use /responses") ||
      (message.includes("/responses") &&
        (message.includes("unsupported legacy protocol") ||
          message.includes("legacy protocol") ||
          message.includes("not supported"))))
  ) {
    return true;
  }

  if (
    currentApiStyle === "responses" &&
    nextApiStyle === "chat" &&
    (message.includes("please use /v1/chat/completions") ||
      message.includes("please use /chat/completions") ||
      (message.includes("/chat/completions") &&
        (message.includes("not supported") ||
          message.includes("unsupported") ||
          message.includes("legacy"))))
  ) {
    return true;
  }

  return false;
}

function buildRedisContext({
  activeConnection,
  selectedDb,
  selectedKey,
  keyValue,
  keysCount,
  includeKeyContext,
}: {
  activeConnection?: Pick<RedisConnection, "name" | "host" | "port">;
  selectedDb: number;
  selectedKey: RedisKey | null;
  keyValue: KeyValue | null;
  keysCount: number;
  includeKeyContext: boolean;
}) {
  const lines = [
    "Redis client context:",
    activeConnection
      ? `- Active connection: ${activeConnection.name} (${activeConnection.host}:${activeConnection.port})`
      : "- Active connection: none",
    `- Active database: db${selectedDb}`,
    `- Loaded keys in browser: ${keysCount}`,
  ];

  if (!includeKeyContext) {
    lines.push("- Selected key context: disabled by user settings");
    return lines.join("\n");
  }

  if (!selectedKey) {
    lines.push("- Selected key: none");
    return lines.join("\n");
  }

  lines.push(`- Selected key: ${selectedKey.key}`);
  lines.push(`- Selected key type: ${selectedKey.type}`);
  lines.push(`- Selected key ttl: ${selectedKey.ttl}`);

  if (keyValue && keyValue.key === selectedKey.key) {
    lines.push(
      `- Selected key value preview:\n${stringifyContextValue(keyValue.value)}`
    );
  }

  return lines.join("\n");
}

function toOpenAIChatMessage(message: ChatMessage) {
  const content = message.command
    ? `${message.content}\nSuggested command: ${message.command}`
    : message.content;

  return {
    role: message.role,
    content,
  };
}

function parseAssistantResponse(rawContent: string): OpenAIAssistantResponse {
  const command = rawContent.match(COMMAND_PREFIX_PATTERN)?.[1]?.trim();
  const content = rawContent
    .replace(/^\s*COMMAND:\s*.+$/gim, "")
    .trim();

  return {
    content: content || "Suggested a Redis command.",
    command: command || undefined,
  };
}

function getProviderDisplayName(providerId: AiProviderId) {
  return PROVIDER_DISPLAY_NAMES[providerId] ?? providerId;
}

function getModelId(providerId: AiProviderId, config: AiProviderConfig) {
  const explicitModel = config.model.trim();
  const fallbackModel = DEFAULT_AI_SETTINGS.providers[providerId].model.trim();
  const modelId = explicitModel || fallbackModel;

  if (!modelId) {
    throw new Error(
      `Please configure a model for ${getProviderDisplayName(providerId)}.`
    );
  }

  return modelId;
}

function getProviderConfig(
  providerId: AiProviderId,
  config: AiProviderConfig
) {
  const apiKey = config.apiKey.trim();

  if (!apiKey) {
    throw new Error(
      `Please configure the ${getProviderDisplayName(providerId)} API key in Settings → AI Agent.`
    );
  }

  if (providerId === "azure-openai" && !config.baseUrl.trim()) {
    throw new Error(
      "Please configure the Azure OpenAI base URL in Settings → AI Agent."
    );
  }

  return {
    apiKey,
    baseURL: config.baseUrl.trim() || undefined,
    modelId: getModelId(providerId, config),
  };
}

async function createProviderInstance(
  providerId: AiProviderId,
  config: AiProviderConfig
): Promise<ProviderInstance> {
  const providerConfig = getProviderConfig(providerId, config);

  switch (providerId) {
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      return createOpenAI({
        apiKey: providerConfig.apiKey,
        baseURL: providerConfig.baseURL,
        name: providerId,
        fetch: tauriProxyFetch,
      }) as ProviderInstance;
    }
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      return createAnthropic({
        apiKey: providerConfig.apiKey,
        baseURL: providerConfig.baseURL,
        name: providerId,
        fetch: tauriProxyFetch,
      }) as ProviderInstance;
    }
    case "google": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      return createGoogleGenerativeAI({
        apiKey: providerConfig.apiKey,
        baseURL: providerConfig.baseURL,
        name: providerId,
        fetch: tauriProxyFetch,
      }) as ProviderInstance;
    }
    case "xai": {
      const { createXai } = await import("@ai-sdk/xai");
      return createXai({
        apiKey: providerConfig.apiKey,
        baseURL: providerConfig.baseURL,
        fetch: tauriProxyFetch,
      }) as ProviderInstance;
    }
    case "azure-openai": {
      const { createAzure } = await import("@ai-sdk/azure");
      return createAzure({
        apiKey: providerConfig.apiKey,
        baseURL: providerConfig.baseURL,
        fetch: tauriProxyFetch,
      }) as ProviderInstance;
    }
    case "mistral": {
      const { createMistral } = await import("@ai-sdk/mistral");
      return createMistral({
        apiKey: providerConfig.apiKey,
        baseURL: providerConfig.baseURL,
        fetch: tauriProxyFetch,
      }) as ProviderInstance;
    }
    case "groq": {
      const { createGroq } = await import("@ai-sdk/groq");
      return createGroq({
        apiKey: providerConfig.apiKey,
        baseURL: providerConfig.baseURL,
        fetch: tauriProxyFetch,
      }) as ProviderInstance;
    }
    case "deepseek": {
      const { createDeepSeek } = await import("@ai-sdk/deepseek");
      return createDeepSeek({
        apiKey: providerConfig.apiKey,
        baseURL: providerConfig.baseURL,
        fetch: tauriProxyFetch,
      }) as ProviderInstance;
    }
    case "together": {
      const { createTogetherAI } = await import("@ai-sdk/togetherai");
      return createTogetherAI({
        apiKey: providerConfig.apiKey,
        baseURL: providerConfig.baseURL,
        fetch: tauriProxyFetch,
      }) as ProviderInstance;
    }
  }
}

function createLanguageModels(
  providerId: AiProviderId,
  provider: ProviderInstance,
  modelId: string
): ProviderModelCandidate[] {
  const candidates: ProviderModelCandidate[] = [];
  const pushCandidate = (
    apiStyle: ProviderApiStyle,
    factory?: (modelId: string) => unknown
  ) => {
    if (typeof factory !== "function") {
      return;
    }

    if (candidates.some((candidate) => candidate.apiStyle === apiStyle)) {
      return;
    }

    candidates.push({
      model: factory(modelId) as LanguageModel,
      apiStyle,
    });
  };

  if (providerId === "openai" || providerId === "azure-openai") {
    pushCandidate("chat", provider.chat);
    pushCandidate("responses", provider.languageModel);
    pushCandidate("responses", typeof provider === "function" ? provider : undefined);
  } else {
    pushCandidate("generic", provider.languageModel);
    pushCandidate("chat", provider.chat);
    pushCandidate("chat", provider.chatModel);
    pushCandidate("generic", typeof provider === "function" ? provider : undefined);
  }

  if (!candidates.length) {
    throw new Error("The selected AI provider does not expose a text model.");
  }

  return candidates;
}

async function resolveProviderRuntime(
  providerId: AiProviderId,
  config: AiProviderConfig
) {
  const providerConfig = getProviderConfig(providerId, config);
  const [{ generateText }, provider] = await Promise.all([
    import("ai"),
    createProviderInstance(providerId, config),
  ]);
  const modelCandidates = createLanguageModels(
    providerId,
    provider,
    providerConfig.modelId
  );

  return {
    generateText,
    modelCandidates,
  };
}

async function generateTextWithFallback<T>({
  providerId,
  config,
  generateText,
  modelCandidates,
  createOptions,
}: {
  providerId: AiProviderId;
  config: AiProviderConfig;
  generateText: (options: any) => Promise<T>;
  modelCandidates: ProviderModelCandidate[];
  createOptions: (model: LanguageModel) => any;
}) {
  let lastError: unknown = null;
  let lastApiStyle: ProviderApiStyle = "generic";

  for (let index = 0; index < modelCandidates.length; index += 1) {
    const currentCandidate = modelCandidates[index];
    const nextCandidate = modelCandidates[index + 1];

    try {
      const result = await generateText(createOptions(currentCandidate.model));

      return {
        result,
        apiStyle: currentCandidate.apiStyle,
      };
    } catch (error) {
      lastError = error;
      lastApiStyle = currentCandidate.apiStyle;

      if (
        nextCandidate &&
        shouldRetryWithAlternateApiStyle(
          error,
          currentCandidate.apiStyle,
          nextCandidate.apiStyle
        )
      ) {
        continue;
      }

      throw new Error(
        normalizeAiRequestError(
          error,
          providerId,
          currentCandidate.apiStyle,
          config
        )
      );
    }
  }

  throw new Error(
    normalizeAiRequestError(lastError, providerId, lastApiStyle, config)
  );
}

export async function requestOpenAIAssistantResponse(
  request: OpenAIAssistantRequest
): Promise<OpenAIAssistantResponse> {
  const providerId = request.settings.activeProviderId;
  const activeProvider = getActiveAiProviderConfig(request.settings);
  const { generateText, modelCandidates } = await resolveProviderRuntime(
    providerId,
    activeProvider
  );

  try {
    const response = await generateTextWithFallback<any>({
      providerId,
      config: activeProvider,
      generateText,
      modelCandidates,
      createOptions: (model) => ({
        model,
        system: [
          buildAssistantInstructions(request.settings.autoSuggest),
          buildRedisContext({
            activeConnection: request.activeConnection,
            selectedDb: request.selectedDb,
            selectedKey: request.selectedKey,
            keyValue: request.keyValue,
            keysCount: request.keysCount,
            includeKeyContext: request.settings.includeKeyContext,
          }),
        ].join("\n\n"),
        messages: [
          ...request.chatMessages
            .slice(-MAX_CONTEXT_MESSAGES)
            .map(toOpenAIChatMessage),
        ],
        maxOutputTokens: request.settings.maxTokens,
        temperature: 0.2,
      }),
    });
    const text = String(response.result?.text ?? "");

    const rawContent = text.trim();

    if (!rawContent) {
      throw new Error("The AI provider returned an empty assistant response.");
    }

    return parseAssistantResponse(rawContent);
  } catch (error) {
    throw new Error(getErrorMessage(error));
  }
}

export async function testAiProviderConnection(
  providerId: AiProviderId,
  config: AiProviderConfig
) {
  const { generateText, modelCandidates } = await resolveProviderRuntime(
    providerId,
    config
  );

  try {
    const response = await generateTextWithFallback<any>({
      providerId,
      config,
      generateText,
      modelCandidates,
      createOptions: (model) => ({
        model,
        prompt: 'Reply with "OK" only.',
        maxOutputTokens: 8,
        temperature: 0,
      }),
    });
    const text = String(response.result?.text ?? "");

    return text.trim();
  } catch (error) {
    throw new Error(getErrorMessage(error));
  }
}
