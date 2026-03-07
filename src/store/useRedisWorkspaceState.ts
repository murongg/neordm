import { useCallback, useEffect, useRef, useState } from "react";
import type { AppSettings } from "../lib/appSettings";
import {
  loadStoredConnections,
  persistConnections,
} from "../lib/connectionStore";
import {
  getRedisErrorMessage,
  getRedisKeyValue,
  listRedisKeys,
  renameRedisKey,
  renameRedisKeys,
  testRedisConnection,
} from "../lib/redis";
import {
  recordAuditEvent,
  recordTelemetryEvent,
} from "../lib/privacyRuntime";
import type {
  KeyValue,
  PanelTab,
  RedisConnection,
  RedisKey,
} from "../types";

function parsePositiveInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

interface UseRedisWorkspaceStateOptions {
  appSettings: AppSettings;
  hasHydratedSettings: boolean;
  notConnectedMessage: string;
  persistLastConnectionId: (nextConnectionId: string) => void;
}

export function useRedisWorkspaceState({
  appSettings,
  hasHydratedSettings,
  notConnectedMessage,
  persistLastConnectionId,
}: UseRedisWorkspaceStateOptions) {
  const [connections, setConnections] = useState<RedisConnection[]>([]);
  const [activeConnectionId, setActiveConnectionId] = useState<string>("");
  const [selectedDb, setSelectedDb] = useState<number>(0);
  const [keys, setKeys] = useState<RedisKey[]>([]);
  const [selectedKey, setSelectedKey] = useState<RedisKey | null>(null);
  const [keyValue, setKeyValue] = useState<KeyValue | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [panelTab, setPanelTab] = useState<PanelTab>("editor");
  const [showConnectionModal, setShowConnectionModal] = useState(false);
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(
    null
  );
  const [isLoadingKeys, setIsLoadingKeys] = useState(false);
  const [hasHydratedConnections, setHasHydratedConnections] = useState(false);

  const keysRequestRef = useRef(0);
  const keyValueRequestRef = useRef(0);
  const hasAttemptedAutoConnectRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    void loadStoredConnections()
      .then((storedConnections) => {
        if (!isMounted) {
          return;
        }

        setConnections(storedConnections);
      })
      .catch((error) => {
        console.error("Failed to load persisted connections", error);
      })
      .finally(() => {
        if (!isMounted) {
          return;
        }

        setHasHydratedConnections(true);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hasHydratedConnections) {
      return;
    }

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

  const updateConnection = useCallback(
    (
      connectionId: string,
      updater: (connection: RedisConnection) => RedisConnection
    ) => {
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
        const value = await getRedisKeyValue({ ...connection, db }, key.key);

        if (requestId !== keyValueRequestRef.current) {
          return;
        }

        setKeyValue(value);
      } catch (error) {
        if (requestId !== keyValueRequestRef.current) {
          return;
        }

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

        if (requestId !== keysRequestRef.current) {
          return;
        }

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
        if (requestId !== keysRequestRef.current) {
          return;
        }

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

    if (
      !appSettings.general.autoConnect ||
      activeConnectionId ||
      !connections.length
    ) {
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

      if (!connection) {
        return;
      }

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

      if (!currentConnection) {
        return;
      }

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

      if (!deletedConnection) {
        return;
      }

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

      if (activeConnectionId !== connectionId) {
        return;
      }

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

      if (activeConnectionId !== connectionId) {
        return;
      }

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
      if (!activeConnection) {
        return;
      }

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
    if (!activeConnection) {
      return;
    }

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

  const selectKey = useCallback(
    async (key: RedisKey) => {
      if (!activeConnection) {
        return;
      }

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
        throw new Error(notConnectedMessage);
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
    [activeConnection, notConnectedMessage, selectedDb]
  );

  const renameGroup = useCallback(
    async (groupId: string, nextGroupId: string, separator: string) => {
      if (!activeConnection) {
        throw new Error(notConnectedMessage);
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
        if (!previous) {
          return previous;
        }

        const nextKey = renamedMap.get(previous.key);
        return nextKey ? { ...previous, key: nextKey } : previous;
      });

      keyValueRequestRef.current += 1;
      setKeyValue((previous) => {
        if (!previous) {
          return previous;
        }

        const nextKey = renamedMap.get(previous.key);
        return nextKey ? { ...previous, key: nextKey } : previous;
      });

      return renamedPairs;
    },
    [activeConnection, keys, notConnectedMessage, selectedDb]
  );

  return {
    activeConnection,
    activeConnectionId,
    closeConnectionModal,
    connections,
    deleteConnection,
    disconnectConnection,
    editingConnection,
    isLoadingKeys,
    keyValue,
    keys,
    loadKeys,
    openEditConnectionModal,
    openNewConnectionModal,
    panelTab,
    refreshKeys,
    refreshKeyValue,
    removeKeyFromState,
    renameGroup,
    renameKey,
    saveConnection,
    searchQuery,
    selectConnection,
    selectDb,
    selectedDb,
    selectedKey,
    selectKey,
    setKeyValue,
    setPanelTab,
    setSearchQuery,
    showConnectionModal,
    syncConnectionStatus,
  };
}
