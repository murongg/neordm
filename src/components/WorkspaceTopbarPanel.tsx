import { memo, useMemo } from "react";
import {
  Bot,
  ChartNoAxesCombined,
  Clock3,
  Edit3,
  Rss,
  Search,
  Server,
  Terminal,
  Wifi,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useI18n } from "../i18n";
import { prepareAIAgentExperience } from "../lib/aiPrefetch";
import { getRedisConnectionEndpointLabel } from "../lib/redisConnection";
import { useRedisWorkspaceStore } from "../store/useRedisWorkspaceState";

interface WorkspaceTopbarPanelProps {
  onOpenCommandPalette: () => void;
}

function getCommandPaletteShortcutLabel() {
  if (typeof navigator === "undefined") {
    return "Ctrl K";
  }

  return /mac/i.test(navigator.platform || navigator.userAgent)
    ? "Cmd K"
    : "Ctrl K";
}

export const WorkspaceTopbarPanel = memo(function WorkspaceTopbarPanel({
  onOpenCommandPalette,
}: WorkspaceTopbarPanelProps) {
  const { messages } = useI18n();
  const shortcutLabel = useMemo(() => getCommandPaletteShortcutLabel(), []);
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
          onClick={() => workspace.setPanelTab("overview")}
          className={`tab gap-1.5 cursor-pointer font-mono text-[11px] rounded-md transition-colors duration-150 ${workspace.panelTab === "overview" ? "tab-active" : ""}`}
        >
          <ChartNoAxesCombined size={11} /> {messages.app.tabs.overview}
        </button>
        <button
          onClick={() => workspace.setPanelTab("editor")}
          className={`tab gap-1.5 cursor-pointer font-mono text-[11px] rounded-md transition-colors duration-150 ${workspace.panelTab === "editor" ? "tab-active" : ""}`}
        >
          <Edit3 size={11} /> {messages.app.tabs.editor}
        </button>
        <button
          onMouseEnter={() => {
            void prepareAIAgentExperience().catch(() => {});
          }}
          onFocus={() => {
            void prepareAIAgentExperience().catch(() => {});
          }}
          onClick={() => {
            void prepareAIAgentExperience().catch(() => {});
            workspace.setPanelTab("ai");
          }}
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
        <button
          onClick={() => workspace.setPanelTab("pubsub")}
          className={`tab gap-1.5 cursor-pointer font-mono text-[11px] rounded-md transition-colors duration-150 ${workspace.panelTab === "pubsub" ? "tab-active" : ""}`}
        >
          <Rss size={11} /> {messages.app.tabs.pubsub}
        </button>
        <button
          onClick={() => workspace.setPanelTab("slowlog")}
          className={`tab gap-1.5 cursor-pointer font-mono text-[11px] rounded-md transition-colors duration-150 ${workspace.panelTab === "slowlog" ? "tab-active" : ""}`}
        >
          <Clock3 size={11} /> {messages.app.tabs.slowlog}
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="btn btn-ghost btn-xs h-7 gap-1 rounded-lg px-2 font-mono text-[10px] text-base-content/55"
          title={shortcutLabel}
        >
          <Search size={11} />
          <span>{shortcutLabel}</span>
        </button>
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
                {getRedisConnectionEndpointLabel(activeConnection)}
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
