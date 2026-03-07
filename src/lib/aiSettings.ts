import { settingsStore } from "./settingsStore";

export const AI_PROVIDER_IDS = ["openai"] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export interface AiProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface AiSettings {
  activeProviderId: AiProviderId;
  providers: Record<AiProviderId, AiProviderConfig>;
  maxTokens: number;
  autoSuggest: boolean;
  includeKeyContext: boolean;
}

const LEGACY_AI_SETTINGS_STORAGE_KEY = "neordm-ai-settings";
const AI_SETTINGS_STORE_KEY = "ai";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

let cachedAiSettings: AiSettings | null = null;

function createProviderConfig(
  overrides: Partial<AiProviderConfig> = {}
): AiProviderConfig {
  return {
    apiKey: "",
    baseUrl: "",
    model: "",
    ...overrides,
  };
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  activeProviderId: "openai",
  providers: {
    openai: createProviderConfig({
      baseUrl: DEFAULT_OPENAI_BASE_URL,
      model: "gpt-4.1-mini",
    }),
  },
  maxTokens: 2048,
  autoSuggest: true,
  includeKeyContext: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeProviderConfig(
  value: unknown,
  defaults: AiProviderConfig
): AiProviderConfig {
  if (!isRecord(value)) {
    return defaults;
  }

  return {
    apiKey: typeof value.apiKey === "string" ? value.apiKey : defaults.apiKey,
    baseUrl:
      typeof value.baseUrl === "string" && value.baseUrl.trim().length > 0
        ? value.baseUrl.trim()
        : defaults.baseUrl,
    model:
      typeof value.model === "string" && value.model.trim().length > 0
        ? value.model.trim()
        : defaults.model,
  };
}

function normalizeNewShape(value: Record<string, unknown>): AiSettings {
  const providersValue = isRecord(value.providers) ? value.providers : {};

  return {
    activeProviderId: "openai",
    providers: {
      openai: normalizeProviderConfig(
        providersValue.openai,
        DEFAULT_AI_SETTINGS.providers.openai
      ),
    },
    maxTokens:
      typeof value.maxTokens === "number" &&
      Number.isFinite(value.maxTokens) &&
      value.maxTokens > 0
        ? Math.round(value.maxTokens)
        : DEFAULT_AI_SETTINGS.maxTokens,
    autoSuggest:
      typeof value.autoSuggest === "boolean"
        ? value.autoSuggest
        : DEFAULT_AI_SETTINGS.autoSuggest,
    includeKeyContext:
      typeof value.includeKeyContext === "boolean"
        ? value.includeKeyContext
        : DEFAULT_AI_SETTINGS.includeKeyContext,
  };
}

function normalizeLegacyShape(value: Record<string, unknown>): AiSettings {
  return {
    ...DEFAULT_AI_SETTINGS,
    providers: {
      openai: {
        apiKey:
          typeof value.apiKey === "string"
            ? value.apiKey
            : DEFAULT_AI_SETTINGS.providers.openai.apiKey,
        baseUrl:
          typeof value.baseUrl === "string" && value.baseUrl.trim().length > 0
            ? value.baseUrl.trim()
            : DEFAULT_AI_SETTINGS.providers.openai.baseUrl,
        model:
          typeof value.model === "string" && value.model.trim().length > 0
            ? value.model.trim()
            : DEFAULT_AI_SETTINGS.providers.openai.model,
      },
    },
    maxTokens:
      typeof value.maxTokens === "number" &&
      Number.isFinite(value.maxTokens) &&
      value.maxTokens > 0
        ? Math.round(value.maxTokens)
        : DEFAULT_AI_SETTINGS.maxTokens,
    autoSuggest:
      typeof value.autoSuggest === "boolean"
        ? value.autoSuggest
        : DEFAULT_AI_SETTINGS.autoSuggest,
    includeKeyContext:
      typeof value.includeKeyContext === "boolean"
        ? value.includeKeyContext
        : DEFAULT_AI_SETTINGS.includeKeyContext,
  };
}

function normalizeAiSettings(value: unknown): AiSettings {
  if (!isRecord(value)) {
    return DEFAULT_AI_SETTINGS;
  }

  if ("providers" in value) {
    return normalizeNewShape(value);
  }

  return normalizeLegacyShape(value);
}

export function getAiProviderConfig(
  settings: AiSettings,
  providerId: AiProviderId = "openai"
): AiProviderConfig {
  return settings.providers[providerId] ?? DEFAULT_AI_SETTINGS.providers.openai;
}

export function getActiveAiProviderConfig(settings: AiSettings) {
  return getAiProviderConfig(settings, "openai");
}

function loadLegacyAiSettings(): AiSettings | null {
  if (typeof localStorage === "undefined") {
    return null;
  }

  try {
    const raw = localStorage.getItem(LEGACY_AI_SETTINGS_STORAGE_KEY);

    if (!raw) {
      return null;
    }

    return normalizeAiSettings(JSON.parse(raw));
  } catch (error) {
    console.error("Failed to load legacy AI settings", error);
    return null;
  }
}

function persistLegacyAiSettings(settings: AiSettings) {
  if (typeof localStorage === "undefined") {
    return;
  }

  try {
    localStorage.setItem(
      LEGACY_AI_SETTINGS_STORAGE_KEY,
      JSON.stringify(normalizeAiSettings(settings))
    );
  } catch (error) {
    console.error("Failed to persist legacy AI settings", error);
  }
}

export async function loadAiSettings(): Promise<AiSettings> {
  if (cachedAiSettings) {
    return cachedAiSettings;
  }

  try {
    const raw = await settingsStore.get<unknown>(AI_SETTINGS_STORE_KEY);

    if (raw !== undefined) {
      const normalized = normalizeAiSettings(raw);
      cachedAiSettings = normalized;
      persistLegacyAiSettings(normalized);
      return normalized;
    }
  } catch (error) {
    console.error("Failed to load AI settings from settings.json", error);
  }

  const legacySettings = loadLegacyAiSettings();

  if (legacySettings) {
    cachedAiSettings = legacySettings;
    await persistAiSettings(legacySettings);
    return legacySettings;
  }

  cachedAiSettings = DEFAULT_AI_SETTINGS;
  return DEFAULT_AI_SETTINGS;
}

export async function persistAiSettings(settings: AiSettings) {
  const normalized = normalizeAiSettings(settings);
  cachedAiSettings = normalized;
  persistLegacyAiSettings(normalized);

  try {
    await settingsStore.set(AI_SETTINGS_STORE_KEY, normalized);
    await settingsStore.save();
  } catch (error) {
    console.error("Failed to persist AI settings to settings.json", error);
  }
}
