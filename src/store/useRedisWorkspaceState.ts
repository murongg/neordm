import {
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { getCurrentMessages } from "../i18n";
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
} from "../lib/appSettings";
import {
  createRedisConnectionId,
  loadStoredConnections,
  persistConnections,
} from "../lib/connectionStore";
import {
  createRedisKey,
  deleteRedisKey,
  deleteRedisKeys,
  getRedisErrorMessage,
  getRedisKeyType,
  getRedisOverviewMetrics,
  getRedisKeySummary,
  getRedisKeyValuePage,
  getRedisServerVersion,
  renameRedisKey,
  renameRedisKeys,
  scanRedisKeysPage,
  testRedisConnection,
  type RedisKeyCreateInput,
} from "../lib/redis";
import { getRedisConnectionDefaultName } from "../lib/redisConnection";
import {
  recordAuditEvent,
  recordTelemetryEvent,
} from "../lib/privacyRuntime";
import type {
  KeyValue,
  PanelTab,
  RedisConnection,
  RedisKey,
  RedisOverviewMetrics,
} from "../types";

const RECENT_CONNECTION_LIMIT = 6;
const RECENT_KEY_LIMIT = 10;
const KEY_VALUE_PAGE_SIZE = 200;
const KEY_SCAN_PAGE_SIZE = 500;

function parsePositiveInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getKeyScanPageSize(value: string) {
  return Math.min(
    parsePositiveInt(value, 10_000),
    KEY_SCAN_PAGE_SIZE
  );
}

function insertRedisKey(keys: RedisKey[], nextKey: RedisKey) {
  const nextKeys = [...keys.filter((item) => item.key !== nextKey.key), nextKey];
  nextKeys.sort((left, right) => left.key.localeCompare(right.key));
  return nextKeys;
}

function mergeRedisKeys(keys: RedisKey[], nextKeys: RedisKey[]) {
  const merged = new Map(keys.map((item) => [item.key, item]));

  nextKeys.forEach((item) => {
    merged.set(item.key, item);
  });

  return Array.from(merged.values()).sort((left, right) =>
    left.key.localeCompare(right.key)
  );
}

function pushRecentValue(values: string[], nextValue: string, limit: number) {
  return [nextValue, ...values.filter((value) => value !== nextValue)].slice(0, limit);
}

interface RecentKeyReference {
  connectionId: string;
  db: number;
  key: RedisKey;
}

function pushRecentKey(
  values: RecentKeyReference[],
  nextValue: RecentKeyReference,
  limit: number
) {
  return [
    nextValue,
    ...values.filter(
      (value) =>
        !(
          value.connectionId === nextValue.connectionId &&
          value.db === nextValue.db &&
          value.key.key === nextValue.key.key
        )
    ),
  ].slice(0, limit);
}

function enrichRedisKeyMetadata(
  currentKey: RedisKey,
  value: Pick<KeyValue, "type" | "ttl" | "slot" | "nodeAddress">
): RedisKey {
  return {
    ...currentKey,
    type: value.type,
    ttl: value.ttl,
    slot: value.slot,
    nodeAddress: value.nodeAddress,
  };
}

function mergeKeyValuePages(currentValue: KeyValue, nextValue: KeyValue): KeyValue {
  if (currentValue.type !== nextValue.type) {
    return nextValue;
  }

  if (currentValue.type === "hash") {
    const mergedValue = {
      ...(currentValue.value &&
      typeof currentValue.value === "object" &&
      !Array.isArray(currentValue.value)
        ? (currentValue.value as Record<string, string>)
        : {}),
      ...(nextValue.value &&
      typeof nextValue.value === "object" &&
      !Array.isArray(nextValue.value)
        ? (nextValue.value as Record<string, string>)
        : {}),
    };

    return {
      ...nextValue,
      value: mergedValue,
      page: nextValue.page
        ? {
            ...nextValue.page,
            loadedCount: Object.keys(mergedValue).length,
          }
        : nextValue.page,
    };
  }

  if (currentValue.type === "set") {
    const mergedValue = Array.from(
      new Set([
        ...(Array.isArray(currentValue.value) ? (currentValue.value as string[]) : []),
        ...(Array.isArray(nextValue.value) ? (nextValue.value as string[]) : []),
      ])
    );

    return {
      ...nextValue,
      value: mergedValue,
      page: nextValue.page
        ? {
            ...nextValue.page,
            loadedCount: mergedValue.length,
          }
        : nextValue.page,
    };
  }

  if (currentValue.type === "list") {
    const mergedValue = [
      ...(Array.isArray(currentValue.value) ? (currentValue.value as string[]) : []),
      ...(Array.isArray(nextValue.value) ? (nextValue.value as string[]) : []),
    ];

    return {
      ...nextValue,
      value: mergedValue,
      page: nextValue.page
        ? {
            ...nextValue.page,
            loadedCount: mergedValue.length,
          }
        : nextValue.page,
    };
  }

  if (currentValue.type === "zset") {
    const mergedValue = [
      ...(Array.isArray(currentValue.value)
        ? (currentValue.value as Array<{ member: string; score: number }>)
        : []),
      ...(Array.isArray(nextValue.value)
        ? (nextValue.value as Array<{ member: string; score: number }>)
        : []),
    ];

    return {
      ...nextValue,
      value: mergedValue,
      page: nextValue.page
        ? {
            ...nextValue.page,
            loadedCount: mergedValue.length,
          }
        : nextValue.page,
    };
  }

  return nextValue;
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

interface LoadKeySummaryOptions {
  preserveValue?: boolean;
}

interface LoadKeysOptions {
  preserveSelection?: boolean;
}

interface LoadOverviewOptions {
  preserveValue?: boolean;
}

interface SelectConnectionOptions {
  db?: number;
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
  serverVersions: Record<string, string | null>;
  selectedDb: number;
  selectedClusterNodeAddress: string | null;
  keys: RedisKey[];
  selectedKey: RedisKey | null;
  keyValue: KeyValue | null;
  overview: RedisOverviewMetrics | null;
  overviewErrorMessage: string | null;
  recentConnectionIds: string[];
  recentKeys: RecentKeyReference[];
  searchQuery: string;
  panelTab: PanelTab;
  showConnectionModal: boolean;
  editingConnectionId: string | null;
  isLoadingKeys: boolean;
  isLoadingMoreKeys: boolean;
  isLoadingKeyValue: boolean;
  isLoadingMoreKeyValue: boolean;
  isLoadingOverview: boolean;
  keysScanCursor: string | null;
  hasMoreKeys: boolean;
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
  resetConnectionServerVersion: (connectionId: string) => void;
  loadConnectionServerVersion: (
    connection: RedisConnection,
    options?: { force?: boolean }
  ) => Promise<string | null>;
  syncConnectionStatus: (
    connectionId: string,
    status: RedisConnection["status"],
    db?: number
  ) => void;
  removeKeyFromState: (
    key: string,
    options?: { connectionId?: string; db?: number }
  ) => void;
  loadKeySummary: (
    connection: RedisConnection,
    key: RedisKey,
    db: number,
    options?: LoadKeySummaryOptions
  ) => Promise<RedisKey>;
  loadKeyType: (
    connection: RedisConnection,
    key: RedisKey,
    db: number
  ) => Promise<void>;
  loadKeyValueContent: (
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
  loadOverview: (
    connection: RedisConnection,
    options?: LoadOverviewOptions
  ) => Promise<void>;
  loadMoreKeys: () => Promise<void>;
  cancelLoadMoreKeys: () => void;
  loadMoreKeyValue: () => Promise<void>;
  selectConnection: (
    connectionId: string,
    options?: SelectConnectionOptions
  ) => Promise<void>;
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
  refreshOverview: () => Promise<void>;
  clearSelectedKey: () => void;
  selectClusterNode: (nodeAddress: string | null) => Promise<void>;
  selectKey: (key: RedisKey) => Promise<void>;
  createKey: (input: RedisKeyCreateInput) => Promise<RedisKey>;
  deleteKeys: (keys: RedisKey[]) => Promise<number>;
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
  notConnectedMessage: getCurrentMessages().app.status.notConnected,
  persistLastConnectionId: () => undefined,
};

let workspaceRuntime = defaultWorkspaceRuntime;
let keysRequestId = 0;
let keyValueRequestId = 0;
let overviewRequestId = 0;
const serverVersionRequestIds = new Map<string, number>();
const visibleKeyTypeRequests = new Set<string>();
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

function getVisibleKeyTypeRequestToken(
  connectionId: string,
  db: number,
  key: string
) {
  return `${connectionId}:${db}:${key}`;
}

export const useRedisWorkspaceStore = create<RedisWorkspaceStoreState>(
  (set, get) => ({
    connections: [],
    activeConnectionId: "",
    serverVersions: {},
    selectedDb: 0,
    selectedClusterNodeAddress: null,
    keys: [],
    selectedKey: null,
    keyValue: null,
    overview: null,
    overviewErrorMessage: null,
    recentConnectionIds: [],
    recentKeys: [],
    searchQuery: "",
    panelTab: "overview",
    showConnectionModal: false,
    editingConnectionId: null,
    isLoadingKeys: false,
    isLoadingMoreKeys: false,
    isLoadingKeyValue: false,
    isLoadingMoreKeyValue: false,
    isLoadingOverview: false,
    keysScanCursor: null,
    hasMoreKeys: false,
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
    resetConnectionServerVersion: (connectionId) => {
      serverVersionRequestIds.delete(connectionId);
      set((state) => {
        if (!Object.prototype.hasOwnProperty.call(state.serverVersions, connectionId)) {
          return state;
        }

        const nextServerVersions = { ...state.serverVersions };
        delete nextServerVersions[connectionId];

        return {
          serverVersions: nextServerVersions,
        };
      });
    },
    loadConnectionServerVersion: async (connection, options = {}) => {
      const hasCachedVersion = Object.prototype.hasOwnProperty.call(
        get().serverVersions,
        connection.id
      );

      if (!options.force && hasCachedVersion) {
        return get().serverVersions[connection.id] ?? null;
      }

      const requestId = (serverVersionRequestIds.get(connection.id) ?? 0) + 1;
      serverVersionRequestIds.set(connection.id, requestId);

      try {
        const version = await getRedisServerVersion({
          ...connection,
          db: connection.mode === "cluster" ? 0 : connection.db,
        });

        if (serverVersionRequestIds.get(connection.id) !== requestId) {
          return get().serverVersions[connection.id] ?? null;
        }

        set((state) => ({
          serverVersions: {
            ...state.serverVersions,
            [connection.id]: version,
          },
        }));

        return version;
      } catch {
        if (serverVersionRequestIds.get(connection.id) !== requestId) {
          return get().serverVersions[connection.id] ?? null;
        }

        set((state) => ({
          serverVersions: {
            ...state.serverVersions,
            [connection.id]: null,
          },
        }));

        return null;
      }
    },
    syncConnectionStatus: (connectionId, status, db) => {
      get().updateConnection(connectionId, (connection) => ({
        ...connection,
        status,
        db: db ?? connection.db,
      }));
    },
    removeKeyFromState: (key, options = {}) => {
      const state = get();
      const connectionId = options.connectionId ?? state.activeConnectionId;
      const db = options.db ?? state.selectedDb;

      keyValueRequestId += 1;
      set((state) => ({
        keys: state.keys.filter((item) => item.key !== key),
        selectedKey: state.selectedKey?.key === key ? null : state.selectedKey,
        keyValue: state.keyValue?.key === key ? null : state.keyValue,
        isLoadingKeyValue:
          state.selectedKey?.key === key ? false : state.isLoadingKeyValue,
        isLoadingMoreKeyValue:
          state.keyValue?.key === key ? false : state.isLoadingMoreKeyValue,
        recentKeys: state.recentKeys.filter(
          (item) =>
            !(
              item.connectionId === connectionId &&
              item.db === db &&
              item.key.key === key
            )
        ),
      }));
    },
    loadKeySummary: async (connection, key, db, options = {}) => {
      const requestId = ++keyValueRequestId;

      set((state) => ({
        selectedKey: key,
        panelTab: "editor",
        keyValue: options.preserveValue ? state.keyValue : null,
        isLoadingKeyValue: true,
        isLoadingMoreKeyValue: false,
      }));

      const summary = await getRedisKeySummary({ ...connection, db }, key.key);

      if (requestId !== keyValueRequestId) {
        return summary;
      }

      const normalizedSummary = {
        ...key,
        ...summary,
      };

      set((state) => ({
        keys: state.keys.map((item) =>
          item.key === normalizedSummary.key ? { ...item, ...normalizedSummary } : item
        ),
        selectedKey: normalizedSummary,
        recentKeys: state.recentKeys.map((item) =>
          item.connectionId === connection.id &&
          item.db === db &&
          item.key.key === normalizedSummary.key
            ? {
                ...item,
                key: {
                  ...item.key,
                  ...normalizedSummary,
                },
              }
            : item
        ),
      }));

      return normalizedSummary;
    },
    loadKeyType: async (connection, key, db) => {
      if (key.type) {
        return;
      }

      const requestToken = getVisibleKeyTypeRequestToken(connection.id, db, key.key);

      if (visibleKeyTypeRequests.has(requestToken)) {
        return;
      }

      visibleKeyTypeRequests.add(requestToken);

      try {
        const keyType = await getRedisKeyType({ ...connection, db }, key.key);

        set((state) => {
          if (
            state.activeConnectionId !== connection.id ||
            state.selectedDb !== db ||
            keyType == null
          ) {
            return state;
          }

          return {
            keys: state.keys.map((item) =>
              item.key === key.key ? { ...item, type: keyType } : item
            ),
            selectedKey:
              state.selectedKey?.key === key.key
                ? {
                    ...state.selectedKey,
                    type: keyType,
                  }
                : state.selectedKey,
            recentKeys: state.recentKeys.map((item) =>
              item.connectionId === connection.id &&
              item.db === db &&
              item.key.key === key.key
                ? {
                    ...item,
                    key: {
                      ...item.key,
                      type: keyType,
                    },
                  }
                : item
            ),
          };
        });
      } catch {
        return;
      }
    },
    loadKeyValueContent: async (connection, key, db, options = {}) => {
      const requestId = ++keyValueRequestId;

      set((state) => ({
        keyValue: options.preserveValue ? state.keyValue : null,
        isLoadingKeyValue: true,
        isLoadingMoreKeyValue: false,
      }));

      try {
        const value = await getRedisKeyValuePage(
          { ...connection, db },
          key.key,
          {
            pageSize: KEY_VALUE_PAGE_SIZE,
          }
        );

        if (requestId !== keyValueRequestId) {
          return;
        }

        set((state) => {
          const enrichedSelectedKey = enrichRedisKeyMetadata(key, value);

          return {
            keys: state.keys.map((item) =>
              item.key === value.key ? enrichRedisKeyMetadata(item, value) : item
            ),
            selectedKey: enrichedSelectedKey,
            keyValue: value,
            isLoadingKeyValue: false,
            recentKeys: state.recentKeys.map((item) =>
              item.connectionId === connection.id &&
              item.db === db &&
              item.key.key === value.key
                ? {
                    ...item,
                    key: enrichRedisKeyMetadata(item.key, value),
                  }
                : item
            ),
          };
        });
      } catch (error) {
        if (requestId !== keyValueRequestId) {
          return;
        }

        set({
          keyValue: {
            key: key.key,
            type: key.type ?? "string",
            ttl: key.ttl ?? -1,
            slot: key.slot,
            nodeAddress: key.nodeAddress,
            page: null,
            value: getRedisErrorMessage(error),
          },
          isLoadingKeyValue: false,
          isLoadingMoreKeyValue: false,
        });
      }
    },
    loadMoreKeyValue: async () => {
      const state = get();
      const activeConnection = getActiveConnectionFromState(state);
      const cursor = state.keyValue?.page?.nextCursor ?? null;

      if (
        !activeConnection ||
        !state.selectedKey ||
        !state.keyValue ||
        state.isLoadingMoreKeyValue ||
        !cursor
      ) {
        return;
      }

      const requestId = keyValueRequestId;

      set({ isLoadingMoreKeyValue: true });

      try {
        const nextValue = await getRedisKeyValuePage(
          { ...activeConnection, db: state.selectedDb },
          state.selectedKey.key,
          {
            pageSize: state.keyValue.page?.pageSize ?? KEY_VALUE_PAGE_SIZE,
            cursor,
          }
        );

        if (requestId !== keyValueRequestId) {
          return;
        }

        set((currentState) => {
          if (
            !currentState.keyValue ||
            currentState.keyValue.key !== nextValue.key
          ) {
            return {
              isLoadingMoreKeyValue: false,
            };
          }

          return {
            keyValue: mergeKeyValuePages(currentState.keyValue, nextValue),
            isLoadingMoreKeyValue: false,
          };
        });
      } catch (error) {
        if (requestId !== keyValueRequestId) {
          return;
        }

        set({ isLoadingMoreKeyValue: false });
        throw error;
      } finally {
        if (requestId === keyValueRequestId) {
          set({ isLoadingMoreKeyValue: false });
        }
      }
    },
    loadKeys: async (connection, db, options = {}) => {
      const requestId = ++keysRequestId;
      const {
        selectedKey,
        serverVersions,
        syncConnectionStatus,
        resetConnectionServerVersion,
      } = get();
      const currentSelectedKey = options.preserveSelection ? selectedKey : null;
      const { appSettings } = getWorkspaceRuntime();
      const clusterNodeAddress =
        connection.mode === "cluster" ? get().selectedClusterNodeAddress : null;
      const cachedServerVersion = serverVersions[connection.id];
      const shouldRefreshServerVersion =
        connection.status !== "connected" || cachedServerVersion == null;

      if (shouldRefreshServerVersion) {
        resetConnectionServerVersion(connection.id);
      }

      visibleKeyTypeRequests.clear();

      set({
        isLoadingKeys: true,
        isLoadingMoreKeys: false,
        isLoadingMoreKeyValue: false,
        keysScanCursor: null,
        hasMoreKeys: false,
      });
      syncConnectionStatus(connection.id, "connecting", db);

      if (!options.preserveSelection) {
        keyValueRequestId += 1;
        set({
          selectedKey: null,
          keyValue: null,
          isLoadingMoreKeyValue: false,
        });
      }

      try {
        const page = await scanRedisKeysPage(
          { ...connection, db },
          {
            pageSize: getKeyScanPageSize(appSettings.general.maxKeys),
            scanCount: parsePositiveInt(appSettings.general.scanCount, 200),
            clusterNodeAddress,
          }
        );

        if (requestId !== keysRequestId) {
          return;
        }

        let nextKeys = mergeRedisKeys([], page.keys);

        if (
          currentSelectedKey &&
          !nextKeys.some((item) => item.key === currentSelectedKey.key)
        ) {
          nextKeys = insertRedisKey(nextKeys, currentSelectedKey);
        }

        set({
          keys: nextKeys,
          selectedDb: db,
          keysScanCursor: page.nextCursor,
          hasMoreKeys: Boolean(page.nextCursor),
        });
        syncConnectionStatus(connection.id, "connected", db);
        void get()
          .loadConnectionServerVersion(connection, {
            force: shouldRefreshServerVersion,
          })
          .catch(() => undefined);

        if (currentSelectedKey) {
          const refreshedSelectedKey =
            nextKeys.find((item) => item.key === currentSelectedKey.key) ?? null;

          if (!refreshedSelectedKey) {
            set({
              selectedKey: null,
              keyValue: null,
              isLoadingKeyValue: false,
              isLoadingMoreKeyValue: false,
            });
          } else {
            const summary = await get().loadKeySummary(connection, refreshedSelectedKey, db, {
              preserveValue: true,
            });
            const latestState = get();

            if (
              latestState.activeConnectionId === connection.id &&
              latestState.selectedDb === db &&
              latestState.selectedKey?.key === refreshedSelectedKey.key
            ) {
              void get().loadKeyValueContent(connection, summary, db, {
                preserveValue: true,
              });
            }
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
          isLoadingKeyValue: false,
          isLoadingMoreKeyValue: false,
          keysScanCursor: null,
          hasMoreKeys: false,
        });
        syncConnectionStatus(connection.id, "error", db);
        throw error;
      } finally {
        if (requestId === keysRequestId) {
          set({
            isLoadingKeys: false,
            isLoadingMoreKeys: false,
          });
        }
      }
    },
    loadOverview: async (connection, options = {}) => {
      const requestId = ++overviewRequestId;

      set((state) => ({
        overview: options.preserveValue ? state.overview : null,
        overviewErrorMessage: null,
        isLoadingOverview: true,
      }));

      try {
        const overview = await getRedisOverviewMetrics(connection);

        if (requestId !== overviewRequestId) {
          return;
        }

        set({
          overview,
          overviewErrorMessage: null,
        });
      } catch (error) {
        if (requestId !== overviewRequestId) {
          return;
        }

        set({
          overview: null,
          overviewErrorMessage: getRedisErrorMessage(error),
        });
      } finally {
        if (requestId === overviewRequestId) {
          set({ isLoadingOverview: false });
        }
      }
    },
    loadMoreKeys: async () => {
      const state = get();
      const activeConnection = getActiveConnectionFromState(state);

      if (
        !activeConnection ||
        state.isLoadingKeys ||
        state.isLoadingMoreKeys ||
        !state.hasMoreKeys ||
        !state.keysScanCursor
      ) {
        return;
      }

      const requestId = keysRequestId;
      const { appSettings } = getWorkspaceRuntime();

      set({ isLoadingMoreKeys: true });

      try {
        const page = await scanRedisKeysPage(
          { ...activeConnection, db: state.selectedDb },
          {
            pageSize: getKeyScanPageSize(appSettings.general.maxKeys),
            scanCount: parsePositiveInt(appSettings.general.scanCount, 200),
            cursor: state.keysScanCursor,
            clusterNodeAddress:
              activeConnection.mode === "cluster"
                ? state.selectedClusterNodeAddress
                : null,
          }
        );

        if (requestId !== keysRequestId) {
          return;
        }

        set((currentState) => {
          const nextKeys = mergeRedisKeys(currentState.keys, page.keys);
          const selectedKey = currentState.selectedKey
            ? nextKeys.find((item) => item.key === currentState.selectedKey?.key) ??
              currentState.selectedKey
            : null;

          return {
            keys: nextKeys,
            selectedKey,
            keysScanCursor: page.nextCursor,
            hasMoreKeys: Boolean(page.nextCursor),
          };
        });
      } catch (error) {
        if (requestId !== keysRequestId) {
          return;
        }

        throw error;
      } finally {
        if (requestId === keysRequestId) {
          set({ isLoadingMoreKeys: false });
        }
      }
    },
    cancelLoadMoreKeys: () => {
      keysRequestId += 1;
      set({ isLoadingMoreKeys: false });
    },
    selectConnection: async (connectionId, options = {}) => {
      const connection = get().connections.find((item) => item.id === connectionId);
      const targetDb = connection?.mode === "cluster" ? 0 : options.db ?? connection?.db ?? 0;

      set({
        activeConnectionId: connectionId,
        selectedClusterNodeAddress: null,
        searchQuery: "",
        panelTab: "overview",
      });

      if (!connection) {
        overviewRequestId += 1;
        keyValueRequestId += 1;
        set({
          selectedDb: 0,
          selectedClusterNodeAddress: null,
          keys: [],
          selectedKey: null,
          keyValue: null,
          isLoadingKeyValue: false,
          overview: null,
          overviewErrorMessage: null,
          isLoadingOverview: false,
          isLoadingMoreKeyValue: false,
          isLoadingMoreKeys: false,
          keysScanCursor: null,
          hasMoreKeys: false,
        });
        return;
      }

      set((state) => ({
        selectedDb: targetDb,
        selectedClusterNodeAddress: null,
        recentConnectionIds: pushRecentValue(
          state.recentConnectionIds,
          connection.id,
          RECENT_CONNECTION_LIMIT
        ),
      }));
      getWorkspaceRuntime().persistLastConnectionId(connection.id);
      void get()
        .loadOverview({ ...connection, db: targetDb })
        .catch(() => undefined);

      try {
        await get().loadKeys({ ...connection, db: targetDb }, targetDb);
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
        name: connection.name || getRedisConnectionDefaultName(connection),
        mode: connection.mode ?? "direct",
        sentinel: connection.mode === "sentinel" ? connection.sentinel : undefined,
        cluster: connection.mode === "cluster" ? connection.cluster : undefined,
        username: connection.username || undefined,
        password: connection.password || undefined,
        db: connection.mode === "cluster" ? 0 : connection.db,
        sshTunnel: connection.sshTunnel,
      };

      await testRedisConnection({
        host: normalizedConnection.host,
        port: normalizedConnection.port,
        username: normalizedConnection.username,
        password: normalizedConnection.password,
        db: normalizedConnection.db,
        tls: normalizedConnection.tls,
        mode: normalizedConnection.mode,
        sentinel: normalizedConnection.sentinel,
        cluster: normalizedConnection.cluster,
        sshTunnel: normalizedConnection.sshTunnel,
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
        loadOverview,
      } = get();
      const { persistLastConnectionId } = getWorkspaceRuntime();

      if (!editingConnectionId) {
        const newConnection: RedisConnection = {
          ...normalizedConnection,
          id: createRedisConnectionId(),
          status: "connecting",
          color: connection.color,
        };

        set((state) => ({
          connections: [...state.connections, newConnection],
          activeConnectionId: newConnection.id,
          selectedDb: newConnection.db,
          selectedClusterNodeAddress: null,
          searchQuery: "",
          panelTab: "overview",
          selectedKey: null,
          keyValue: null,
          isLoadingKeyValue: false,
          overview: null,
          overviewErrorMessage: null,
          recentConnectionIds: pushRecentValue(
            state.recentConnectionIds,
            newConnection.id,
            RECENT_CONNECTION_LIMIT
          ),
          isLoadingMoreKeyValue: false,
          isLoadingMoreKeys: false,
          keysScanCursor: null,
          hasMoreKeys: false,
        }));
        persistLastConnectionId(newConnection.id);
        void loadOverview(newConnection).catch(() => undefined);
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
        set((state) => ({
          selectedDb: updatedConnection.db,
          selectedClusterNodeAddress: null,
          searchQuery: "",
          panelTab: "overview",
          recentConnectionIds: pushRecentValue(
            state.recentConnectionIds,
            updatedConnection.id,
            RECENT_CONNECTION_LIMIT
          ),
        }));
        void loadOverview(updatedConnection).catch(() => undefined);
        void loadKeys(updatedConnection, updatedConnection.db).catch(() => undefined);
      }
    },
    deleteConnection: (connectionId) => {
      const {
        activeConnectionId,
        editingConnectionId,
        closeConnectionModal,
        loadKeys,
        loadOverview,
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

      set((state) => ({
        connections: nextConnections,
        recentConnectionIds: state.recentConnectionIds.filter((id) => id !== connectionId),
        recentKeys: state.recentKeys.filter(
          (item) => item.connectionId !== connectionId
        ),
        serverVersions: (() => {
          if (!Object.prototype.hasOwnProperty.call(state.serverVersions, connectionId)) {
            return state.serverVersions;
          }

          const nextServerVersions = { ...state.serverVersions };
          delete nextServerVersions[connectionId];
          return nextServerVersions;
        })(),
      }));
      serverVersionRequestIds.delete(connectionId);

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
      overviewRequestId += 1;
      set({
        searchQuery: "",
        selectedClusterNodeAddress: null,
        selectedKey: null,
        keyValue: null,
        isLoadingKeyValue: false,
        overview: null,
        overviewErrorMessage: null,
        isLoadingOverview: false,
        keys: [],
        isLoadingMoreKeyValue: false,
        isLoadingMoreKeys: false,
        keysScanCursor: null,
        hasMoreKeys: false,
      });

      const nextConnection = nextConnections[0];

      if (!nextConnection) {
        keysRequestId += 1;
        set({
          isLoadingKeys: false,
          isLoadingMoreKeys: false,
          isLoadingMoreKeyValue: false,
          isLoadingKeyValue: false,
          isLoadingOverview: false,
          activeConnectionId: "",
          selectedDb: 0,
          selectedClusterNodeAddress: null,
          overview: null,
          overviewErrorMessage: null,
          keysScanCursor: null,
          hasMoreKeys: false,
        });
        persistLastConnectionId("");
        return;
      }

      set((state) => ({
        activeConnectionId: nextConnection.id,
        selectedDb: nextConnection.db,
        selectedClusterNodeAddress: null,
        recentConnectionIds: pushRecentValue(
          state.recentConnectionIds,
          nextConnection.id,
          RECENT_CONNECTION_LIMIT
        ),
      }));
      persistLastConnectionId(nextConnection.id);
      void loadOverview(nextConnection).catch(() => undefined);
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
      overviewRequestId += 1;

      set((state) => ({
        isLoadingKeys: false,
        isLoadingMoreKeys: false,
        isLoadingMoreKeyValue: false,
        isLoadingKeyValue: false,
        isLoadingOverview: false,
        activeConnectionId: "",
        selectedDb: 0,
        selectedClusterNodeAddress: null,
        searchQuery: "",
        keys: [],
        selectedKey: null,
        keyValue: null,
        overview: null,
        overviewErrorMessage: null,
        recentKeys: state.recentKeys.filter(
          (item) => item.connectionId !== connectionId
        ),
        keysScanCursor: null,
        hasMoreKeys: false,
      }));
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

      if (activeConnection.mode === "cluster") {
        set({
          selectedDb: 0,
          searchQuery: "",
        });
        updateConnection(activeConnection.id, (connection) => ({
          ...connection,
          db: 0,
        }));
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

      const summary = await state.loadKeySummary(activeConnection, state.selectedKey, state.selectedDb, {
        preserveValue: true,
      });
      const latestState = get();

      if (
        latestState.activeConnectionId !== activeConnection.id ||
        latestState.selectedDb !== state.selectedDb ||
        latestState.selectedKey?.key !== state.selectedKey.key
      ) {
        return;
      }

      await state.loadKeyValueContent(activeConnection, summary, state.selectedDb, {
        preserveValue: true,
      });
    },
    refreshOverview: async () => {
      const state = get();
      const activeConnection = getActiveConnectionFromState(state);

      if (!activeConnection) {
        return;
      }

      await state.loadOverview(
        {
          ...activeConnection,
          db: activeConnection.mode === "cluster" ? 0 : state.selectedDb,
        },
        {
          preserveValue: true,
        }
      );
    },
    clearSelectedKey: () => {
      keyValueRequestId += 1;
      set({
        selectedKey: null,
        keyValue: null,
        isLoadingKeyValue: false,
        isLoadingMoreKeyValue: false,
      });
    },
    selectClusterNode: async (nodeAddress) => {
      const state = get();
      const activeConnection = getActiveConnectionFromState(state);
      const normalizedAddress = nodeAddress?.trim() || null;

      if (!activeConnection || activeConnection.mode !== "cluster") {
        set({ selectedClusterNodeAddress: null });
        return;
      }

      if (state.selectedClusterNodeAddress === normalizedAddress) {
        return;
      }

      set({
        selectedClusterNodeAddress: normalizedAddress,
        searchQuery: "",
      });

      try {
        await state.loadKeys(activeConnection, 0, {
          preserveSelection: true,
        });
      } catch {
        return;
      }
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
        set((currentState) => ({
          panelTab: "editor",
          recentKeys: pushRecentKey(
            currentState.recentKeys,
            {
              connectionId: activeConnection.id,
              db: state.selectedDb,
              key,
            },
            RECENT_KEY_LIMIT
          ),
        }));
        return;
      }

      const summary = await state.loadKeySummary(activeConnection, key, state.selectedDb);
      const latestState = get();

      if (
        latestState.activeConnectionId !== activeConnection.id ||
        latestState.selectedDb !== state.selectedDb ||
        latestState.selectedKey?.key !== key.key
      ) {
        return;
      }

      void state.loadKeyValueContent(activeConnection, summary, state.selectedDb);
      const recentKey =
        latestState.selectedKey?.key === key.key ? latestState.selectedKey : key;
      set((currentState) => ({
        recentKeys: pushRecentKey(
          currentState.recentKeys,
          {
            connectionId: activeConnection.id,
            db: state.selectedDb,
            key: recentKey,
          },
          RECENT_KEY_LIMIT
        ),
      }));
    },
    createKey: async (input) => {
      const state = get();
      const messages = getCurrentMessages();
      const activeConnection = getActiveConnectionFromState(state);
      const { notConnectedMessage } = getWorkspaceRuntime();
      const nextKeyName = input.key.trim();

      if (!activeConnection) {
        throw new Error(notConnectedMessage);
      }

      if (!nextKeyName.length) {
        throw new Error(messages.keyBrowser.keyNameRequired);
      }

      if (state.keys.some((item) => item.key === nextKeyName)) {
        throw new Error(messages.ui.errors.keyAlreadyExists);
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
        recentKeys: pushRecentKey(
          currentState.recentKeys,
          {
            connectionId: activeConnection.id,
            db: state.selectedDb,
            key: createdKey,
          },
          RECENT_KEY_LIMIT
        ),
      }));

      const summary = await state.loadKeySummary(activeConnection, createdKey, state.selectedDb);
      const latestState = get();

      if (
        latestState.activeConnectionId === activeConnection.id &&
        latestState.selectedDb === state.selectedDb &&
        latestState.selectedKey?.key === createdKey.key
      ) {
        void state.loadKeyValueContent(activeConnection, summary, state.selectedDb);
      }

      return createdKey;
    },
    deleteKeys: async (keys) => {
      const state = get();
      const activeConnection = getActiveConnectionFromState(state);
      const uniqueKeysToDelete = Array.from(
        new Set(keys.map((item) => item.key.trim()).filter(Boolean))
      );

      if (!activeConnection) {
        throw new Error(getWorkspaceRuntime().notConnectedMessage);
      }

      if (!uniqueKeysToDelete.length) {
        return 0;
      }

      await deleteRedisKeys(
        { ...activeConnection, db: state.selectedDb },
        uniqueKeysToDelete
      );

      const deletedKeys = new Set(uniqueKeysToDelete);
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
        isLoadingMoreKeyValue:
          currentState.keyValue && deletedKeys.has(currentState.keyValue.key)
            ? false
            : currentState.isLoadingMoreKeyValue,
        recentKeys: currentState.recentKeys.filter(
          (item) =>
            !(
              item.connectionId === activeConnection.id &&
              item.db === state.selectedDb &&
              deletedKeys.has(item.key.key)
            )
        ),
      }));

      void recordTelemetryEvent("workspace.keys.delete");
      void recordAuditEvent("workspace.keys.delete", {
        keyCount: uniqueKeysToDelete.length,
        keys: uniqueKeysToDelete.join(","),
      });

      return uniqueKeysToDelete.length;
    },
    deleteKey: async (key) => {
      const state = get();
      const messages = getCurrentMessages();
      const activeConnection = getActiveConnectionFromState(state);

      if (!activeConnection) {
        throw new Error(getWorkspaceRuntime().notConnectedMessage);
      }

      if (!key.key.length) {
        throw new Error(messages.keyBrowser.keyNameRequired);
      }

      await deleteRedisKey(
        { ...activeConnection, db: state.selectedDb },
        key.key
      );

      void recordTelemetryEvent("workspace.key.delete");
      void recordAuditEvent("workspace.key.delete", {
        key: key.key,
      });

      get().removeKeyFromState(key.key, {
        connectionId: activeConnection.id,
        db: state.selectedDb,
      });
    },
    deleteGroup: async (groupId, separator) => {
      const state = get();
      const messages = getCurrentMessages();
      const activeConnection = getActiveConnectionFromState(state);

      if (!activeConnection) {
        throw new Error(getWorkspaceRuntime().notConnectedMessage);
      }

      if (!groupId.length || !separator.length) {
        throw new Error(messages.ui.errors.groupNameRequired);
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
        recentKeys: currentState.recentKeys.filter(
          (item) =>
            !(
              item.connectionId === activeConnection.id &&
              item.db === state.selectedDb &&
              deletedKeys.has(item.key.key)
            )
        ),
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
      const messages = getCurrentMessages();
      const activeConnection = getActiveConnectionFromState(state);
      const { notConnectedMessage } = getWorkspaceRuntime();

      if (!activeConnection) {
        throw new Error(notConnectedMessage);
      }

      if (!nextKeyName.length) {
        throw new Error(messages.keyBrowser.keyNameRequired);
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
        recentKeys: currentState.recentKeys.map((item) =>
          item.connectionId === activeConnection.id &&
          item.db === state.selectedDb &&
          item.key.key === key.key
            ? {
                ...item,
                key: {
                  ...item.key,
                  key: nextKeyName,
                },
              }
            : item
        ),
      }));

      return renamedKey;
    },
    renameGroup: async (groupId, nextGroupId, separator) => {
      const state = get();
      const messages = getCurrentMessages();
      const activeConnection = getActiveConnectionFromState(state);
      const { notConnectedMessage } = getWorkspaceRuntime();

      if (!activeConnection) {
        throw new Error(notConnectedMessage);
      }

      if (!groupId.length || !nextGroupId.length) {
        throw new Error(messages.ui.errors.groupNameRequired);
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
        recentKeys: currentState.recentKeys.map((item) => {
          if (
            item.connectionId !== activeConnection.id ||
            item.db !== state.selectedDb
          ) {
            return item;
          }

          const nextKey = renamedMap.get(item.key.key);
          return nextKey
            ? {
                ...item,
                key: {
                  ...item.key,
                  key: nextKey,
                },
              }
            : item;
        }),
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
      hasMoreKeys: state.hasMoreKeys,
      isLoadingKeys: state.isLoadingKeys,
      isLoadingKeyValue: state.isLoadingKeyValue,
      isLoadingMoreKeys: state.isLoadingMoreKeys,
      isLoadingOverview: state.isLoadingOverview,
      keyValue: state.keyValue,
      keys: state.keys,
      loadKeys: state.loadKeys,
      loadKeySummary: state.loadKeySummary,
      loadKeyType: state.loadKeyType,
      loadKeyValueContent: state.loadKeyValueContent,
      loadOverview: state.loadOverview,
      loadMoreKeys: state.loadMoreKeys,
      openEditConnectionModal: state.openEditConnectionModal,
      openNewConnectionModal: state.openNewConnectionModal,
      overview: state.overview,
      overviewErrorMessage: state.overviewErrorMessage,
      panelTab: state.panelTab,
      createKey: state.createKey,
      deleteKeys: state.deleteKeys,
      deleteKey: state.deleteKey,
      deleteGroup: state.deleteGroup,
      clearSelectedKey: state.clearSelectedKey,
      refreshKeys: state.refreshKeys,
      refreshKeyValue: state.refreshKeyValue,
      refreshOverview: state.refreshOverview,
      removeKeyFromState: state.removeKeyFromState,
      renameGroup: state.renameGroup,
      renameKey: state.renameKey,
      saveConnection: state.saveConnection,
      searchQuery: state.searchQuery,
      selectConnection: state.selectConnection,
      selectClusterNode: state.selectClusterNode,
      selectDb: state.selectDb,
      selectedClusterNodeAddress: state.selectedClusterNodeAddress,
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
