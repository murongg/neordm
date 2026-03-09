import { Suspense, lazy, useEffect, useState } from "react";
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

function App() {
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const { messages } = useI18n();
  const [showSettings, setShowSettings] = useState(false);
  const [hasMountedAiPanel, setHasMountedAiPanel] = useState(false);
  const [isMacOS] = useState(() => isMacOSPlatform());
  useInitializeAppPreferencesStore();
  const preferences = useAppPreferencesStore(
    useShallow((state) => ({
      appSettings: state.appSettings,
      hasHydratedSettings: state.hasHydratedSettings,
      keySeparator: state.keySeparator,
      persistLastConnectionId: state.persistLastConnectionId,
      setKeySeparator: state.setKeySeparator,
    }))
  );
  useInitializeRedisWorkspaceState({
    appSettings: preferences.appSettings,
    hasHydratedSettings: preferences.hasHydratedSettings,
    notConnectedMessage: messages.app.status.notConnected,
    persistLastConnectionId: preferences.persistLastConnectionId,
  });
  const panelTab = useRedisWorkspaceStore((state) => state.panelTab);

  useEffect(() => {
    return scheduleIdleTask(() => {
      void loadConnectionModalHost();
      void loadRedisCLIPanel();
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
              keySeparator={preferences.keySeparator}
              onKeySeparatorChange={preferences.setKeySeparator}
            />
          </Suspense>
        )}
      </div>
    </ToastProvider>
  );
}

export default App;
