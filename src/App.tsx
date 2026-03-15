import { Suspense, lazy, useEffect, useState } from "react";
import { CommandPalette } from "./components/CommandPalette";
import { useTheme } from "./hooks/useTheme";
import { useTrayStatusbar } from "./hooks/useTrayStatusbar";
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
import { parseAutoRefreshIntervalSeconds } from "./lib/autoRefresh";
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
const loadRedisSlowLogPanel = () => import("./components/RedisSlowLogPanel");
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
const LazyRedisSlowLogPanel = lazy(async () => ({
  default: (await loadRedisSlowLogPanel()).RedisSlowLogPanel,
}));
const LazySettingsPanel = lazy(async () => ({
  default: (await loadSettingsPanel()).SettingsPanel,
}));

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

function isPrimaryShortcut(event: KeyboardEvent, key: string) {
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === key;
}

function isRefreshShortcut(event: KeyboardEvent) {
  if (event.key === "F5") {
    return true;
  }

  return (
    isPrimaryShortcut(event, "r") &&
    !event.shiftKey &&
    !event.altKey
  );
}

async function refreshWorkspaceContext() {
  const workspace = useRedisWorkspaceStore.getState();

  if (
    !workspace.activeConnectionId ||
    workspace.isLoadingKeys ||
    workspace.isLoadingMoreKeys ||
    workspace.isLoadingMoreKeyValue
  ) {
    return;
  }

  const shouldRefreshKeyValue = Boolean(workspace.selectedKey);
  const activeConnectionId = workspace.activeConnectionId;

  try {
    await workspace.refreshKeys();
  } catch {
    return;
  }

  if (!shouldRefreshKeyValue) {
    return;
  }

  const nextWorkspace = useRedisWorkspaceStore.getState();

  if (
    nextWorkspace.activeConnectionId !== activeConnectionId ||
    !nextWorkspace.selectedKey ||
    nextWorkspace.isLoadingMoreKeyValue
  ) {
    return;
  }

  void nextWorkspace.refreshKeyValue();
}

function App() {
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const { messages } = useI18n();
  const [showSettings, setShowSettings] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [hasMountedAiPanel, setHasMountedAiPanel] = useState(false);
  const [hasMountedPubSubPanel, setHasMountedPubSubPanel] = useState(false);
  const [hasMountedSlowLogPanel, setHasMountedSlowLogPanel] = useState(false);
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
  const autoRefreshIntervalSeconds = parseAutoRefreshIntervalSeconds(
    preferences.appSettings.general.autoRefreshInterval
  );
  const panelTab = useRedisWorkspaceStore((state) => state.panelTab);
  useTrayStatusbar();

  useEffect(() => {
    return scheduleIdleTask(() => {
      void loadConnectionModalHost();
      void loadRedisCLIPanel();
      void loadRedisPubSubPanel();
      void loadRedisSlowLogPanel();
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
    if (panelTab !== "slowlog") {
      return;
    }

    setHasMountedSlowLogPanel(true);
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
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat) {
        return;
      }

      if (isPrimaryShortcut(event, "k")) {
        event.preventDefault();
        setShowCommandPalette((currentValue) => !currentValue);
        return;
      }

      if (!isRefreshShortcut(event)) {
        return;
      }

      event.preventDefault();
      void refreshWorkspaceContext();
    };

    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  useEffect(() => {
    if (!preferences.hasHydratedSettings || autoRefreshIntervalSeconds <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshWorkspaceContext();
    }, autoRefreshIntervalSeconds * 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [autoRefreshIntervalSeconds, preferences.hasHydratedSettings]);

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

            <WorkspaceTopbarPanel
              onOpenCommandPalette={() => setShowCommandPalette(true)}
            />

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
              {hasMountedSlowLogPanel ? (
                <Suspense
                  fallback={panelTab === "slowlog" ? <PanelFallback /> : null}
                >
                  <div
                    className={
                      panelTab === "slowlog"
                        ? "flex flex-1 flex-col min-h-0"
                        : "hidden"
                    }
                    aria-hidden={panelTab !== "slowlog"}
                  >
                    <LazyRedisSlowLogPanel />
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
        {showCommandPalette ? (
          <CommandPalette
            onClose={() => setShowCommandPalette(false)}
            onOpenSettings={() => {
              setShowCommandPalette(false);
              setShowSettings(true);
            }}
          />
        ) : null}
      </div>
    </ToastProvider>
  );
}

export default App;
