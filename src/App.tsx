import { useEffect, useState } from "react";
import { useTheme } from "./hooks/useTheme";
import { AIAgentPanel } from "./components/AIAgentPanel";
import { ConnectionModalHost } from "./components/ConnectionModalHost";
import { KeyBrowserPanel } from "./components/KeyBrowserPanel";
import { RedisCLIPanel } from "./components/RedisCLIPanel";
import { SettingsPanel } from "./components/SettingsPanel";
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
import { installPrivacyRuntimeHandlers } from "./lib/privacyRuntime";
import {
  useAppPreferencesStore,
  useInitializeAppPreferencesStore,
} from "./store/useAppPreferencesState";
import {
  useInitializeRedisWorkspaceState,
  useRedisWorkspaceStore,
} from "./store/useRedisWorkspaceState";

function App() {
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const { messages } = useI18n();
  const [showSettings, setShowSettings] = useState(false);
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
  const appearanceSettings = preferences.appSettings.appearance;

  useEffect(() => {
    installPrivacyRuntimeHandlers();
  }, []);

  useEffect(() => {
    const parsedFontSize = Number.parseInt(
      appearanceSettings.fontSize,
      10
    );
    const nextFontSize =
      Number.isFinite(parsedFontSize) && parsedFontSize >= 11 && parsedFontSize <= 18
        ? parsedFontSize
        : 15;

    document.documentElement.style.fontSize = `${nextFontSize}px`;
  }, [appearanceSettings.fontSize]);

  useEffect(() => {
    document.documentElement.setAttribute(
      "data-ui-density",
      appearanceSettings.compactMode ? "compact" : "comfortable"
    );
  }, [appearanceSettings.compactMode]);

  useEffect(() => {
    document.documentElement.setAttribute(
      "data-ui-animations",
      appearanceSettings.animationsEnabled ? "enabled" : "disabled"
    );
  }, [appearanceSettings.animationsEnabled]);

  return (
    <ToastProvider>
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-base-300 text-base-content rounded-xl">

        {/* 全宽拖拽条 — 流量灯安全区 */}
        <div
          data-tauri-drag-region
          className="h-9 w-full shrink-0 select-none bg-base-300 border-b border-base-100/50"
        />

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
              <div
                className={
                  panelTab === "ai" ? "flex flex-1 flex-col min-h-0" : "hidden"
                }
              >
                <AIAgentPanel initialGreeting={messages.store.greeting} />
              </div>
              {panelTab === "cli" && <RedisCLIPanel />}
            </div>

            <StatusBarPanel />
          </main>
        </div>

        <ConnectionModalHost />
        {showSettings && (
          <SettingsPanel
            onClose={() => setShowSettings(false)}
            themeMode={themeMode}
            onThemeChange={setThemeMode}
            keySeparator={preferences.keySeparator}
            onKeySeparatorChange={preferences.setKeySeparator}
          />
        )}
      </div>
    </ToastProvider>
  );
}

export default App;
