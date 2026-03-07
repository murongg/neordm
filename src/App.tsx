import { useEffect, useState } from "react";
import { useTheme } from "./hooks/useTheme";
import { Sidebar } from "./components/Sidebar";
import { KeyBrowser } from "./components/KeyBrowser";
import { ValueEditor } from "./components/ValueEditor";
import { AIAgent } from "./components/AIAgent";
import { RedisCLI } from "./components/RedisCLI";
import { ConnectionModal } from "./components/ConnectionModal";
import { SettingsPanel } from "./components/SettingsPanel";
import {
  ToastProvider,
  ToastViewport,
} from "./components/ToastProvider";
import { Tooltip } from "./components/Tooltip";
import { Bot, Terminal, Edit3, Wifi, Server, Info } from "lucide-react";
import { useI18n } from "./i18n";
import { getCliPromptLabel } from "./lib/redisCli";
import { installPrivacyRuntimeHandlers } from "./lib/privacyRuntime";
import { useAiChatState } from "./store/useAiChatState";
import { useAppPreferencesState } from "./store/useAppPreferencesState";
import { useCliState } from "./store/useCliState";
import { useRedisValueEditorState } from "./store/useRedisValueEditorState";
import { useRedisWorkspaceState } from "./store/useRedisWorkspaceState";
import type { RedisKey } from "./types";

function App() {
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const { messages } = useI18n();
  const [showSettings, setShowSettings] = useState(false);
  const preferences = useAppPreferencesState();
  const workspace = useRedisWorkspaceState({
    appSettings: preferences.appSettings,
    hasHydratedSettings: preferences.hasHydratedSettings,
    notConnectedMessage: messages.app.status.notConnected,
    persistLastConnectionId: preferences.persistLastConnectionId,
  });
  const aiChat = useAiChatState({
    initialGreeting: messages.store.greeting,
    activeConnection: workspace.activeConnection,
    selectedDb: workspace.selectedDb,
    selectedKey: workspace.selectedKey,
    keyValue: workspace.keyValue,
    keys: workspace.keys,
  });
  const editor = useRedisValueEditorState({
    activeConnection: workspace.activeConnection,
    keyValue: workspace.keyValue,
    notConnectedMessage: messages.app.status.notConnected,
    onRefreshKeys: workspace.refreshKeys,
    removeKeyFromState: workspace.removeKeyFromState,
    selectedDb: workspace.selectedDb,
    setKeyValue: workspace.setKeyValue,
  });
  const cli = useCliState({
    activeConnection: workspace.activeConnection,
    cliSettings: preferences.appSettings.cli,
    notConnectedMessage: messages.app.status.notConnected,
    onRefreshKeys: workspace.refreshKeys,
    onSelectDb: workspace.selectDb,
    onSyncConnectionStatus: workspace.syncConnectionStatus,
    selectedDb: workspace.selectedDb,
  });
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

          <Sidebar
            connections={workspace.connections}
            activeConnectionId={workspace.activeConnectionId}
            isCollapsed={preferences.isSidebarCollapsed}
            confirmBeforeDelete={preferences.appSettings.general.confirmDelete}
            onSelectConnection={workspace.selectConnection}
            onNewConnection={workspace.openNewConnectionModal}
            onEditConnection={workspace.openEditConnectionModal}
            onDisconnectConnection={workspace.disconnectConnection}
            onDeleteConnection={workspace.deleteConnection}
            panelTab={workspace.panelTab}
            onSetPanelTab={workspace.setPanelTab}
            onToggleCollapsed={preferences.toggleSidebarCollapsed}
            onOpenSettings={() => setShowSettings(true)}
          />

          <KeyBrowser
            connection={workspace.activeConnection}
            selectedDb={workspace.selectedDb}
            onSelectDb={workspace.selectDb}
            isRefreshing={workspace.isLoadingKeys}
            onRefresh={workspace.refreshKeys}
            keySeparator={preferences.keySeparator}
            showKeyType={appearanceSettings.showKeyType}
            showTtl={appearanceSettings.showTtl}
            keys={workspace.keys}
            selectedKey={workspace.selectedKey}
            onSelectKey={workspace.selectKey}
            onRenameKey={workspace.renameKey}
            onRenameGroup={workspace.renameGroup}
            searchQuery={workspace.searchQuery}
            onSearchChange={workspace.setSearchQuery}
          />

          <main className="relative flex-1 flex flex-col min-w-0 bg-base-300">
            <ToastViewport />

            {/* Topbar */}
            <div data-tauri-drag-region className="flex items-center justify-between px-4 h-12 border-b border-base-100/50 shrink-0 select-none">
              <div className="tabs tabs-box tabs-xs bg-base-200 rounded-lg p-0.5">
                <button
                  onClick={() => workspace.setPanelTab("editor")}
                  className={`tab gap-1.5 cursor-pointer font-mono text-[11px] rounded-md transition-colors duration-150 ${workspace.panelTab === "editor" ? "tab-active" : ""}`}
                >
                  <Edit3 size={11} /> {messages.app.tabs.editor}
                </button>
                <button
                  onClick={() => workspace.setPanelTab("ai")}
                  className={`tab gap-1.5 cursor-pointer font-mono text-[11px] rounded-md transition-colors duration-150 ${workspace.panelTab === "ai" ? "tab-active" : ""}`}
                >
                  <Bot size={11} /> {messages.app.tabs.ai}
                </button>
                <button
                  onClick={() => workspace.setPanelTab("cli")}
                  className={`tab gap-1.5 cursor-pointer font-mono text-[11px] rounded-md transition-colors duration-150 ${workspace.panelTab === "cli" ? "tab-active" : ""}`}
                >
                  <Terminal size={11} /> {messages.app.tabs.cli}
                </button>
              </div>

              <div className="flex items-center gap-3">
                {workspace.activeConnection && (
                  <>
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        workspace.activeConnection.status === "connected" ? "bg-success" :
                        workspace.activeConnection.status === "connecting" ? "bg-warning animate-pulse" :
                        "bg-base-content/20"
                      }`} />
                      <span className="text-xs font-mono text-base-content/50">
                        {workspace.activeConnection.name}
                      </span>
                      <span className="text-xs font-mono text-base-content/30">
                        · db{workspace.selectedDb}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-base-content/30">
                      <Server size={11} />
                      <span className="text-[10px] font-mono">
                        {workspace.activeConnection.host}:{workspace.activeConnection.port}
                      </span>
                    </div>
                    {workspace.activeConnection.tls && (
                      <div className="flex items-center gap-0.5 text-success/60">
                        <Wifi size={11} />
                        <span className="text-[10px] font-mono">
                          {messages.app.connection.tls}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Panel content */}
            <div className="flex-1 flex flex-col min-h-0">
              {workspace.panelTab === "editor" && (
                <ValueEditor
                  keyValue={workspace.keyValue}
                  onRefreshKeyValue={workspace.refreshKeyValue}
                  onDeleteKey={editor.deleteKey}
                  onUpdateStringValue={editor.updateStringValue}
                  onUpdateKeyTtl={editor.updateKeyTtl}
                  onUpdateJsonValue={editor.updateJsonValue}
                  onUpdateHashEntry={editor.updateHashEntry}
                  onDeleteHashEntry={editor.deleteHashEntry}
                  onUpdateZSetEntry={editor.updateZSetEntry}
                  onDeleteZSetEntry={editor.deleteZSetEntry}
                />
              )}
              {workspace.panelTab === "ai" && (
                <AIAgent
                  messages={aiChat.chatMessages}
                  isResponding={aiChat.isAiResponding}
                  onSend={aiChat.sendChatMessage}
                />
              )}
              {workspace.panelTab === "cli" && (
                <RedisCLI
                  history={cli.cliHistory}
                  onClear={cli.clearCliHistory}
                  onRun={cli.runCliCommand}
                  promptLabel={getCliPromptLabel(
                    workspace.activeConnection,
                    workspace.selectedDb
                  )}
                  connectionName={
                    workspace.activeConnection
                      ? `${workspace.activeConnection.host}:${workspace.activeConnection.port}`
                      : messages.app.status.notConnected
                  }
                />
              )}
            </div>

            <StatusBar
              keysCount={workspace.keys.length}
              selectedKey={workspace.selectedKey}
            />
          </main>
        </div>

        {workspace.showConnectionModal && (
          <ConnectionModal
            onClose={workspace.closeConnectionModal}
            onSave={workspace.saveConnection}
            connection={workspace.editingConnection ?? undefined}
          />
        )}
        {showSettings && (
          <SettingsPanel
            onClose={() => setShowSettings(false)}
            themeMode={themeMode}
            onThemeChange={setThemeMode}
            keySeparator={preferences.keySeparator}
            onKeySeparatorChange={preferences.setKeySeparator}
            onClearCliHistory={cli.clearCliHistory}
          />
        )}
      </div>
    </ToastProvider>
  );
}

interface StatusBarProps {
  keysCount: number;
  selectedKey: RedisKey | null;
}

function StatusBar({ keysCount, selectedKey }: StatusBarProps) {
  const { messages, format } = useI18n();

  return (
    <div className="flex items-center justify-between px-4 h-7 border-t border-base-100/50 shrink-0">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <span className="shrink-0 text-[10px] font-mono text-base-content/30">
          {format(messages.app.status.keysCount, { count: keysCount })}
        </span>
        {selectedKey && (
          <>
            <span className="shrink-0 text-base-content/10">·</span>
            <Tooltip content={selectedKey.key} className="flex min-w-0">
              <span className="flex min-w-0 items-center gap-1 text-[10px] font-mono text-base-content/40">
                <Info size={9} className="shrink-0" />
                <span className="truncate">{selectedKey.key}</span>
              </span>
            </Tooltip>
          </>
        )}
      </div>
      <div className="ml-3 flex shrink-0 items-center gap-3">
        <span className="text-[10px] font-mono text-base-content/30">Redis 7.2.3</span>
        <span className="text-[10px] font-mono text-base-content/20">NeoRDM v0.1.0</span>
      </div>
    </div>
  );
}

export default App;
