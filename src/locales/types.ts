export const SUPPORTED_LOCALES = [
  "en",
  "zh",
  "ja",
  "ko",
  "es",
  "fr",
  "de",
  "pt",
  "ru",
  "it",
  "ar",
  "hi",
] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export interface LocaleOption {
  value: Locale;
  label: string;
  tag: string;
  direction: "ltr" | "rtl";
}

export const LOCALE_OPTIONS: LocaleOption[] = [
  { value: "en", label: "English", tag: "en-US", direction: "ltr" },
  { value: "zh", label: "简体中文", tag: "zh-CN", direction: "ltr" },
  { value: "ja", label: "日本語", tag: "ja-JP", direction: "ltr" },
  { value: "ko", label: "한국어", tag: "ko-KR", direction: "ltr" },
  { value: "es", label: "Español", tag: "es-ES", direction: "ltr" },
  { value: "fr", label: "Français", tag: "fr-FR", direction: "ltr" },
  { value: "de", label: "Deutsch", tag: "de-DE", direction: "ltr" },
  { value: "pt", label: "Português", tag: "pt-BR", direction: "ltr" },
  { value: "ru", label: "Русский", tag: "ru-RU", direction: "ltr" },
  { value: "it", label: "Italiano", tag: "it-IT", direction: "ltr" },
  { value: "ar", label: "العربية", tag: "ar-SA", direction: "rtl" },
  { value: "hi", label: "हिन्दी", tag: "hi-IN", direction: "ltr" },
];

export const LOCALE_TAGS: Record<Locale, string> = {
  en: "en-US",
  zh: "zh-CN",
  ja: "ja-JP",
  ko: "ko-KR",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  pt: "pt-BR",
  ru: "ru-RU",
  it: "it-IT",
  ar: "ar-SA",
  hi: "hi-IN",
};

export interface Messages {
  common: {
    save: string;
    cancel: string;
    clear: string;
    copy: string;
    copied: string;
    refresh: string;
    reset: string;
    settings: string;
    edit: string;
    disconnect: string;
    delete: string;
  };
  app: {
    tabs: {
      editor: string;
      ai: string;
      cli: string;
    };
    status: {
      notConnected: string;
      keysCount: string;
    };
    connection: {
      tls: string;
    };
    emptyState: {
      title: string;
      description: string;
      action: string;
    };
  };
  sidebar: {
    newConnection: string;
    cli: string;
    aiAgent: string;
    settings: string;
    expand: string;
    collapse: string;
  };
  keyBrowser: {
    title: string;
    refresh: string;
    expandAll: string;
    collapseAll: string;
    filterPlaceholder: string;
    activeDb: string;
  };
  ai: {
    title: string;
    subtitle: string;
    online: string;
    quickActions: string;
    placeholder: string;
    send: string;
    copyCommand: string;
    suggestions: string[];
  };
  cli: {
    title: string;
    copyHistory: string;
    clear: string;
    placeholder: string;
    hint: string;
    connectedTo: string;
    confirmDangerousCommand: string;
    confirmDangerousDescription: string;
    confirmDangerousApprove: string;
  };
  connectionModal: {
    title: string;
    color: string;
    name: string;
    namePlaceholder: string;
    host: string;
    port: string;
    password: string;
    passwordPlaceholder: string;
    database: string;
    tls: string;
    success: string;
    failure: string;
    testConnection: string;
    testing: string;
  };
  valueEditor: {
    emptyState: string;
    noExpiry: string;
    expired: string;
    persistent: string;
    copyValue: string;
    deleteKey: string;
    ttlInputPlaceholder: string;
    field: string;
    value: string;
    rank: string;
    member: string;
    score: string;
    ttlBadge: string;
    headers: {
      index: string;
    };
  };
  settings: {
    categories: {
      general: string;
      appearance: string;
      editor: string;
      ai: string;
      cli: string;
      shortcuts: string;
      privacy: string;
    };
    general: {
      startup: string;
      autoConnect: string;
      autoConnectDescription: string;
      language: string;
      keyBrowser: string;
      keySeparator: string;
      keySeparatorDescription: string;
      maxKeys: string;
      maxKeysDescription: string;
      scanCount: string;
      scanCountDescription: string;
      safety: string;
      confirmDelete: string;
      confirmDeleteDescription: string;
    };
    appearance: {
      theme: string;
      font: string;
      fontSize: string;
      layout: string;
      compactMode: string;
      compactModeDescription: string;
      showKeyType: string;
      showTtl: string;
      enableAnimations: string;
      themes: {
        light: string;
        dark: string;
        system: string;
      };
    };
    editor: {
      jsonString: string;
      autoFormatJson: string;
      autoFormatJsonDescription: string;
      syntaxHighlighting: string;
      wordWrap: string;
      maxValueSize: string;
      maxValueSizeDescription: string;
      defaults: string;
      defaultTtl: string;
      defaultTtlDescription: string;
      hashDisplayMode: string;
      hashDisplayModes: {
        table: string;
        json: string;
      };
    };
    ai: {
      apiConfiguration: string;
      providerList: string;
      apiKey: string;
      apiKeyPlaceholder: string;
      baseUrl: string;
      model: string;
      maxTokens: string;
      behavior: string;
      autoSuggest: string;
      autoSuggestDescription: string;
      includeKeyContext: string;
      includeKeyContextDescription: string;
      enabled: string;
      disabled: string;
      testConnection: string;
      testingConnection: string;
      saveApiKey: string;
    };
    cli: {
      history: string;
      maxHistoryEntries: string;
      showTimestamps: string;
      syntaxHighlighting: string;
      execution: string;
      commandTimeout: string;
      pipelineMode: string;
      pipelineModeDescription: string;
      actions: string;
      clearHistory: string;
      clearHistoryDescription: string;
    };
    shortcuts: {
      title: string;
      items: Array<{
        action: string;
        keys: string[];
      }>;
    };
    privacy: {
      dataCollection: string;
      anonymousTelemetry: string;
      anonymousTelemetryDescription: string;
      crashReports: string;
      crashReportsDescription: string;
      security: string;
      savePasswords: string;
      savePasswordsDescription: string;
      auditLog: string;
      auditLogDescription: string;
      data: string;
      clearCachedData: string;
      clearCachedDataDescription: string;
    };
  };
  store: {
    greeting: string;
    ttlDetails: string;
    ttlSetHint: string;
    ttlClearHint: string;
    selectKeyFirst: string;
    deleteKey: string;
    deleteWarning: string;
    selectKeyDelete: string;
    countResponse: string;
    performanceResponse: string;
    fallback: string;
  };
  units: {
    compact: {
      second: string;
      minute: string;
      hour: string;
      day: string;
    };
    full: {
      second: string;
      minute: string;
      hour: string;
      day: string;
    };
  };
}
