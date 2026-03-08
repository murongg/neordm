let aiPanelModulePromise: Promise<void> | null = null;
let aiEntryWarmupPromise: Promise<void> | null = null;

export function preloadAIAgentPanelModule() {
  if (aiPanelModulePromise) {
    return aiPanelModulePromise;
  }

  aiPanelModulePromise = import("../components/AIAgentPanel")
    .then(() => undefined)
    .catch((error) => {
      aiPanelModulePromise = null;
      throw error;
    });

  return aiPanelModulePromise;
}

export function prepareAIAgentExperience() {
  if (aiEntryWarmupPromise) {
    return aiEntryWarmupPromise;
  }

  aiEntryWarmupPromise = Promise.all([
    preloadAIAgentPanelModule(),
    import("./openai").then(({ warmOpenAIAssistantRuntime }) =>
      warmOpenAIAssistantRuntime()
    ),
  ])
    .then(() => undefined)
    .catch((error) => {
      aiEntryWarmupPromise = null;
      throw error;
    });

  return aiEntryWarmupPromise;
}
