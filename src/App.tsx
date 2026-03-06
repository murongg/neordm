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

function App() {
  const store = useAppStore();
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
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
          onSelectConnection={store.setActiveConnectionId}
          onNewConnection={() => store.setShowConnectionModal(true)}
          panelTab={store.panelTab}
          onSetPanelTab={store.setPanelTab}
          onOpenSettings={() => setShowSettings(true)}
        />

        <KeyBrowser
          connection={store.activeConnection}
          selectedDb={store.selectedDb}
          onSelectDb={store.setSelectedDb}
          keys={store.keys}
          selectedKey={store.selectedKey}
          onSelectKey={store.selectKey}
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
                <Edit3 size={11} /> Editor
              </button>
              <button
                onClick={() => store.setPanelTab("ai")}
                className={`tab gap-1.5 cursor-pointer font-mono text-[11px] rounded-md transition-colors duration-150 ${store.panelTab === "ai" ? "tab-active" : ""}`}
              >
                <Bot size={11} /> AI Agent
              </button>
              <button
                onClick={() => store.setPanelTab("cli")}
                className={`tab gap-1.5 cursor-pointer font-mono text-[11px] rounded-md transition-colors duration-150 ${store.panelTab === "cli" ? "tab-active" : ""}`}
              >
                <Terminal size={11} /> CLI
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
                      <span className="text-[10px] font-mono">TLS</span>
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
                    : "Not connected"
                }
              />
            )}
          </div>

          <StatusBar store={store} />
        </main>
      </div>

      {store.showConnectionModal && (
        <ConnectionModal
          onClose={() => store.setShowConnectionModal(false)}
          onAdd={store.addConnection}
        />
      )}
      {showSettings && (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          themeMode={themeMode}
          onThemeChange={setThemeMode}
        />
      )}
    </div>
  );
}

function StatusBar({ store }: { store: ReturnType<typeof useAppStore> }) {
  return (
    <div className="flex items-center justify-between px-4 h-7 border-t border-base-100/50 shrink-0">
      <div className="flex items-center gap-4">
        <span className="text-[10px] font-mono text-base-content/30">
          {store.keys.length} keys
        </span>
        {store.selectedKey && (
          <>
            <span className="text-base-content/10">·</span>
            <span className="text-[10px] font-mono text-base-content/40 flex items-center gap-1">
              <Info size={9} />
              {store.selectedKey.key}
            </span>
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-mono text-base-content/30">Redis 7.2.3</span>
        <span className="text-[10px] font-mono text-base-content/20">NeoRDM v0.1.0</span>
      </div>
    </div>
  );
}

export default App;
