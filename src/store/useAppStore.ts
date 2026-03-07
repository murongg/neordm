import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import {
  loadStoredConnections,
  persistConnections,
} from "../lib/connectionStore";
import {
  DEFAULT_APP_SETTINGS,
  loadAppSettings,
  subscribeAppSettings,
  updateAppSettings,
  type AppSettings,
} from "../lib/appSettings";
import {
  deleteRedisHashEntry,
  deleteRedisZSetEntry,
  getRedisErrorMessage,
  getRedisKeyValue,
  listRedisKeys,
  renameRedisKey,
  renameRedisKeys,
  runRedisCommand,
  testRedisConnection,
  updateRedisHashEntry,
  updateRedisJsonValue,
  updateRedisStringValue,
  updateRedisZSetEntry,
} from "../lib/redis";
import { loadAiSettings } from "../lib/aiSettings";
import {
  getBuiltinCliOutput,
  getCliCommandName,
  getCliPromptLabel,
  isBuiltinCliCommand,
  isReadOnlyRedisCommand,
} from "../lib/redisCli";
import { requestOpenAIAssistantResponse } from "../lib/openai";
import {
  recordAuditEvent,
  recordCrashReport,
  recordTelemetryEvent,
} from "../lib/privacyRuntime";
import type {
  RedisConnection,
  RedisKey,
  KeyValue,
  PanelTab,
  ChatMessage,
  CliEntry,
} from "../types";

function createCliEntry(
  type: CliEntry["type"],
  content: string,
  promptLabel?: string
): CliEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    content,
    timestamp: new Date(),
    promptLabel,
  };
}

function createChatMessage(
  role: ChatMessage["role"],
  content: string,
  command?: string
): ChatMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    command,
    timestamp: new Date(),
  };
}

function escapeRedisCommandArgument(value: string) {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function parsePositiveInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function useAppStore() {
  const { messages } = useI18n();
  const [connections, setConnections] = useState<RedisConnection[]>([]);
  const [activeConnectionId, setActiveConnectionId] = useState<string>("");
  const [selectedDb, setSelectedDb] = useState<number>(0);
  const [keys, setKeys] = useState<RedisKey[]>([]);
  const [selectedKey, setSelectedKey] = useState<RedisKey | null>(null);
  const [keyValue, setKeyValue] = useState<KeyValue | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [keySeparator, setKeySeparatorState] = useState<string>(
    DEFAULT_APP_SETTINGS.general.keySeparator
  );
  const [panelTab, setPanelTab] = useState<PanelTab>("editor");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => [
    createChatMessage("assistant", messages.store.greeting),
  ]);
  const [isAiResponding, setIsAiResponding] = useState(false);
  const [cliHistory, setCliHistory] = useState<CliEntry[]>([]);
  const [showConnectionModal, setShowConnectionModal] = useState(false);
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(
    null
  );
  const [isSidebarCollapsed, setIsSidebarCollapsedState] = useState(
    DEFAULT_APP_SETTINGS.ui.sidebarCollapsed
  );
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [isLoadingKeys, setIsLoadingKeys] = useState(false);
  const [hasHydratedConnections, setHasHydratedConnections] = useState(false);
  const [hasHydratedSettings, setHasHydratedSettings] = useState(false);

  const keysRequestRef = useRef(0);
  const keyValueRequestRef = useRef(0);
  const hasHydratedPreferencesRef = useRef(false);
  const hasAttemptedAutoConnectRef = useRef(false);

  const setIsSidebarCollapsed = useCallback(
    (nextValue: boolean | ((previous: boolean) => boolean)) => {
      setIsSidebarCollapsedState((previous) => {
        const resolvedValue =
          typeof nextValue === "function" ? nextValue(previous) : nextValue;

        if (hasHydratedPreferencesRef.current) {
          void updateAppSettings((current) => ({
            ...current,
            ui: {
              ...current.ui,
              sidebarCollapsed: resolvedValue,
            },
          }));
        }

        return resolvedValue;
      });
    },
    []
  );

  const toggleSidebarCollapsed = useCallback(() => {
    setIsSidebarCollapsed((previous) => !previous);
  }, [setIsSidebarCollapsed]);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribeAppSettings((settings) => {
      if (cancelled) {
        return;
      }

      setAppSettings(settings);
      setKeySeparatorState(settings.general.keySeparator);
      setIsSidebarCollapsedState(settings.ui.sidebarCollapsed);
      hasHydratedPreferencesRef.current = true;
      setHasHydratedSettings(true);
    });

    void loadAppSettings()
      .then((settings) => {
        if (cancelled) {
          return;
        }

        setAppSettings(settings);
        setKeySeparatorState(settings.general.keySeparator);
        setIsSidebarCollapsedState(settings.ui.sidebarCollapsed);
        hasHydratedPreferencesRef.current = true;
        setHasHydratedSettings(true);
      })
      .catch((error) => {
        console.error("Failed to load app settings", error);
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    void loadStoredConnections()
      .then((storedConnections) => {
        if (!isMounted) return;
        setConnections(storedConnections);
      })
      .catch((error) => {
        console.error("Failed to load persisted connections", error);
      })
      .finally(() => {
        if (!isMounted) return;
        setHasHydratedConnections(true);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hasHydratedConnections) return;

    void persistConnections(connections, {
      savePasswords: appSettings.privacy.savePasswords,
    }).catch((error) => {
      console.error("Failed to persist connections", error);
    });
  }, [appSettings.privacy.savePasswords, connections, hasHydratedConnections]);

  const activeConnection =
    connections.find((connection) => connection.id === activeConnectionId) ??
    undefined;
  const editingConnection =
    connections.find((connection) => connection.id === editingConnectionId) ??
    null;

  const persistLastConnectionId = useCallback(
    (nextConnectionId: string) => {
      if (
        !hasHydratedPreferencesRef.current ||
        appSettings.ui.lastConnectionId === nextConnectionId
      ) {
        return;
      }

      void updateAppSettings((current) => ({
        ...current,
        ui: {
          ...current.ui,
          lastConnectionId: nextConnectionId,
        },
      }));
    },
    [appSettings.ui.lastConnectionId]
  );

  const updateConnection = useCallback(
    (connectionId: string, updater: (connection: RedisConnection) => RedisConnection) => {
      setConnections((previous) =>
        previous.map((connection) =>
          connection.id === connectionId ? updater(connection) : connection
        )
      );
    },
    []
  );

  const syncConnectionStatus = useCallback(
    (connectionId: string, status: RedisConnection["status"], db?: number) => {
      updateConnection(connectionId, (connection) => ({
        ...connection,
        status,
        db: db ?? connection.db,
      }));
    },
    [updateConnection]
  );

  const removeKeyFromState = useCallback((key: string) => {
    setKeys((previous) => previous.filter((item) => item.key !== key));
    setSelectedKey((previous) => (previous?.key === key ? null : previous));
    keyValueRequestRef.current += 1;
    setKeyValue((previous) => (previous?.key === key ? null : previous));
  }, []);

  const loadKeyValue = useCallback(
    async (
      connection: RedisConnection,
      key: RedisKey,
      db: number,
      options: { preserveValue?: boolean } = {}
    ) => {
      const requestId = ++keyValueRequestRef.current;

      setSelectedKey(key);
      setPanelTab("editor");

      if (!options.preserveValue) {
        setKeyValue(null);
      }

      try {
        const value = await getRedisKeyValue(
          { ...connection, db },
          key.key
        );

        if (requestId !== keyValueRequestRef.current) return;

        setKeyValue(value);
      } catch (error) {
        if (requestId !== keyValueRequestRef.current) return;

        setKeyValue({
          key: key.key,
          type: "string",
          ttl: key.ttl,
          value: getRedisErrorMessage(error),
        });
      }
    },
    []
  );

  const loadKeys = useCallback(
    async (
      connection: RedisConnection,
      db: number,
      options: { preserveSelection?: boolean } = {}
    ) => {
      const requestId = ++keysRequestRef.current;
      const currentSelectedKey = options.preserveSelection ? selectedKey : null;

      setIsLoadingKeys(true);
      syncConnectionStatus(connection.id, "connecting", db);

      if (!options.preserveSelection) {
        keyValueRequestRef.current += 1;
        setSelectedKey(null);
        setKeyValue(null);
      }

      try {
        const nextKeys = await listRedisKeys(
          { ...connection, db },
          {
            maxKeys: parsePositiveInt(appSettings.general.maxKeys, 10_000),
            scanCount: parsePositiveInt(appSettings.general.scanCount, 200),
          }
        );

        if (requestId !== keysRequestRef.current) return;

        setKeys(nextKeys);
        setSelectedDb(db);
        syncConnectionStatus(connection.id, "connected", db);

        if (currentSelectedKey) {
          const refreshedSelectedKey =
            nextKeys.find((item) => item.key === currentSelectedKey.key) ?? null;

          if (!refreshedSelectedKey) {
            setSelectedKey(null);
            setKeyValue(null);
          } else {
            void loadKeyValue(connection, refreshedSelectedKey, db);
          }
        }
      } catch (error) {
        if (requestId !== keysRequestRef.current) return;

        setKeys([]);
        setSelectedKey(null);
        setKeyValue(null);
        syncConnectionStatus(connection.id, "error", db);
        throw error;
      } finally {
        if (requestId === keysRequestRef.current) {
          setIsLoadingKeys(false);
        }
      }
    },
    [
      appSettings.general.maxKeys,
      appSettings.general.scanCount,
      loadKeyValue,
      selectedKey,
      syncConnectionStatus,
    ]
  );

  const selectConnection = useCallback(
    async (connectionId: string) => {
      const connection = connections.find((item) => item.id === connectionId);

      setActiveConnectionId(connectionId);
      setSearchQuery("");

      if (!connection) {
        keyValueRequestRef.current += 1;
        setSelectedDb(0);
        setKeys([]);
        setSelectedKey(null);
        setKeyValue(null);
        return;
      }

      setSelectedDb(connection.db);
      persistLastConnectionId(connection.id);

      try {
        await loadKeys(connection, connection.db);
      } catch {}
    },
    [connections, loadKeys, persistLastConnectionId]
  );

  useEffect(() => {
    if (
      !hasHydratedConnections ||
      !hasHydratedSettings ||
      hasAttemptedAutoConnectRef.current
    ) {
      return;
    }

    hasAttemptedAutoConnectRef.current = true;

    if (!appSettings.general.autoConnect || activeConnectionId || !connections.length) {
      return;
    }

    const preferredConnection =
      connections.find(
        (connection) => connection.id === appSettings.ui.lastConnectionId
      ) ?? connections[0];

    void selectConnection(preferredConnection.id).catch(() => {});
  }, [
    activeConnectionId,
    appSettings.general.autoConnect,
    appSettings.ui.lastConnectionId,
    connections,
    hasHydratedConnections,
    hasHydratedSettings,
    selectConnection,
  ]);

  useEffect(() => {
    if (!hasHydratedSettings || !activeConnectionId) {
      return;
    }

    persistLastConnectionId(activeConnectionId);
  }, [activeConnectionId, hasHydratedSettings, persistLastConnectionId]);

  const openNewConnectionModal = useCallback(() => {
    setEditingConnectionId(null);
    setShowConnectionModal(true);
  }, []);

  const openEditConnectionModal = useCallback(
    (connectionId: string) => {
      const connection = connections.find((item) => item.id === connectionId);

      if (!connection) return;

      setEditingConnectionId(connectionId);
      setShowConnectionModal(true);
    },
    [connections]
  );

  const closeConnectionModal = useCallback(() => {
    setShowConnectionModal(false);
    setEditingConnectionId(null);
  }, []);

  const saveConnection = useCallback(
    async (connection: Omit<RedisConnection, "id" | "status">) => {
      const normalizedConnection = {
        ...connection,
        name: connection.name || `${connection.host}:${connection.port}`,
        password: connection.password || undefined,
      };

      await testRedisConnection({
        host: normalizedConnection.host,
        port: normalizedConnection.port,
        password: normalizedConnection.password,
        db: normalizedConnection.db,
        tls: normalizedConnection.tls,
      });
      void recordTelemetryEvent("connection.save");
      void recordAuditEvent("connection.save", {
        connection: normalizedConnection.name,
        tls: normalizedConnection.tls,
      });

      if (!editingConnectionId) {
        const newConnection: RedisConnection = {
          ...normalizedConnection,
          id: Date.now().toString(),
          status: "connecting",
        };

        setConnections((previous) => [...previous, newConnection]);
        setActiveConnectionId(newConnection.id);
        setSelectedDb(newConnection.db);
        setSearchQuery("");
        setSelectedKey(null);
        setKeyValue(null);
        persistLastConnectionId(newConnection.id);

        void loadKeys(newConnection, newConnection.db).catch(() => {});
        return;
      }

      const currentConnection = connections.find(
        (item) => item.id === editingConnectionId
      );

      if (!currentConnection) return;

      const updatedConnection: RedisConnection = {
        ...currentConnection,
        ...normalizedConnection,
        status:
          activeConnectionId === editingConnectionId
            ? "connecting"
            : "disconnected",
      };

      setConnections((previous) =>
        previous.map((item) =>
          item.id === editingConnectionId ? updatedConnection : item
        )
      );

      if (activeConnectionId === editingConnectionId) {
        setSelectedDb(updatedConnection.db);
        setSearchQuery("");
        void loadKeys(updatedConnection, updatedConnection.db).catch(() => {});
      }
    },
    [
      activeConnectionId,
      connections,
      editingConnectionId,
      loadKeys,
      persistLastConnectionId,
    ]
  );

  const deleteConnection = useCallback(
    (connectionId: string) => {
      let nextConnections: RedisConnection[] = [];
      let deletedConnection: RedisConnection | undefined;

      setConnections((previous) => {
        deletedConnection = previous.find((item) => item.id === connectionId);
        nextConnections = previous.filter((item) => item.id !== connectionId);
        return nextConnections;
      });

      if (!deletedConnection) return;

      if (
        activeConnectionId !== connectionId &&
        appSettings.ui.lastConnectionId === connectionId
      ) {
        persistLastConnectionId(activeConnectionId || nextConnections[0]?.id || "");
      }

      if (editingConnectionId === connectionId) {
        closeConnectionModal();
      }

      void recordTelemetryEvent("connection.delete");
      void recordAuditEvent("connection.delete", {
        connectionId,
      });

      if (activeConnectionId !== connectionId) return;

      setSearchQuery("");
      setSelectedKey(null);
      setKeyValue(null);
      setKeys([]);
      keyValueRequestRef.current += 1;

      const nextConnection = nextConnections[0];

      if (!nextConnection) {
        keysRequestRef.current += 1;
        setIsLoadingKeys(false);
        setActiveConnectionId("");
        setSelectedDb(0);
        persistLastConnectionId("");
        return;
      }

      setActiveConnectionId(nextConnection.id);
      setSelectedDb(nextConnection.db);
      persistLastConnectionId(nextConnection.id);
      void loadKeys(nextConnection, nextConnection.db).catch(() => {});
    },
    [
      activeConnectionId,
      appSettings.ui.lastConnectionId,
      closeConnectionModal,
      editingConnectionId,
      loadKeys,
      persistLastConnectionId,
    ]
  );

  const disconnectConnection = useCallback(
    (connectionId: string) => {
      updateConnection(connectionId, (connection) => ({
        ...connection,
        status: "disconnected",
      }));

      if (activeConnectionId !== connectionId) return;

      keysRequestRef.current += 1;
      keyValueRequestRef.current += 1;

      setIsLoadingKeys(false);
      setActiveConnectionId("");
      setSelectedDb(0);
      setSearchQuery("");
      setKeys([]);
      setSelectedKey(null);
      setKeyValue(null);
    },
    [activeConnectionId, updateConnection]
  );

  const selectDb = useCallback(
    async (db: number) => {
      if (!activeConnection) return;

      setSelectedDb(db);
      setSearchQuery("");
      updateConnection(activeConnection.id, (connection) => ({
        ...connection,
        db,
      }));

      try {
        await loadKeys({ ...activeConnection, db }, db);
      } catch {}
    },
    [activeConnection, loadKeys, updateConnection]
  );

  const refreshKeys = useCallback(async () => {
    if (!activeConnection) return;

    try {
      await loadKeys(activeConnection, selectedDb, { preserveSelection: true });
    } catch {}
  }, [activeConnection, loadKeys, selectedDb]);

  const refreshKeyValue = useCallback(async () => {
    if (!activeConnection || !selectedKey) {
      return;
    }

    await loadKeyValue(activeConnection, selectedKey, selectedDb, {
      preserveValue: true,
    });
  }, [activeConnection, loadKeyValue, selectedDb, selectedKey]);

  const updateKeyTtl = useCallback(
    async (key: string, nextTtl: number) => {
      if (!activeConnection) {
        throw new Error(messages.app.status.notConnected);
      }

      if (!Number.isInteger(nextTtl) || nextTtl < -1 || nextTtl === 0) {
        throw new Error("TTL must be -1 or a positive integer");
      }

      const escapedKey = escapeRedisCommandArgument(key);
      const command =
        nextTtl === -1
          ? `PERSIST ${escapedKey}`
          : `EXPIRE ${escapedKey} ${nextTtl}`;

      try {
        await runRedisCommand(
          { ...activeConnection, db: selectedDb },
          command
        );
      } catch (error) {
        void recordCrashReport("editor.ttl.update", error);
        throw error;
      }

      void recordTelemetryEvent("editor.ttl.update");
      void recordAuditEvent("editor.ttl.update", {
        key,
        ttl: nextTtl,
      });

      await refreshKeys();
    },
    [
      activeConnection,
      messages.app.status.notConnected,
      refreshKeys,
      selectedDb,
    ]
  );

  const selectKey = useCallback(
    async (key: RedisKey) => {
      if (!activeConnection) return;

      if (selectedKey?.key === key.key && keyValue?.key === key.key) {
        setPanelTab("editor");
        return;
      }

      await loadKeyValue(activeConnection, key, selectedDb);
    },
    [activeConnection, keyValue?.key, loadKeyValue, selectedDb, selectedKey?.key]
  );

  const renameKey = useCallback(
    async (key: RedisKey, nextKeyName: string) => {
      if (!activeConnection) {
        throw new Error(messages.app.status.notConnected);
      }

      if (!nextKeyName.length) {
        throw new Error("Key name cannot be empty");
      }

      if (nextKeyName === key.key) {
        return key;
      }

      await renameRedisKey(
        { ...activeConnection, db: selectedDb },
        key.key,
        nextKeyName
      );

      const renamedKey: RedisKey = {
        ...key,
        key: nextKeyName,
      };

      setKeys((previous) =>
        previous.map((item) => (item.key === key.key ? renamedKey : item))
      );

      setSelectedKey((previous) =>
        previous?.key === key.key ? renamedKey : previous
      );

      keyValueRequestRef.current += 1;
      setKeyValue((previous) =>
        previous?.key === key.key
          ? {
              ...previous,
              key: nextKeyName,
            }
          : previous
      );

      return renamedKey;
    },
    [activeConnection, messages.app.status.notConnected, selectedDb]
  );

  const renameGroup = useCallback(
    async (groupId: string, nextGroupId: string, separator: string) => {
      if (!activeConnection) {
        throw new Error(messages.app.status.notConnected);
      }

      if (!groupId.length || !nextGroupId.length) {
        throw new Error("Group name cannot be empty");
      }

      if (groupId === nextGroupId) {
        return [];
      }

      const groupPrefix = `${groupId}${separator}`;
      const renamedPairs = keys
        .filter((item) => item.key.startsWith(groupPrefix))
        .map((item) => ({
          oldKey: item.key,
          newKey: `${nextGroupId}${item.key.slice(groupId.length)}`,
        }));

      if (!renamedPairs.length) {
        return [];
      }

      await renameRedisKeys(
        { ...activeConnection, db: selectedDb },
        renamedPairs
      );

      const renamedMap = new Map(
        renamedPairs.map((item) => [item.oldKey, item.newKey])
      );

      setKeys((previous) =>
        previous.map((item) => {
          const nextKey = renamedMap.get(item.key);

          return nextKey ? { ...item, key: nextKey } : item;
        })
      );

      setSelectedKey((previous) => {
        if (!previous) return previous;

        const nextKey = renamedMap.get(previous.key);
        return nextKey ? { ...previous, key: nextKey } : previous;
      });

      keyValueRequestRef.current += 1;
      setKeyValue((previous) => {
        if (!previous) return previous;

        const nextKey = renamedMap.get(previous.key);
        return nextKey ? { ...previous, key: nextKey } : previous;
      });

      return renamedPairs;
    },
    [
      activeConnection,
      keys,
      messages.app.status.notConnected,
      selectedDb,
    ]
  );

  const updateHashEntry = useCallback(
    async (
      key: string,
      oldField: string,
      nextField: string,
      nextValue: string
    ) => {
      if (!activeConnection) {
        throw new Error(messages.app.status.notConnected);
      }

      if (!nextField.length) {
        throw new Error("Field cannot be empty");
      }

      if (oldField === nextField && keyValue?.type === "hash") {
        const currentEntries =
          keyValue.value &&
          typeof keyValue.value === "object" &&
          !Array.isArray(keyValue.value)
            ? (keyValue.value as Record<string, string>)
            : null;

        if (currentEntries?.[oldField] === nextValue) {
          return;
        }
      }

      await updateRedisHashEntry(
        { ...activeConnection, db: selectedDb },
        key,
        {
          oldField,
          newField: nextField,
          value: nextValue,
        }
      );
      void recordTelemetryEvent("editor.hash.update");
      void recordAuditEvent("editor.hash.update", {
        key,
      });

      setKeyValue((previous) => {
        if (
          !previous ||
          previous.key !== key ||
          previous.type !== "hash" ||
          !previous.value ||
          typeof previous.value !== "object" ||
          Array.isArray(previous.value)
        ) {
          return previous;
        }

        const nextEntries = Object.entries(previous.value as Record<string, string>)
          .map(([field, value]) =>
            field === oldField ? ([nextField, nextValue] as const) : ([field, value] as const)
          );

        return {
          ...previous,
          value: Object.fromEntries(nextEntries),
        };
      });
    },
    [
      activeConnection,
      keyValue?.type,
      keyValue?.value,
      messages.app.status.notConnected,
      selectedDb,
    ]
  );

  const updateStringValue = useCallback(
    async (key: string, nextValue: string) => {
      if (!activeConnection) {
        throw new Error(messages.app.status.notConnected);
      }

      if (
        keyValue?.key === key &&
        keyValue.type === "string" &&
        typeof keyValue.value === "string" &&
        keyValue.value === nextValue
      ) {
        return;
      }

      await updateRedisStringValue(
        { ...activeConnection, db: selectedDb },
        key,
        { value: nextValue }
      );
      void recordTelemetryEvent("editor.string.save");
      void recordAuditEvent("editor.string.save", {
        key,
      });

      setKeyValue((previous) => {
        if (
          !previous ||
          previous.key !== key ||
          previous.type !== "string" ||
          typeof previous.value !== "string"
        ) {
          return previous;
        }

        return {
          ...previous,
          value: nextValue,
        };
      });
    },
    [
      activeConnection,
      keyValue,
      messages.app.status.notConnected,
      selectedDb,
    ]
  );

  const updateJsonValue = useCallback(
    async (key: string, nextValue: string) => {
      if (!activeConnection) {
        throw new Error(messages.app.status.notConnected);
      }

      if (
        keyValue?.key === key &&
        keyValue.type === "json" &&
        typeof keyValue.value === "string" &&
        keyValue.value === nextValue
      ) {
        return;
      }

      await updateRedisJsonValue(
        { ...activeConnection, db: selectedDb },
        key,
        { value: nextValue }
      );
      void recordTelemetryEvent("editor.json.save");
      void recordAuditEvent("editor.json.save", {
        key,
      });

      setKeyValue((previous) => {
        if (
          !previous ||
          previous.key !== key ||
          previous.type !== "json" ||
          typeof previous.value !== "string"
        ) {
          return previous;
        }

        return {
          ...previous,
          value: nextValue,
        };
      });
    },
    [
      activeConnection,
      keyValue,
      messages.app.status.notConnected,
      selectedDb,
    ]
  );

  const deleteKey = useCallback(
    async (key: string) => {
      if (!activeConnection) {
        throw new Error(messages.app.status.notConnected);
      }

      if (!key.length) {
        throw new Error("Key name cannot be empty");
      }

      await runRedisCommand(
        { ...activeConnection, db: selectedDb },
        `DEL ${escapeRedisCommandArgument(key)}`
      );
      void recordTelemetryEvent("editor.key.delete");
      void recordAuditEvent("editor.key.delete", {
        key,
      });
      removeKeyFromState(key);
    },
    [
      activeConnection,
      messages.app.status.notConnected,
      removeKeyFromState,
      selectedDb,
    ]
  );

  const deleteHashEntry = useCallback(
    async (key: string, field: string) => {
      if (!activeConnection) {
        throw new Error(messages.app.status.notConnected);
      }

      if (!field.length) {
        throw new Error("Field cannot be empty");
      }

      await deleteRedisHashEntry(
        { ...activeConnection, db: selectedDb },
        key,
        { field }
      );
      void recordTelemetryEvent("editor.hash.delete");
      void recordAuditEvent("editor.hash.delete", {
        key,
      });

      setKeyValue((previous) => {
        if (
          !previous ||
          previous.key !== key ||
          previous.type !== "hash" ||
          !previous.value ||
          typeof previous.value !== "object" ||
          Array.isArray(previous.value)
        ) {
          return previous;
        }

        const nextEntries = Object.entries(previous.value as Record<string, string>).filter(
          ([entryField]) => entryField !== field
        );

        if (!nextEntries.length) {
          return null;
        }

        return {
          ...previous,
          value: Object.fromEntries(nextEntries),
        };
      });

      const currentEntries =
        keyValue?.key === key &&
        keyValue.type === "hash" &&
        keyValue.value &&
        typeof keyValue.value === "object" &&
        !Array.isArray(keyValue.value)
          ? (keyValue.value as Record<string, string>)
          : null;

      if (currentEntries && Object.keys(currentEntries).length <= 1) {
        removeKeyFromState(key);
      }
    },
    [
      activeConnection,
      keyValue,
      messages.app.status.notConnected,
      removeKeyFromState,
      selectedDb,
    ]
  );

  const updateZSetEntry = useCallback(
    async (
      key: string,
      oldMember: string,
      nextMember: string,
      nextScore: number
    ) => {
      if (!activeConnection) {
        throw new Error(messages.app.status.notConnected);
      }

      if (!nextMember.length) {
        throw new Error("Member cannot be empty");
      }

      if (!Number.isFinite(nextScore)) {
        throw new Error("Score must be a finite number");
      }

      if (keyValue?.type === "zset" && Array.isArray(keyValue.value)) {
        const currentMember = (keyValue.value as Array<{ member: string; score: number }>).find(
          (item) => item.member === oldMember
        );

        if (
          currentMember &&
          currentMember.member === nextMember &&
          currentMember.score === nextScore
        ) {
          return;
        }
      }

      await updateRedisZSetEntry(
        { ...activeConnection, db: selectedDb },
        key,
        {
          oldMember,
          newMember: nextMember,
          score: nextScore,
        }
      );
      void recordTelemetryEvent("editor.zset.update");
      void recordAuditEvent("editor.zset.update", {
        key,
      });

      setKeyValue((previous) => {
        if (
          !previous ||
          previous.key !== key ||
          previous.type !== "zset" ||
          !Array.isArray(previous.value)
        ) {
          return previous;
        }

        const nextMembers = (previous.value as Array<{ member: string; score: number }>)
          .map((item) =>
            item.member === oldMember
              ? {
                  member: nextMember,
                  score: nextScore,
                }
              : item
          )
          .sort((left, right) => {
            if (left.score === right.score) {
              return left.member.localeCompare(right.member);
            }

            return left.score - right.score;
          });

        return {
          ...previous,
          value: nextMembers,
        };
      });
    },
    [
      activeConnection,
      keyValue?.type,
      keyValue?.value,
      messages.app.status.notConnected,
      selectedDb,
    ]
  );

  const deleteZSetEntry = useCallback(
    async (key: string, member: string) => {
      if (!activeConnection) {
        throw new Error(messages.app.status.notConnected);
      }

      if (!member.length) {
        throw new Error("Member cannot be empty");
      }

      await deleteRedisZSetEntry(
        { ...activeConnection, db: selectedDb },
        key,
        { member }
      );
      void recordTelemetryEvent("editor.zset.delete");
      void recordAuditEvent("editor.zset.delete", {
        key,
      });

      setKeyValue((previous) => {
        if (
          !previous ||
          previous.key !== key ||
          previous.type !== "zset" ||
          !Array.isArray(previous.value)
        ) {
          return previous;
        }

        const nextMembers = (previous.value as Array<{ member: string; score: number }>).filter(
          (item) => item.member !== member
        );

        if (!nextMembers.length) {
          return null;
        }

        return {
          ...previous,
          value: nextMembers,
        };
      });

      const currentMembers =
        keyValue?.key === key && keyValue.type === "zset" && Array.isArray(keyValue.value)
          ? (keyValue.value as Array<{ member: string; score: number }>)
          : null;

      if (currentMembers && currentMembers.length <= 1) {
        removeKeyFromState(key);
      }
    },
    [
      activeConnection,
      keyValue,
      messages.app.status.notConnected,
      removeKeyFromState,
      selectedDb,
    ]
  );

  const sendChatMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();

      if (!trimmed || isAiResponding) {
        return;
      }

      const userMessage = createChatMessage("user", trimmed);
      const nextChatMessages = [...chatMessages, userMessage];

      setChatMessages(nextChatMessages);
      setIsAiResponding(true);

      try {
        const assistantResponse = await requestOpenAIAssistantResponse({
          settings: await loadAiSettings(),
          chatMessages: nextChatMessages,
          activeConnection,
          selectedDb,
          selectedKey,
          keyValue,
          keysCount: keys.length,
        });

        setChatMessages((previous) => [
          ...previous,
          createChatMessage(
            "assistant",
            assistantResponse.content,
            assistantResponse.command
          ),
        ]);
      } catch (error) {
        void recordCrashReport("ai.sendChatMessage", error);
        setChatMessages((previous) => [
          ...previous,
          createChatMessage("assistant", getRedisErrorMessage(error)),
        ]);
      } finally {
        setIsAiResponding(false);
      }
    },
    [
      activeConnection,
      chatMessages,
      isAiResponding,
      keyValue,
      keys.length,
      selectedDb,
      selectedKey,
    ]
  );

  const clearCliHistory = useCallback(() => {
    setCliHistory([]);
  }, []);

  const runCliCommand = useCallback(
    async (cmd: string) => {
      const trimmed = cmd.trim();

      if (!trimmed) return;

      const historyLimit = parsePositiveInt(appSettings.cli.historySize, 500);
      const timeoutMs = parsePositiveInt(appSettings.cli.timeout, 30) * 1000;
      const pipelineEnabled = appSettings.cli.pipelineMode;
      const commands =
        pipelineEnabled && trimmed.includes(";")
          ? trimmed
              .split(";")
              .map((part) => part.trim())
              .filter(Boolean)
          : [trimmed];

      const promptLabel = getCliPromptLabel(activeConnection, selectedDb);
      const appendCliEntry = (entry: CliEntry) => {
        setCliHistory((previous) => [...previous, entry].slice(-historyLimit));
      };

      const runWithTimeout = async <T,>(promise: Promise<T>) => {
        if (timeoutMs <= 0) {
          return promise;
        }

        return new Promise<T>((resolve, reject) => {
          const timer = window.setTimeout(() => {
            reject(new Error(`CLI command timed out after ${timeoutMs / 1000}s`));
          }, timeoutMs);

          void promise.then(
            (value) => {
              window.clearTimeout(timer);
              resolve(value);
            },
            (error) => {
              window.clearTimeout(timer);
              reject(error);
            }
          );
        });
      };

      for (const currentCommand of commands) {
        const commandName = getCliCommandName(currentCommand);
        void recordTelemetryEvent("cli.command");
        void recordAuditEvent("cli.command", {
          command: commandName,
          connection: activeConnection?.name ?? null,
          db: selectedDb,
        });

        if (commandName === "CLEAR") {
          clearCliHistory();
          continue;
        }

        appendCliEntry(createCliEntry("command", currentCommand, promptLabel));

        if (isBuiltinCliCommand(commandName)) {
          appendCliEntry(
            createCliEntry("output", getBuiltinCliOutput(commandName))
          );
          continue;
        }

        if (!activeConnection) {
          appendCliEntry(
            createCliEntry("error", messages.app.status.notConnected)
          );
          return;
        }

        try {
          const output = await runWithTimeout(
            runRedisCommand(
              { ...activeConnection, db: selectedDb },
              currentCommand
            )
          );

          appendCliEntry(createCliEntry("output", output));

          if (commandName === "SELECT") {
            const nextDb = Number(currentCommand.trim().split(/\s+/)[1]);

            if (Number.isInteger(nextDb) && nextDb >= 0) {
              void selectDb(nextDb);
              continue;
            }
          }

          syncConnectionStatus(activeConnection.id, "connected", selectedDb);

          if (!isReadOnlyRedisCommand(commandName)) {
            void refreshKeys();
          }
        } catch (error) {
          void recordCrashReport(`cli.${commandName.toLowerCase()}`, error);
          appendCliEntry(
            createCliEntry("error", getRedisErrorMessage(error))
          );
          syncConnectionStatus(activeConnection.id, "error", selectedDb);
        }
      }
    },
    [
      activeConnection,
      appSettings.cli.historySize,
      appSettings.cli.pipelineMode,
      appSettings.cli.timeout,
      clearCliHistory,
      messages.app.status.notConnected,
      refreshKeys,
      selectDb,
      selectedDb,
      syncConnectionStatus,
    ]
  );

  return {
    connections,
    activeConnectionId,
    activeConnection,
    appSettings,
    editingConnection,
    selectConnection,
    selectedDb,
    selectDb,
    keys,
    isLoadingKeys,
    refreshKeys,
    refreshKeyValue,
    selectedKey,
    selectKey,
    renameKey,
    renameGroup,
    updateStringValue,
    deleteKey,
    updateKeyTtl,
    updateJsonValue,
    updateHashEntry,
    deleteHashEntry,
    updateZSetEntry,
    deleteZSetEntry,
    keyValue,
    searchQuery,
    setSearchQuery,
    keySeparator,
    setKeySeparator: (value: string) => {
      setKeySeparatorState(value);

      if (hasHydratedPreferencesRef.current) {
        void updateAppSettings((current) => ({
          ...current,
          general: {
            ...current.general,
            keySeparator: value,
          },
        }));
      }
    },
    panelTab,
    setPanelTab,
    chatMessages,
    isAiResponding,
    sendChatMessage,
    cliHistory,
    clearCliHistory,
    runCliCommand,
    showConnectionModal,
    openNewConnectionModal,
    openEditConnectionModal,
    closeConnectionModal,
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    toggleSidebarCollapsed,
    saveConnection,
    disconnectConnection,
    deleteConnection,
  };
}
