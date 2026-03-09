import {
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
} from "../lib/appSettings";
import {
  loadStoredConnections,
  persistConnections,
} from "../lib/connectionStore";
import {
  createRedisKey,
  deleteRedisKey,
  deleteRedisKeys,
  getRedisErrorMessage,
  getRedisKeyValue,
  listRedisKeys,
  renameRedisKey,
  renameRedisKeys,
  testRedisConnection,
  type RedisKeyCreateInput,
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

function insertRedisKey(keys: RedisKey[], nextKey: RedisKey) {
  const nextKeys = [...keys.filter((item) => item.key !== nextKey.key), nextKey];
  nextKeys.sort((left, right) => left.key.localeCompare(right.key));
  return nextKeys;
}

interface UseRedisWorkspaceStateOptions {
  appSettings: AppSettings;
  hasHydratedSettings: boolean;
  notConnectedMessage: string;
  persistLastConnectionId: (nextConnectionId: string) => void;
}

interface LoadKeyValueOptions {
  preserveValue?: boolean;
}

interface LoadKeysOptions {
  preserveSelection?: boolean;
}

type SetKeyValueAction = SetStateAction<KeyValue | null>;

interface RedisWorkspaceRuntime {
  appSettings: AppSettings;
  hasHydratedSettings: boolean;
  notConnectedMessage: string;
  persistLastConnectionId: (nextConnectionId: string) => void;
}

interface RedisWorkspaceStoreState {
  connections: RedisConnection[];
  activeConnectionId: string;
  selectedDb: number;
  keys: RedisKey[];
  selectedKey: RedisKey | null;
  keyValue: KeyValue | null;
  searchQuery: string;
  panelTab: PanelTab;
  showConnectionModal: boolean;
  editingConnectionId: string | null;
  isLoadingKeys: boolean;
  hasHydratedConnections: boolean;
  hydrateConnections: (connections: RedisConnection[]) => void;
  markConnectionsHydrated: () => void;
  setKeyValue: Dispatch<SetStateAction<KeyValue | null>>;
  setPanelTab: (tab: PanelTab) => void;
  setSearchQuery: (query: string) => void;
  updateConnection: (
    connectionId: string,
    updater: (connection: RedisConnection) => RedisConnection
  ) => void;
  syncConnectionStatus: (
    connectionId: string,
    status: RedisConnection["status"],
    db?: number
  ) => void;
  removeKeyFromState: (key: string) => void;
  loadKeyValue: (
    connection: RedisConnection,
    key: RedisKey,
    db: number,
    options?: LoadKeyValueOptions
  ) => Promise<void>;
  loadKeys: (
    connection: RedisConnection,
    db: number,
    options?: LoadKeysOptions
  ) => Promise<void>;
  selectConnection: (connectionId: string) => Promise<void>;
  openNewConnectionModal: () => void;
  openEditConnectionModal: (connectionId: string) => void;
  closeConnectionModal: () => void;
  saveConnection: (
    connection: Omit<RedisConnection, "id" | "status">
  ) => Promise<void>;
  deleteConnection: (connectionId: string) => void;
  disconnectConnection: (connectionId: string) => void;
  selectDb: (db: number) => Promise<void>;
  refreshKeys: () => Promise<void>;
  refreshKeyValue: () => Promise<void>;
  selectKey: (key: RedisKey) => Promise<void>;
  createKey: (input: RedisKeyCreateInput) => Promise<RedisKey>;
  deleteKey: (key: RedisKey) => Promise<void>;
  deleteGroup: (groupId: string, separator: string) => Promise<number>;
  renameKey: (key: RedisKey, nextKeyName: string) => Promise<RedisKey>;
  renameGroup: (
    groupId: string,
    nextGroupId: string,
    separator: string
  ) => Promise<Array<{ oldKey: string; newKey: string }>>;
}

const defaultWorkspaceRuntime: RedisWorkspaceRuntime = {
  appSettings: DEFAULT_APP_SETTINGS,
  hasHydratedSettings: false,
  notConnectedMessage: "Not connected",
  persistLastConnectionId: () => undefined,
};

let workspaceRuntime = defaultWorkspaceRuntime;
let keysRequestId = 0;
let keyValueRequestId = 0;
let hasAttemptedAutoConnect = false;
let hasInitializedRedisWorkspaceStore = false;

function getWorkspaceRuntime() {
  return workspaceRuntime;
}

function getActiveConnectionFromState(
  state: Pick<RedisWorkspaceStoreState, "connections" | "activeConnectionId">
) {
  return state.connections.find(
    (connection) => connection.id === state.activeConnectionId
  );
}

function getEditingConnectionFromState(
  state: Pick<RedisWorkspaceStoreState, "connections" | "editingConnectionId">
) {
  return (
    state.connections.find(
      (connection) => connection.id === state.editingConnectionId
    ) ?? null
  );
}

function resolveNextKeyValue(
  currentValue: KeyValue | null,
  nextValue: SetKeyValueAction
) {
  return typeof nextValue === "function"
    ? (nextValue as (previous: KeyValue | null) => KeyValue | null)(currentValue)
    : nextValue;
}

export const useRedisWorkspaceStore = create<RedisWorkspaceStoreState>(
  (set, get) => ({
    connections: [],
    activeConnectionId: "",
    selectedDb: 0,
    keys: [],
    selectedKey: null,
    keyValue: null,
    searchQuery: "",
    panelTab: "editor",
    showConnectionModal: false,
    editingConnectionId: null,
    isLoadingKeys: false,
    hasHydratedConnections: false,
    hydrateConnections: (connections) => {
      set({
        connections,
        hasHydratedConnections: true,
      });
    },
    markConnectionsHydrated: () => {
      set({
        hasHydratedConnections: true,
      });
    },
    setKeyValue: (nextValue) => {
      set((state) => ({
        keyValue: resolveNextKeyValue(state.keyValue, nextValue),
      }));
    },
    setPanelTab: (panelTab) => {
      set({ panelTab });
    },
    setSearchQuery: (searchQuery) => {
      set({ searchQuery });
    },
    updateConnection: (connectionId, updater) => {
      set((state) => ({
        connections: state.connections.map((connection) =>
          connection.id === connectionId ? updater(connection) : connection
        ),
      }));
    },
    syncConnectionStatus: (connectionId, status, db) => {
      get().updateConnection(connectionId, (connection) => ({
        ...connection,
        status,
        db: db ?? connection.db,
      }));
    },
    removeKeyFromState: (key) => {
      keyValueRequestId += 1;
      set((state) => ({
        keys: state.keys.filter((item) => item.key !== key),
        selectedKey: state.selectedKey?.key === key ? null : state.selectedKey,
        keyValue: state.keyValue?.key === key ? null : state.keyValue,
      }));
    },
    loadKeyValue: async (connection, key, db, options = {}) => {
      const requestId = ++keyValueRequestId;

      set((state) => ({
        selectedKey: key,
        panelTab: "editor",
        keyValue: options.preserveValue ? state.keyValue : null,
      }));

      try {
        const value = await getRedisKeyValue({ ...connection, db }, key.key);

        if (requestId !== keyValueRequestId) {
          return;
        }

        set({ keyValue: value });
      } catch (error) {
        if (requestId !== keyValueRequestId) {
          return;
        }

        set({
          keyValue: {
            key: key.key,
            type: "string",
            ttl: key.ttl,
            value: getRedisErrorMessage(error),
          },
        });
      }
    },
    loadKeys: async (connection, db, options = {}) => {
      const requestId = ++keysRequestId;
      const { selectedKey, syncConnectionStatus } = get();
      const currentSelectedKey = options.preserveSelection ? selectedKey : null;
      const { appSettings } = getWorkspaceRuntime();

      set({ isLoadingKeys: true });
      syncConnectionStatus(connection.id, "connecting", db);

      if (!options.preserveSelection) {
        keyValueRequestId += 1;
        set({
          selectedKey: null,
          keyValue: null,
        });
      }

      try {
        const nextKeys = await listRedisKeys(
          { ...connection, db },
          {
            maxKeys: parsePositiveInt(appSettings.general.maxKeys, 10_000),
            scanCount: parsePositiveInt(appSettings.general.scanCount, 200),
          }
        );

        if (requestId !== keysRequestId) {
          return;
        }

        set({
          keys: nextKeys,
          selectedDb: db,
        });
        syncConnectionStatus(connection.id, "connected", db);

        if (currentSelectedKey) {
          const refreshedSelectedKey =
            nextKeys.find((item) => item.key === currentSelectedKey.key) ?? null;

          if (!refreshedSelectedKey) {
            set({
              selectedKey: null,
              keyValue: null,
            });
          } else {
            await get().loadKeyValue(connection, refreshedSelectedKey, db);
          }
        }
      } catch (error) {
        if (requestId !== keysRequestId) {
          return;
        }

        set({
          keys: [],
          selectedKey: null,
          keyValue: null,
        });
        syncConnectionStatus(connection.id, "error", db);
        throw error;
      } finally {
        if (requestId === keysRequestId) {
          set({ isLoadingKeys: false });
        }
      }
    },
    selectConnection: async (connectionId) => {
      const connection = get().connections.find((item) => item.id === connectionId);

      set({
        activeConnectionId: connectionId,
        searchQuery: "",
      });

      if (!connection) {
        keyValueRequestId += 1;
        set({
          selectedDb: 0,
          keys: [],
          selectedKey: null,
          keyValue: null,
        });
        return;
      }

      set({ selectedDb: connection.db });
      getWorkspaceRuntime().persistLastConnectionId(connection.id);

      try {
        await get().loadKeys(connection, connection.db);
      } catch {
        return;
      }
    },
    openNewConnectionModal: () => {
      set({
        editingConnectionId: null,
        showConnectionModal: true,
      });
    },
    openEditConnectionModal: (connectionId) => {
      const connection = get().connections.find((item) => item.id === connectionId);

      if (!connection) {
        return;
      }

      set({
        editingConnectionId: connectionId,
        showConnectionModal: true,
      });
    },
    closeConnectionModal: () => {
      set({
        showConnectionModal: false,
        editingConnectionId: null,
      });
    },
    saveConnection: async (connection) => {
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

      const {
        activeConnectionId,
        editingConnectionId,
        connections,
        loadKeys,
      } = get();
      const { persistLastConnectionId } = getWorkspaceRuntime();

      if (!editingConnectionId) {
        const newConnection: RedisConnection = {
          ...normalizedConnection,
          id: Date.now().toString(),
          status: "connecting",
          color: connection.color,
        };

        set((state) => ({
          connections: [...state.connections, newConnection],
          activeConnectionId: newConnection.id,
          selectedDb: newConnection.db,
          searchQuery: "",
          selectedKey: null,
          keyValue: null,
        }));
        persistLastConnectionId(newConnection.id);
        void loadKeys(newConnection, newConnection.db).catch(() => undefined);
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

      set((state) => ({
        connections: state.connections.map((item) =>
          item.id === editingConnectionId ? updatedConnection : item
        ),
      }));

      if (activeConnectionId === editingConnectionId) {
        set({
          selectedDb: updatedConnection.db,
          searchQuery: "",
        });
        void loadKeys(updatedConnection, updatedConnection.db).catch(() => undefined);
      }
    },
    deleteConnection: (connectionId) => {
      const {
        activeConnectionId,
        editingConnectionId,
        closeConnectionModal,
        loadKeys,
      } = get();
      const { appSettings, persistLastConnectionId } = getWorkspaceRuntime();
      const previousConnections = get().connections;
      const deletedConnection = previousConnections.find(
        (item) => item.id === connectionId
      );
      const nextConnections = previousConnections.filter(
        (item) => item.id !== connectionId
      );

      if (!deletedConnection) {
        return;
      }

      set({ connections: nextConnections });

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

      keyValueRequestId += 1;
      set({
        searchQuery: "",
        selectedKey: null,
        keyValue: null,
        keys: [],
      });

      const nextConnection = nextConnections[0];

      if (!nextConnection) {
        keysRequestId += 1;
        set({
          isLoadingKeys: false,
          activeConnectionId: "",
          selectedDb: 0,
        });
        persistLastConnectionId("");
        return;
      }

      set({
        activeConnectionId: nextConnection.id,
        selectedDb: nextConnection.db,
      });
      persistLastConnectionId(nextConnection.id);
      void loadKeys(nextConnection, nextConnection.db).catch(() => undefined);
    },
    disconnectConnection: (connectionId) => {
      const { activeConnectionId, updateConnection } = get();

      updateConnection(connectionId, (connection) => ({
        ...connection,
        status: "disconnected",
      }));

      if (activeConnectionId !== connectionId) {
        return;
      }

      keysRequestId += 1;
      keyValueRequestId += 1;

      set({
        isLoadingKeys: false,
        activeConnectionId: "",
        selectedDb: 0,
        searchQuery: "",
        keys: [],
        selectedKey: null,
        keyValue: null,
      });
    },
    selectDb: async (db) => {
      const { activeConnection, loadKeys, updateConnection } = {
        activeConnection: getActiveConnectionFromState(get()),
        loadKeys: get().loadKeys,
        updateConnection: get().updateConnection,
      };

      if (!activeConnection) {
        return;
      }

      set({
        selectedDb: db,
        searchQuery: "",
      });
      updateConnection(activeConnection.id, (connection) => ({
        ...connection,
        db,
      }));

      try {
        await loadKeys({ ...activeConnection, db }, db);
      } catch {
        return;
      }
    },
    refreshKeys: async () => {
      const state = get();
      const activeConnection = getActiveConnectionFromState(state);

      if (!activeConnection) {
        return;
      }

      try {
        await state.loadKeys(activeConnection, state.selectedDb, {
          preserveSelection: true,
        });
      } catch {
        return;
      }
    },
    refreshKeyValue: async () => {
      const state = get();
      const activeConnection = getActiveConnectionFromState(state);

      if (!activeConnection || !state.selectedKey) {
        return;
      }

      await state.loadKeyValue(
        activeConnection,
        state.selectedKey,
        state.selectedDb,
        {
          preserveValue: true,
        }
      );
    },
    selectKey: async (key) => {
      const state = get();
      const activeConnection = getActiveConnectionFromState(state);

      if (!activeConnection) {
        return;
      }

      if (
        state.selectedKey?.key === key.key &&
        state.keyValue?.key === key.key
      ) {
        set({ panelTab: "editor" });
        return;
      }

      await state.loadKeyValue(activeConnection, key, state.selectedDb);
    },
    createKey: async (input) => {
      const state = get();
      const activeConnection = getActiveConnectionFromState(state);
      const { notConnectedMessage } = getWorkspaceRuntime();
      const nextKeyName = input.key.trim();

      if (!activeConnection) {
        throw new Error(notConnectedMessage);
      }

      if (!nextKeyName.length) {
        throw new Error("Key name cannot be empty");
      }

      if (state.keys.some((item) => item.key === nextKeyName)) {
        throw new Error("Key already exists");
      }

      const createdKey = await createRedisKey(
        { ...activeConnection, db: state.selectedDb },
        {
          ...input,
          key: nextKeyName,
        }
      );

      const normalizedSearchQuery = state.searchQuery
        .replace(/\*/g, "")
        .trim()
        .toLowerCase();
      const shouldClearSearch =
        normalizedSearchQuery.length > 0 &&
        !createdKey.key.toLowerCase().includes(normalizedSearchQuery);

      set((currentState) => ({
        keys: insertRedisKey(currentState.keys, createdKey),
        searchQuery: shouldClearSearch ? "" : currentState.searchQuery,
      }));

      await state.loadKeyValue(activeConnection, createdKey, state.selectedDb);

      return createdKey;
    },
    deleteKey: async (key) => {
      const state = get();
      const activeConnection = getActiveConnectionFromState(state);

      if (!activeConnection) {
        throw new Error(getWorkspaceRuntime().notConnectedMessage);
      }

      if (!key.key.length) {
        throw new Error("Key name cannot be empty");
      }

      await deleteRedisKey(
        { ...activeConnection, db: state.selectedDb },
        key.key
      );

      void recordTelemetryEvent("workspace.key.delete");
      void recordAuditEvent("workspace.key.delete", {
        key: key.key,
      });

      get().removeKeyFromState(key.key);
    },
    deleteGroup: async (groupId, separator) => {
      const state = get();
      const activeConnection = getActiveConnectionFromState(state);

      if (!activeConnection) {
        throw new Error(getWorkspaceRuntime().notConnectedMessage);
      }

      if (!groupId.length || !separator.length) {
        throw new Error("Group name cannot be empty");
      }

      const groupPrefix = `${groupId}${separator}`;
      const keysToDelete = state.keys
        .filter((item) => item.key.startsWith(groupPrefix))
        .map((item) => item.key);

      if (!keysToDelete.length) {
        return 0;
      }

      await deleteRedisKeys(
        { ...activeConnection, db: state.selectedDb },
        keysToDelete
      );

      const deletedKeys = new Set(keysToDelete);
      keyValueRequestId += 1;

      set((currentState) => ({
        keys: currentState.keys.filter((item) => !deletedKeys.has(item.key)),
        selectedKey:
          currentState.selectedKey &&
          deletedKeys.has(currentState.selectedKey.key)
            ? null
            : currentState.selectedKey,
        keyValue:
          currentState.keyValue && deletedKeys.has(currentState.keyValue.key)
            ? null
            : currentState.keyValue,
      }));

      void recordTelemetryEvent("workspace.group.delete");
      void recordAuditEvent("workspace.group.delete", {
        groupId,
        keyCount: keysToDelete.length,
      });

      return keysToDelete.length;
    },
    renameKey: async (key, nextKeyName) => {
      const state = get();
      const activeConnection = getActiveConnectionFromState(state);
      const { notConnectedMessage } = getWorkspaceRuntime();

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
        { ...activeConnection, db: state.selectedDb },
        key.key,
        nextKeyName
      );

      const renamedKey: RedisKey = {
        ...key,
        key: nextKeyName,
      };

      keyValueRequestId += 1;
      set((currentState) => ({
        keys: currentState.keys.map((item) =>
          item.key === key.key ? renamedKey : item
        ),
        selectedKey:
          currentState.selectedKey?.key === key.key
            ? renamedKey
            : currentState.selectedKey,
        keyValue:
          currentState.keyValue?.key === key.key
            ? {
                ...currentState.keyValue,
                key: nextKeyName,
              }
            : currentState.keyValue,
      }));

      return renamedKey;
    },
    renameGroup: async (groupId, nextGroupId, separator) => {
      const state = get();
      const activeConnection = getActiveConnectionFromState(state);
      const { notConnectedMessage } = getWorkspaceRuntime();

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
      const renamedPairs = state.keys
        .filter((item) => item.key.startsWith(groupPrefix))
        .map((item) => ({
          oldKey: item.key,
          newKey: `${nextGroupId}${item.key.slice(groupId.length)}`,
        }));

      if (!renamedPairs.length) {
        return [];
      }

      await renameRedisKeys(
        { ...activeConnection, db: state.selectedDb },
        renamedPairs
      );

      const renamedMap = new Map(
        renamedPairs.map((item) => [item.oldKey, item.newKey])
      );

      keyValueRequestId += 1;
      set((currentState) => ({
        keys: currentState.keys.map((item) => {
          const nextKey = renamedMap.get(item.key);
          return nextKey ? { ...item, key: nextKey } : item;
        }),
        selectedKey: currentState.selectedKey
          ? (() => {
              const nextKey = renamedMap.get(currentState.selectedKey.key);
              return nextKey
                ? {
                    ...currentState.selectedKey,
                    key: nextKey,
                  }
                : currentState.selectedKey;
            })()
          : currentState.selectedKey,
        keyValue: currentState.keyValue
          ? (() => {
              const nextKey = renamedMap.get(currentState.keyValue.key);
              return nextKey
                ? {
                    ...currentState.keyValue,
                    key: nextKey,
                  }
                : currentState.keyValue;
            })()
          : currentState.keyValue,
      }));

      return renamedPairs;
    },
  })
);

function initializeRedisWorkspaceStore() {
  if (hasInitializedRedisWorkspaceStore) {
    return;
  }

  hasInitializedRedisWorkspaceStore = true;

  void loadStoredConnections()
    .then((storedConnections) => {
      useRedisWorkspaceStore.getState().hydrateConnections(storedConnections);
    })
    .catch((error) => {
      console.error("Failed to load persisted connections", error);
      useRedisWorkspaceStore.getState().markConnectionsHydrated();
    });
}

export function useInitializeRedisWorkspaceState(
  options: UseRedisWorkspaceStateOptions
) {
  workspaceRuntime = options;

  const initializationState = useRedisWorkspaceStore(
    useShallow((state) => ({
      activeConnectionId: state.activeConnectionId,
      connections: state.connections,
      hasHydratedConnections: state.hasHydratedConnections,
      selectConnection: state.selectConnection,
    }))
  );

  useEffect(() => {
    initializeRedisWorkspaceStore();
  }, []);

  useEffect(() => {
    if (!initializationState.hasHydratedConnections) {
      return;
    }

    void persistConnections(initializationState.connections, {
      savePasswords: options.appSettings.privacy.savePasswords,
    }).catch((error) => {
      console.error("Failed to persist connections", error);
    });
  }, [
    options.appSettings.privacy.savePasswords,
    initializationState.connections,
    initializationState.hasHydratedConnections,
  ]);

  useEffect(() => {
    if (
      !initializationState.hasHydratedConnections ||
      !options.hasHydratedSettings ||
      hasAttemptedAutoConnect
    ) {
      return;
    }

    hasAttemptedAutoConnect = true;

    if (
      !options.appSettings.general.autoConnect ||
      initializationState.activeConnectionId ||
      !initializationState.connections.length
    ) {
      return;
    }

    const preferredConnection =
      initializationState.connections.find(
        (connection) => connection.id === options.appSettings.ui.lastConnectionId
      ) ?? initializationState.connections[0];

    void initializationState.selectConnection(preferredConnection.id).catch(
      () => undefined
    );
  }, [
    options.appSettings.general.autoConnect,
    options.appSettings.ui.lastConnectionId,
    options.hasHydratedSettings,
    initializationState.activeConnectionId,
    initializationState.connections,
    initializationState.hasHydratedConnections,
    initializationState.selectConnection,
  ]);

  useEffect(() => {
    if (!options.hasHydratedSettings || !initializationState.activeConnectionId) {
      return;
    }

    options.persistLastConnectionId(initializationState.activeConnectionId);
  }, [
    options.hasHydratedSettings,
    options.persistLastConnectionId,
    initializationState.activeConnectionId,
  ]);
}

export function useRedisWorkspaceState(options: UseRedisWorkspaceStateOptions) {
  useInitializeRedisWorkspaceState(options);

  const storeSlice = useRedisWorkspaceStore(
    useShallow((state) => ({
      activeConnectionId: state.activeConnectionId,
      closeConnectionModal: state.closeConnectionModal,
      connections: state.connections,
      deleteConnection: state.deleteConnection,
      disconnectConnection: state.disconnectConnection,
      isLoadingKeys: state.isLoadingKeys,
      keyValue: state.keyValue,
      keys: state.keys,
      loadKeys: state.loadKeys,
      openEditConnectionModal: state.openEditConnectionModal,
      openNewConnectionModal: state.openNewConnectionModal,
      panelTab: state.panelTab,
      createKey: state.createKey,
      deleteKey: state.deleteKey,
      deleteGroup: state.deleteGroup,
      refreshKeys: state.refreshKeys,
      refreshKeyValue: state.refreshKeyValue,
      removeKeyFromState: state.removeKeyFromState,
      renameGroup: state.renameGroup,
      renameKey: state.renameKey,
      saveConnection: state.saveConnection,
      searchQuery: state.searchQuery,
      selectConnection: state.selectConnection,
      selectDb: state.selectDb,
      selectedDb: state.selectedDb,
      selectedKey: state.selectedKey,
      selectKey: state.selectKey,
      setKeyValue: state.setKeyValue,
      setPanelTab: state.setPanelTab,
      setSearchQuery: state.setSearchQuery,
      showConnectionModal: state.showConnectionModal,
      syncConnectionStatus: state.syncConnectionStatus,
    }))
  );
  const activeConnection = useRedisWorkspaceStore((state) =>
    getActiveConnectionFromState(state)
  );
  const editingConnection = useRedisWorkspaceStore((state) =>
    getEditingConnectionFromState(state)
  );

  return {
    ...storeSlice,
    activeConnection,
    editingConnection,
  };
}
