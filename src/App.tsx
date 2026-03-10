import { Suspense, lazy, useEffect, useState } from "react";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useTheme } from "./hooks/useTheme";
import { KeyBrowserPanel } from "./components/KeyBrowserPanel";
import { SidebarPanel } from "./components/SidebarPanel";
import { StatusBarPanel } from "./components/StatusBarPanel";
import {
  ToastProvider,
  ToastViewport,
} from "./components/ToastProvider";
import { ValueEditorPanel } from "./components/ValueEditorPanel";
import { WorkspaceTopbarPanel } from "./components/WorkspaceTopbarPanel";
import { useShallow } from "zustand/react/shallow";
import { useI18n } from "./i18n";
import { prepareAIAgentExperience } from "./lib/aiPrefetch";
import { useAppUpdateStore } from "./store/useAppUpdateState";
import {
  useAppPreferencesStore,
  useInitializeAppPreferencesStore,
} from "./store/useAppPreferencesState";
import {
  useInitializeRedisWorkspaceState,
  useRedisWorkspaceStore,
} from "./store/useRedisWorkspaceState";

const loadAIAgentPanel = () => import("./components/AIAgentPanel");
const loadConnectionModalHost = () => import("./components/ConnectionModalHost");
const loadRedisCLIPanel = () => import("./components/RedisCLIPanel");
const loadRedisPubSubPanel = () => import("./components/RedisPubSubPanel");
const loadSettingsPanel = () => import("./components/SettingsPanel");

const LazyAIAgentPanel = lazy(async () => ({
  default: (await loadAIAgentPanel()).AIAgentPanel,
}));
const LazyConnectionModalHost = lazy(async () => ({
  default: (await loadConnectionModalHost()).ConnectionModalHost,
}));
const LazyRedisCLIPanel = lazy(async () => ({
  default: (await loadRedisCLIPanel()).RedisCLIPanel,
}));
const LazyRedisPubSubPanel = lazy(async () => ({
  default: (await loadRedisPubSubPanel()).RedisPubSubPanel,
}));
const LazySettingsPanel = lazy(async () => ({
  default: (await loadSettingsPanel()).SettingsPanel,
}));

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

function scheduleIdleTask(task: () => void, timeout = 1200) {
  if (typeof window === "undefined") {
    return () => {};
  }

  if ("requestIdleCallback" in window) {
    const idleHandle = window.requestIdleCallback(task, { timeout });
    return () => window.cancelIdleCallback(idleHandle);
  }

  const timer = globalThis.setTimeout(task, timeout);
  return () => globalThis.clearTimeout(timer);
}

function PanelFallback() {
  return <div className="flex flex-1 min-h-0 bg-base-300" />;
}

function isMacOSPlatform() {
  if (typeof navigator === "undefined") {
    return false;
  }

  return /mac/i.test(navigator.platform || navigator.userAgent);
}

function App() {
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const { messages } = useI18n();
  const [showSettings, setShowSettings] = useState(false);
  const [hasMountedAiPanel, setHasMountedAiPanel] = useState(false);
  const [hasMountedPubSubPanel, setHasMountedPubSubPanel] = useState(false);
  const [isMacOS] = useState(() => isMacOSPlatform());
  useInitializeAppPreferencesStore();
  const preferences = useAppPreferencesStore(
    useShallow((state) => ({
      appSettings: state.appSettings,
      hasHydratedSettings: state.hasHydratedSettings,
      persistLastConnectionId: state.persistLastConnectionId,
    }))
  );
  useInitializeRedisWorkspaceState({
    appSettings: preferences.appSettings,
    hasHydratedSettings: preferences.hasHydratedSettings,
    notConnectedMessage: messages.app.status.notConnected,
    persistLastConnectionId: preferences.persistLastConnectionId,
  });
  const panelTab = useRedisWorkspaceStore((state) => state.panelTab);
  const trayStatusbarContext = useRedisWorkspaceStore(
    useShallow((state) => ({
      activeConnectionId: state.activeConnectionId,
      connections: state.connections,
      hasHydratedConnections: state.hasHydratedConnections,
      keyValue: state.keyValue,
    }))
  );

  useEffect(() => {
    return scheduleIdleTask(() => {
      void loadConnectionModalHost();
      void loadRedisCLIPanel();
      void loadRedisPubSubPanel();
      void useAppUpdateStore.getState().checkForUpdates({ silent: true });
    }, 1500);
  }, []);

  useEffect(() => {
    if (panelTab !== "ai") {
      return;
    }

    setHasMountedAiPanel(true);

    const frame = window.requestAnimationFrame(() => {
      void prepareAIAgentExperience().catch((error) => {
        console.error("Failed to prepare AI agent experience", error);
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [panelTab]);

  useEffect(() => {
    if (panelTab !== "pubsub") {
      return;
    }

    setHasMountedPubSubPanel(true);
  }, [panelTab]);

  useEffect(() => {
    document.documentElement.style.fontSize = "15px";
    document.documentElement.setAttribute("data-ui-density", "comfortable");
    document.documentElement.setAttribute("data-ui-animations", "enabled");
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD) {
      return;
    }

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    document.addEventListener("contextmenu", handleContextMenu, true);

    return () => {
      document.removeEventListener("contextmenu", handleContextMenu, true);
    };
  }, []);

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
    if (!trayStatusbarContext.activeConnectionId || !trayStatusbarContext.keyValue) {
      return;
    }

    const { keyValue } = trayStatusbarContext;

    void emit(TRAY_STATUSBAR_CONTEXT_EVENT, {
      type: "sync-key",
      connectionId: trayStatusbarContext.activeConnectionId,
      key: keyValue.key,
      keyType: keyValue.type,
      ttl: keyValue.ttl,
      slot: keyValue.slot ?? null,
      nodeAddress: keyValue.nodeAddress ?? null,
      preview: formatTrayStatusbarPreview(keyValue.value),
    }).catch(() => undefined);
  }, [trayStatusbarContext]);

  return (
    <ToastProvider>
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-base-300 text-base-content rounded-xl">
        {isMacOS ? (
          <div
            data-tauri-drag-region
            className="h-9 w-full shrink-0 select-none bg-base-300 border-b border-base-100/50"
          />
        ) : null}

        {/* 三列主体 */}
        <div className="flex w-full flex-1 min-h-0 overflow-hidden">
          <SidebarPanel onOpenSettings={() => setShowSettings(true)} />

          <KeyBrowserPanel />

          <main className="relative flex-1 flex flex-col min-w-0 bg-base-300">
            <ToastViewport />

            <WorkspaceTopbarPanel />

            {/* Panel content */}
            <div className="flex-1 flex flex-col min-h-0">
              {panelTab === "editor" && <ValueEditorPanel />}
              {hasMountedAiPanel ? (
                <Suspense fallback={panelTab === "ai" ? <PanelFallback /> : null}>
                  <div
                    className={
                      panelTab === "ai"
                        ? "flex flex-1 flex-col min-h-0"
                        : "hidden"
                    }
                    aria-hidden={panelTab !== "ai"}
                  >
                    <LazyAIAgentPanel initialGreeting={messages.store.greeting} />
                  </div>
                </Suspense>
              ) : null}
              {panelTab === "cli" && (
                <Suspense fallback={<PanelFallback />}>
                  <LazyRedisCLIPanel />
                </Suspense>
              )}
              {hasMountedPubSubPanel ? (
                <Suspense
                  fallback={panelTab === "pubsub" ? <PanelFallback /> : null}
                >
                  <div
                    className={
                      panelTab === "pubsub"
                        ? "flex flex-1 flex-col min-h-0"
                        : "hidden"
                    }
                    aria-hidden={panelTab !== "pubsub"}
                  >
                    <LazyRedisPubSubPanel />
                  </div>
                </Suspense>
              ) : null}
            </div>

            <StatusBarPanel />
          </main>
        </div>

        <Suspense fallback={null}>
          <LazyConnectionModalHost />
        </Suspense>
        {showSettings && (
          <Suspense fallback={null}>
            <LazySettingsPanel
              onClose={() => setShowSettings(false)}
              themeMode={themeMode}
              onThemeChange={setThemeMode}
            />
          </Suspense>
        )}
      </div>
    </ToastProvider>
  );
}

export default App;
