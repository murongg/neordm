import { loadAiSettings } from "./aiSettings";
import { getActiveAiProviderConfig } from "./aiSettings";
import { createConfiguredOpenAIModel } from "./openai/provider";
import { buildAssistantInstructions, buildRedisContext } from "./openai/helpers";
import { warmAssistantToolValidation } from "./openai/tools";
import { createAssistantTools } from "./openai/tools";

let assistantRuntimeWarmupPromise: Promise<void> | null = null;
let assistantRuntimeWarmupScheduled = false;

export function warmOpenAIAssistantRuntime() {
  if (assistantRuntimeWarmupPromise) {
    return assistantRuntimeWarmupPromise;
  }

  const warmupPromise = loadAiSettings().then(async (settings) => {
    createConfiguredOpenAIModel(getActiveAiProviderConfig(settings));
    createAssistantTools(settings.autoSuggest);
    buildAssistantInstructions(settings.autoSuggest);
    buildRedisContext({
      activeConnection: undefined,
      selectedDb: 0,
      selectedKey: null,
      keyValue: null,
      keysCount: 0,
      includeKeyContext: settings.includeKeyContext,
    });
    await warmAssistantToolValidation();
  });

  assistantRuntimeWarmupPromise = warmupPromise.catch((error) => {
    assistantRuntimeWarmupPromise = null;
    throw error;
  });

  return assistantRuntimeWarmupPromise;
}

export function scheduleOpenAIAssistantWarmup() {
  if (assistantRuntimeWarmupScheduled || typeof window === "undefined") {
    return;
  }

  assistantRuntimeWarmupScheduled = true;

  window.requestAnimationFrame(() => {
    void warmOpenAIAssistantRuntime().catch((error) => {
      console.error("Failed to warm AI assistant runtime", error);
    });
  });
}

export {
  requestOpenAIAssistantResponse,
  testAiProviderConnection,
} from "./openai/client";
export type {
  OpenAIAssistantRequest,
  OpenAIAssistantResponse,
} from "./openai/types";
export type {
  AiProviderConnectionTestCheck,
  AiProviderConnectionTestCheckStatus,
  AiProviderConnectionTestResult,
} from "./openai/client";
