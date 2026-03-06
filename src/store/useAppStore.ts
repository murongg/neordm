import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
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
  runRedisCommand,
  testRedisConnection,
} from "../lib/redis";
import type {
  RedisConnection,
  RedisKey,
  KeyValue,
  PanelTab,
  ChatMessage,
  CliEntry,
} from "../types";

const READ_ONLY_COMMANDS = new Set([
  "DBSIZE",
  "EXISTS",
  "GET",
  "HGET",
  "HGETALL",
  "INFO",
  "KEYS",
  "LLEN",
  "LRANGE",
  "MGET",
  "PING",
  "PTTL",
  "SCAN",
  "SCARD",
  "SMEMBERS",
  "TTL",
  "TYPE",
  "XRANGE",
  "ZCARD",
  "ZRANGE",
  "ZRANK",
  "ZSCORE",
]);

const KEY_SEPARATOR_STORAGE_KEY = "neordm-key-separator";

function createCliEntry(
  type: CliEntry["type"],
  content: string
): CliEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    content,
    timestamp: new Date(),
  };
}

function getCommandName(command: string) {
  return command.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
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
  const [keySeparator, setKeySeparator] = useState<string>(() => {
    const savedValue = localStorage.getItem(KEY_SEPARATOR_STORAGE_KEY);
    return savedValue === null ? ":" : savedValue;
  });
  const [panelTab, setPanelTab] = useState<PanelTab>("editor");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [cliHistory, setCliHistory] = useState<CliEntry[]>([]);
  const [showConnectionModal, setShowConnectionModal] = useState(false);
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(
    null
  );
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isLoadingKeys, setIsLoadingKeys] = useState(false);
  const [hasHydratedConnections, setHasHydratedConnections] = useState(false);

  const keysRequestRef = useRef(0);
  const keyValueRequestRef = useRef(0);

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

    void persistConnections(connections).catch((error) => {
      console.error("Failed to persist connections", error);
    });
  }, [connections, hasHydratedConnections]);

  const activeConnection =
    connections.find((connection) => connection.id === activeConnectionId) ??
    undefined;
  const editingConnection =
    connections.find((connection) => connection.id === editingConnectionId) ??
    null;

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

  const loadKeyValue = useCallback(
    async (connection: RedisConnection, key: RedisKey, db: number) => {
      const requestId = ++keyValueRequestRef.current;

      setSelectedKey(key);
      setPanelTab("editor");
      setKeyValue(null);

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
        const nextKeys = await listRedisKeys({ ...connection, db });

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
    [loadKeyValue, selectedKey, syncConnectionStatus]
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

      try {
        await loadKeys(connection, connection.db);
      } catch {}
    },
    [connections, loadKeys]
  );

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
    [activeConnectionId, connections, editingConnectionId, loadKeys]
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

      if (editingConnectionId === connectionId) {
        closeConnectionModal();
      }

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
        return;
      }

      setActiveConnectionId(nextConnection.id);
      setSelectedDb(nextConnection.db);
      void loadKeys(nextConnection, nextConnection.db).catch(() => {});
    },
    [activeConnectionId, closeConnectionModal, editingConnectionId, loadKeys]
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

  const sendChatMessage = useCallback((content: string) => {
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content,
      timestamp: new Date(),
    };

    setChatMessages((previous) => [...previous, userMessage]);
  }, []);

  const runCliCommand = useCallback(
    async (cmd: string) => {
      const trimmed = cmd.trim();

      if (!trimmed) return;

      setCliHistory((previous) => [
        ...previous,
        createCliEntry("command", trimmed),
      ]);

      if (!activeConnection) {
        setCliHistory((previous) => [
          ...previous,
          createCliEntry("error", messages.app.status.notConnected),
        ]);
        return;
      }

      try {
        const output = await runRedisCommand(
          { ...activeConnection, db: selectedDb },
          trimmed
        );

        setCliHistory((previous) => [
          ...previous,
          createCliEntry("output", output),
        ]);

        const commandName = getCommandName(trimmed);

        if (commandName === "SELECT") {
          const nextDb = Number(trimmed.trim().split(/\s+/)[1]);

          if (Number.isInteger(nextDb) && nextDb >= 0) {
            void selectDb(nextDb);
            return;
          }
        }

        if (!READ_ONLY_COMMANDS.has(commandName)) {
          void refreshKeys();
        }
      } catch (error) {
        setCliHistory((previous) => [
          ...previous,
          createCliEntry("error", getRedisErrorMessage(error)),
        ]);
        syncConnectionStatus(activeConnection.id, "error", selectedDb);
      }
    },
    [
      activeConnection,
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
    editingConnection,
    selectConnection,
    selectedDb,
    selectDb,
    keys,
    isLoadingKeys,
    refreshKeys,
    selectedKey,
    selectKey,
    renameKey,
    renameGroup,
    keyValue,
    searchQuery,
    setSearchQuery,
    keySeparator,
    setKeySeparator: (value: string) => {
      setKeySeparator(value);
      localStorage.setItem(KEY_SEPARATOR_STORAGE_KEY, value);
    },
    panelTab,
    setPanelTab,
    chatMessages,
    sendChatMessage,
    cliHistory,
    runCliCommand,
    showConnectionModal,
    openNewConnectionModal,
    openEditConnectionModal,
    closeConnectionModal,
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    saveConnection,
    disconnectConnection,
    deleteConnection,
  };
}
