import { memo, useMemo } from "react";
import { Bot, Edit3, Server, Terminal, Wifi } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useI18n } from "../i18n";
import { useRedisWorkspaceStore } from "../store/useRedisWorkspaceState";

export const WorkspaceTopbarPanel = memo(function WorkspaceTopbarPanel() {
  const { messages } = useI18n();
  const workspace = useRedisWorkspaceStore(
    useShallow((state) => ({
      activeConnectionId: state.activeConnectionId,
      connections: state.connections,
      panelTab: state.panelTab,
      selectedDb: state.selectedDb,
      setPanelTab: state.setPanelTab,
    }))
  );
  const activeConnection = useMemo(
    () =>
      workspace.connections.find(
        (connection) => connection.id === workspace.activeConnectionId
      ),
    [workspace.activeConnectionId, workspace.connections]
  );

  return (
    <div
      data-tauri-drag-region
      className="flex items-center justify-between px-4 h-12 border-b border-base-100/50 shrink-0 select-none"
    >
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
        {activeConnection && (
          <>
            <div className="flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  activeConnection.status === "connected"
                    ? "bg-success"
                    : activeConnection.status === "connecting"
                    ? "bg-warning animate-pulse"
                    : "bg-base-content/20"
                }`}
              />
              <span className="text-xs font-mono text-base-content/50">
                {activeConnection.name}
              </span>
              <span className="text-xs font-mono text-base-content/30">
                · db{workspace.selectedDb}
              </span>
            </div>
            <div className="flex items-center gap-1 text-base-content/30">
              <Server size={11} />
              <span className="text-[10px] font-mono">
                {activeConnection.host}:{activeConnection.port}
              </span>
            </div>
            {activeConnection.tls && (
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
  );
});
