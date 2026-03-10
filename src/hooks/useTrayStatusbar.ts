import { useEffect } from "react";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useShallow } from "zustand/react/shallow";
import { useRedisWorkspaceStore } from "../store/useRedisWorkspaceState";

const TRAY_QUICK_ACTION_EVENT = "neordm://tray/quick-action";
const TRAY_STATUSBAR_EVENT = "neordm://tray/action";
const TRAY_STATUSBAR_CONTEXT_EVENT = "neordm://tray/context";

type TrayStatusbarEventPayload = {
  type:
    | "select-connection"
    | "open-panel"
    | "open-key"
    | "refresh-connection"
    | "disconnect-connection";
  connectionId?: string | null;
  key?: string | null;
  panel?: "editor" | "cli" | "pubsub" | null;
};

function formatTrayStatusbarPreview(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return "(empty)";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function useTrayStatusbar() {
  const trayStatusbarContext = useRedisWorkspaceStore(
    useShallow((state) => ({
      activeConnectionId: state.activeConnectionId,
      connections: state.connections,
      hasHydratedConnections: state.hasHydratedConnections,
      keyValue: state.keyValue,
    }))
  );

  useEffect(() => {
    let disposed = false;
    const unlistenFns: UnlistenFn[] = [];

    const setupTrayListeners = async () => {
      try {
        const quickActionUnlisten = await listen<string>(
          TRAY_QUICK_ACTION_EVENT,
          ({ payload }) => {
            const workspace = useRedisWorkspaceStore.getState();

            switch (payload) {
              case "new-connection":
                workspace.openNewConnectionModal();
                break;
              case "browse-keys":
                workspace.setPanelTab("editor");
                break;
              case "refresh-keys":
                void workspace.refreshKeys();
                break;
              case "open-cli":
                workspace.setPanelTab("cli");
                break;
              case "open-pubsub":
                workspace.setPanelTab("pubsub");
                break;
              case "disconnect":
                if (workspace.activeConnectionId) {
                  workspace.disconnectConnection(workspace.activeConnectionId);
                }
                break;
              default:
                break;
            }
          }
        );

        if (disposed) {
          quickActionUnlisten();
          return;
        }

        unlistenFns.push(quickActionUnlisten);
      } catch (error) {
        if (import.meta.env.DEV) {
          console.debug("Tray quick actions listener unavailable", error);
        }
      }

      try {
        const statusbarUnlisten = await listen<TrayStatusbarEventPayload>(
          TRAY_STATUSBAR_EVENT,
          ({ payload }) => {
            void (async () => {
              const connectionId = payload.connectionId?.trim();
              const key = payload.key?.trim();

              switch (payload.type) {
                case "select-connection": {
                  if (!connectionId) {
                    return;
                  }

                  await useRedisWorkspaceStore
                    .getState()
                    .selectConnection(connectionId)
                    .catch(() => undefined);
                  break;
                }
                case "open-panel": {
                  if (!connectionId || !payload.panel) {
                    return;
                  }

                  const workspace = useRedisWorkspaceStore.getState();

                  if (workspace.activeConnectionId !== connectionId) {
                    const selected = await workspace
                      .selectConnection(connectionId)
                      .then(() => true)
                      .catch(() => false);

                    if (!selected) {
                      return;
                    }
                  }

                  useRedisWorkspaceStore.getState().setPanelTab(payload.panel);
                  break;
                }
                case "open-key": {
                  if (!connectionId || !key) {
                    return;
                  }

                  let workspace = useRedisWorkspaceStore.getState();

                  if (workspace.activeConnectionId !== connectionId) {
                    const selected = await workspace
                      .selectConnection(connectionId)
                      .then(() => true)
                      .catch(() => false);

                    if (!selected) {
                      return;
                    }

                    workspace = useRedisWorkspaceStore.getState();
                  }

                  workspace.setPanelTab("editor");

                  let matchedKey = workspace.keys.find((item) => item.key === key);

                  if (!matchedKey) {
                    await workspace.refreshKeys().catch(() => undefined);
                    workspace = useRedisWorkspaceStore.getState();
                    matchedKey = workspace.keys.find((item) => item.key === key);
                  }

                  if (matchedKey) {
                    await workspace.selectKey(matchedKey).catch(() => undefined);
                  }

                  break;
                }
                case "refresh-connection": {
                  if (!connectionId) {
                    return;
                  }

                  const workspace = useRedisWorkspaceStore.getState();

                  if (workspace.activeConnectionId === connectionId) {
                    await workspace.refreshKeys().catch(() => undefined);
                  }
                  break;
                }
                case "disconnect-connection": {
                  if (!connectionId) {
                    return;
                  }

                  useRedisWorkspaceStore
                    .getState()
                    .disconnectConnection(connectionId);
                  break;
                }
                default:
                  break;
              }
            })();
          }
        );

        if (disposed) {
          statusbarUnlisten();
          return;
        }

        unlistenFns.push(statusbarUnlisten);
      } catch (error) {
        if (import.meta.env.DEV) {
          console.debug("Tray statusbar listener unavailable", error);
        }
      }
    };

    void setupTrayListeners();

    return () => {
      disposed = true;
      for (const unlisten of unlistenFns) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    if (!trayStatusbarContext.hasHydratedConnections) {
      return;
    }

    void emit(TRAY_STATUSBAR_CONTEXT_EVENT, {
      type: "sync-connections",
      activeConnectionId: trayStatusbarContext.activeConnectionId || null,
      connections: trayStatusbarContext.connections,
    }).catch(() => undefined);
  }, [
    trayStatusbarContext.activeConnectionId,
    trayStatusbarContext.connections,
    trayStatusbarContext.hasHydratedConnections,
  ]);

  useEffect(() => {
    if (!trayStatusbarContext.activeConnectionId) {
      return;
    }

    void emit(TRAY_STATUSBAR_CONTEXT_EVENT, {
      type: "sync-connection",
      connectionId: trayStatusbarContext.activeConnectionId,
    }).catch(() => undefined);
  }, [trayStatusbarContext.activeConnectionId]);

  useEffect(() => {
    if (
      !trayStatusbarContext.activeConnectionId ||
      !trayStatusbarContext.keyValue
    ) {
      return;
    }

    const { activeConnectionId, keyValue } = trayStatusbarContext;

    void emit(TRAY_STATUSBAR_CONTEXT_EVENT, {
      type: "sync-key",
      connectionId: activeConnectionId,
      key: keyValue.key,
      keyType: keyValue.type,
      ttl: keyValue.ttl,
      slot: keyValue.slot ?? null,
      nodeAddress: keyValue.nodeAddress ?? null,
      preview: formatTrayStatusbarPreview(keyValue.value),
    }).catch(() => undefined);
  }, [
    trayStatusbarContext.activeConnectionId,
    trayStatusbarContext.keyValue,
  ]);
}
