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
      pubsub: string;
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
    confirmDeleteConnection: string;
  };
  ui: {
    appName: string;
    titleBar: {
      close: string;
      minimize: string;
      maximize: string;
    };
    tree: {
      expandGroup: string;
      collapseGroup: string;
    };
    connection: {
      clusterNodesLabel: string;
      clusterDefaultName: string;
      sentinelDefaultName: string;
    };
    aiPanel: {
      working: string;
      thinking: string;
      usingTool: string;
      process: string;
      response: string;
      failed: string;
      thoughtProcess: string;
      preparingTool: string;
      preparedTool: string;
      runningTool: string;
      toolFinished: string;
      toolFailed: string;
      completed: string;
      executedCommand: string;
      suggestedCommand: string;
      executedRedisCommand: string;
      completedRedisInspection: string;
      stepsWithTools: string;
      steps: string;
      items: string;
    };
    aiConnectionTest: {
      baseUrlPlaceholder: string;
      modelPlaceholder: string;
      failedToTest: string;
      runtimeApi: string;
      testingCheck: string;
      idleSummary: string;
      configLabel: string;
      configPending: string;
      configValidated: string;
      modelsPending: string;
      modelsFailure: string;
      responsesPending: string;
      chatPending: string;
      modelsChecking: string;
      responsesChecking: string;
      chatChecking: string;
      settingsIncomplete: string;
      modelsSuccess: string;
      modelsMissing: string;
      modelsReachable: string;
      responsesFailure: string;
      responsesSuccessWithReply: string;
      responsesSuccess: string;
      chatFailure: string;
      chatSuccessWithReply: string;
      chatSuccess: string;
      summaryAllOk: string;
      summaryRuntimeNoModels: string;
      summaryRuntimeVerified: string;
      summaryChatOnly: string;
      summaryResponsesFailed: string;
      summaryFailed: string;
      summaryCompleted: string;
      runtimeWillUse: string;
      apiStyleResponses: string;
      apiStyleChatCompletions: string;
      apiStyleUnknown: string;
    };
    errors: {
      keyAlreadyExists: string;
      fieldRequired: string;
      valueRequired: string;
      memberRequired: string;
      indexInvalid: string;
      groupNameRequired: string;
      openAiApiKeyRequired: string;
      openAiModelRequired: string;
      openAiRequestFailed: string;
      openAiRequestFailedAt: string;
      aiMaxToolSteps: string;
      aiProviderReturnedError: string;
      aiEmptyAssistantResponse: string;
      aiNoActiveRedisConnection: string;
      aiCommandRequired: string;
      aiSingleCommandOnly: string;
      aiReadOnlyCommandRequired: string;
      aiCommandDisabled: string;
      aiDirectExecutionUnsupported: string;
      aiDangerousNeedsConfirmation: string;
      aiDangerousCancelled: string;
      aiSuggestedCommandRequired: string;
      aiSuggestSingleCommand: string;
      aiUnknownTool: string;
      aiUnknownToolError: string;
      redisUrlEmpty: string;
      invalidRedisUrl: string;
      redisUrlProtocol: string;
      redisUrlHostMissing: string;
      redisUrlPortInvalid: string;
      redisUrlDbInvalid: string;
      keySegmentSeparatorInvalid: string;
      groupSegmentSeparatorInvalid: string;
      sentinelNodeInvalid: string;
      sentinelNodeHostInvalid: string;
      sentinelNodePortInvalid: string;
      sentinelMasterNameRequired: string;
      sentinelNodeRequired: string;
      clusterNodeInvalid: string;
      clusterNodeHostInvalid: string;
      clusterNodePortInvalid: string;
      clusterNodeRequired: string;
      sshHostRequired: string;
      sshPortInvalid: string;
      sshUsernameRequired: string;
      databaseInvalid: string;
      hostRequired: string;
      portInvalid: string;
    };
  };
  commandPalette: {
    placeholder: string;
    actions: string;
    recentConnections: string;
    databases: string;
    connections: string;
    recentKeys: string;
    keys: string;
    loadMoreKeys: string;
    newConnection: string;
    refreshKeys: string;
    openSettings: string;
    noResults: string;
    hint: string;
    active: string;
    panel: string;
    switchDb: string;
    currentDb: string;
  };
  keyBrowser: {
    title: string;
    refresh: string;
    loading: string;
    refreshing: string;
    expandAll: string;
    collapseAll: string;
    filterPlaceholder: string;
    activeDb: string;
    allNodes: string;
    clusterView: string;
    clusterTopologyUnavailable: string;
    create: string;
    createTitle: string;
    createDescription: string;
    keyName: string;
    keyNamePlaceholder: string;
    type: string;
    ttl: string;
    ttlPlaceholder: string;
    ttlHint: string;
    ttlInvalid: string;
    valuePlaceholder: string;
    jsonPlaceholder: string;
    fieldPlaceholder: string;
    memberPlaceholder: string;
    values: string;
    entries: string;
    members: string;
    addValue: string;
    addEntry: string;
    addMember: string;
    keyNameRequired: string;
    jsonRequired: string;
    valueListRequired: string;
    fieldListRequired: string;
    memberListRequired: string;
    scoreInvalid: string;
    createSubmit: string;
    creating: string;
    createSuccess: string;
    confirmDeleteGroup: string;
    loadMore: string;
    loadingMore: string;
    stopLoading: string;
    loadedSummary: string;
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
  pubsub: {
    title: string;
    idle: string;
    connecting: string;
    listening: string;
    channelPlaceholder: string;
    channelRequired: string;
    subscribe: string;
    unsubscribe: string;
    publish: string;
    publishChannelPlaceholder: string;
    payloadPlaceholder: string;
    stream: string;
    shortcuts: string;
    noSubscriptions: string;
    subscriptions: string;
    noMessages: string;
    noMessagesHint: string;
    publishResult: string;
  };
  connectionModal: {
    title: string;
    color: string;
    name: string;
    namePlaceholder: string;
    url: string;
    urlPlaceholder: string;
    importUrl: string;
    mode: string;
    direct: string;
    sentinel: string;
    cluster: string;
    host: string;
    port: string;
    clusterNodes: string;
    clusterNodesPlaceholder: string;
    sentinelMasterName: string;
    sentinelMasterNamePlaceholder: string;
    sentinelNodes: string;
    sentinelNodesPlaceholder: string;
    sentinelUsername: string;
    sentinelPassword: string;
    sentinelTls: string;
    username: string;
    usernamePlaceholder: string;
    password: string;
    passwordPlaceholder: string;
    database: string;
    tls: string;
    sshTunnel: string;
    sshHost: string;
    sshPort: string;
    sshUsername: string;
    sshPassword: string;
    sshPasswordPlaceholder: string;
    sshPrivateKeyPath: string;
    sshPrivateKeyPathPlaceholder: string;
    sshPassphrase: string;
    sshPassphrasePlaceholder: string;
    clusterSshUnsupported: string;
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
    confirmDeleteKey: string;
    confirmDeleteField: string;
    confirmDeleteListItem: string;
    confirmDeleteMember: string;
    browseNode: string;
    ttlInputPlaceholder: string;
    field: string;
    value: string;
    rank: string;
    member: string;
    score: string;
    insertPosition: string;
    insertHead: string;
    insertTail: string;
    ttlBadge: string;
    loadMore: string;
    loadingMore: string;
    loadedSummary: string;
    headers: {
      index: string;
    };
  };
  streamViewer: {
    messagesTab: string;
    groupsTab: string;
    entries: string;
    entryId: string;
    entryContent: string;
    loading: string;
    addEntry: string;
    addField: string;
    saveEntry: string;
    entryField: string;
    entryValue: string;
    entryFieldPlaceholder: string;
    entryValuePlaceholder: string;
    groups: string;
    consumers: string;
    pending: string;
    groupName: string;
    groupNamePlaceholder: string;
    startId: string;
    startIdPlaceholder: string;
    createGroup: string;
    noGroups: string;
    noConsumers: string;
    noPending: string;
    pendingHint: string;
    selectGroup: string;
    deliveries: string;
    idle: string;
    inactive: string;
    lag: string;
    entriesRead: string;
    lastDeliveredId: string;
    pendingCount: string;
    consumerFilter: string;
    allConsumers: string;
    targetConsumer: string;
    targetConsumerPlaceholder: string;
    minIdle: string;
    ackSelected: string;
    claimSelected: string;
    refreshAll: string;
    refreshGroups: string;
    refreshPending: string;
    destroyGroup: string;
    deleteConsumer: string;
    deleteEntry: string;
    createGroupSuccess: string;
    destroyGroupSuccess: string;
    deleteConsumerSuccess: string;
    deleteEntrySuccess: string;
    addEntrySuccess: string;
    ackSuccess: string;
    claimSuccess: string;
    groupRequired: string;
    startIdRequired: string;
    consumerRequired: string;
    invalidMinIdle: string;
    confirmDestroyGroup: string;
    confirmDeleteConsumer: string;
    confirmDeleteEntry: string;
    rawPreviewEmpty: string;
    rawPreviewHint: string;
  };
  settings: {
    categories: {
      general: string;
      appearance: string;
      editor: string;
      ai: string;
      cli: string;
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
      updates: string;
      currentVersion: string;
      latestVersion: string;
      checkForUpdates: string;
      checkingForUpdates: string;
      upToDate: string;
      updateAvailable: string;
      downloadAndInstall: string;
      downloadingUpdate: string;
      installingUpdate: string;
    };
    appearance: {
      theme: string;
      layout: string;
      showKeyType: string;
      showTtl: string;
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
    privacy: {
      security: string;
      savePasswords: string;
      savePasswordsDescription: string;
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
