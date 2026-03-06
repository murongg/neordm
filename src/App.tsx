import { useState } from "react";
import { useAppStore } from "./store/useAppStore";
import { useTheme } from "./hooks/useTheme";
import { Sidebar } from "./components/Sidebar";
import { KeyBrowser } from "./components/KeyBrowser";
import { ValueEditor } from "./components/ValueEditor";
import { AIAgent } from "./components/AIAgent";
import { RedisCLI } from "./components/RedisCLI";
import { ConnectionModal } from "./components/ConnectionModal";
import { SettingsPanel } from "./components/SettingsPanel";
import { Bot, Terminal, Edit3, Wifi, Server, Info } from "lucide-react";
import { useI18n } from "./i18n";

function App() {
  const store = useAppStore();
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const { messages } = useI18n();
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-base-300 text-base-content rounded-xl">

      {/* 全宽拖拽条 — 流量灯安全区 */}
      <div
        data-tauri-drag-region
        className="h-9 w-full shrink-0 select-none bg-base-300 border-b border-base-100/50"
      />

      {/* 三列主体 */}
      <div className="flex w-full flex-1 min-h-0 overflow-hidden">

        <Sidebar
          connections={store.connections}
          activeConnectionId={store.activeConnectionId}
          onSelectConnection={store.selectConnection}
          onNewConnection={store.openNewConnectionModal}
          onEditConnection={store.openEditConnectionModal}
          onDisconnectConnection={store.disconnectConnection}
          onDeleteConnection={store.deleteConnection}
          panelTab={store.panelTab}
          onSetPanelTab={store.setPanelTab}
          onOpenSettings={() => setShowSettings(true)}
        />

        <KeyBrowser
          connection={store.activeConnection}
          selectedDb={store.selectedDb}
          onSelectDb={store.selectDb}
          isRefreshing={store.isLoadingKeys}
          onRefresh={store.refreshKeys}
          keySeparator={store.keySeparator}
          keys={store.keys}
          selectedKey={store.selectedKey}
          onSelectKey={store.selectKey}
          onRenameKey={store.renameKey}
          onRenameGroup={store.renameGroup}
          searchQuery={store.searchQuery}
          onSearchChange={store.setSearchQuery}
        />

        <main className="flex-1 flex flex-col min-w-0 bg-base-300">

          {/* Topbar */}
          <div data-tauri-drag-region className="flex items-center justify-between px-4 h-12 border-b border-base-100/50 shrink-0 select-none">
            <div className="tabs tabs-box tabs-xs bg-base-200 rounded-lg p-0.5">
              <button
                onClick={() => store.setPanelTab("editor")}
                className={`tab gap-1.5 cursor-pointer font-mono text-[11px] rounded-md transition-colors duration-150 ${store.panelTab === "editor" ? "tab-active" : ""}`}
              >
                <Edit3 size={11} /> {messages.app.tabs.editor}
              </button>
              <button
                onClick={() => store.setPanelTab("ai")}
                className={`tab gap-1.5 cursor-pointer font-mono text-[11px] rounded-md transition-colors duration-150 ${store.panelTab === "ai" ? "tab-active" : ""}`}
              >
                <Bot size={11} /> {messages.app.tabs.ai}
              </button>
              <button
                onClick={() => store.setPanelTab("cli")}
                className={`tab gap-1.5 cursor-pointer font-mono text-[11px] rounded-md transition-colors duration-150 ${store.panelTab === "cli" ? "tab-active" : ""}`}
              >
                <Terminal size={11} /> {messages.app.tabs.cli}
              </button>
            </div>

            <div className="flex items-center gap-3">
              {store.activeConnection && (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      store.activeConnection.status === "connected" ? "bg-success" :
                      store.activeConnection.status === "connecting" ? "bg-warning animate-pulse" :
                      "bg-base-content/20"
                    }`} />
                    <span className="text-xs font-mono text-base-content/50">
                      {store.activeConnection.name}
                    </span>
                    <span className="text-xs font-mono text-base-content/30">
                      · db{store.selectedDb}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-base-content/30">
                    <Server size={11} />
                    <span className="text-[10px] font-mono">
                      {store.activeConnection.host}:{store.activeConnection.port}
                    </span>
                  </div>
                  {store.activeConnection.tls && (
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
            {store.panelTab === "editor" && <ValueEditor keyValue={store.keyValue} />}
            {store.panelTab === "ai" && (
              <AIAgent messages={store.chatMessages} onSend={store.sendChatMessage} />
            )}
            {store.panelTab === "cli" && (
              <RedisCLI
                history={store.cliHistory}
                onRun={store.runCliCommand}
                connectionName={
                  store.activeConnection
                    ? `${store.activeConnection.host}:${store.activeConnection.port}`
                    : messages.app.status.notConnected
                }
              />
            )}
          </div>

          <StatusBar store={store} />
        </main>
      </div>

      {store.showConnectionModal && (
        <ConnectionModal
          onClose={store.closeConnectionModal}
          onSave={store.saveConnection}
          connection={store.editingConnection ?? undefined}
        />
      )}
      {showSettings && (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          themeMode={themeMode}
          onThemeChange={setThemeMode}
          keySeparator={store.keySeparator}
          onKeySeparatorChange={store.setKeySeparator}
        />
      )}
    </div>
  );
}

function StatusBar({ store }: { store: ReturnType<typeof useAppStore> }) {
  const { messages, format } = useI18n();

  return (
    <div className="flex items-center justify-between px-4 h-7 border-t border-base-100/50 shrink-0">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <span className="shrink-0 text-[10px] font-mono text-base-content/30">
          {format(messages.app.status.keysCount, { count: store.keys.length })}
        </span>
        {store.selectedKey && (
          <>
            <span className="shrink-0 text-base-content/10">·</span>
            <span
              className="flex min-w-0 items-center gap-1 text-[10px] font-mono text-base-content/40"
              title={store.selectedKey.key}
            >
              <Info size={9} className="shrink-0" />
              <span className="truncate">{store.selectedKey.key}</span>
            </span>
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
