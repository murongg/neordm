import { useState } from "react";
import {
  Database,
  Plus,
  Settings,
  Wifi,
  WifiOff,
  Loader,
  AlertCircle,
  Bot,
  Terminal,
} from "lucide-react";
import type { RedisConnection, PanelTab } from "../types";
import { useI18n } from "../i18n";

interface SidebarProps {
  connections: RedisConnection[];
  activeConnectionId: string;
  onSelectConnection: (id: string) => void;
  onNewConnection: () => void;
  panelTab: PanelTab;
  onSetPanelTab: (tab: PanelTab) => void;
  onOpenSettings: () => void;
}

const STATUS_ICONS = {
  connected: <Wifi size={10} className="text-success" />,
  disconnected: <WifiOff size={10} className="text-base-content/30" />,
  connecting: <Loader size={10} className="text-warning animate-spin" />,
  error: <AlertCircle size={10} className="text-error" />,
};

export function Sidebar({
  connections,
  activeConnectionId,
  onSelectConnection,
  onNewConnection,
  panelTab,
  onSetPanelTab,
  onOpenSettings,
}: SidebarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const { messages } = useI18n();

  return (
    <aside className="flex flex-col w-14 bg-base-300 border-r border-base-100/50 h-full z-10">
      {/* Logo */}
      <div data-tauri-drag-region className="flex items-center justify-center h-12 border-b border-base-100/50 shrink-0 select-none">
        <div className="w-7 h-7 rounded-lg bg-success/20 flex items-center justify-center">
          <Database size={15} className="text-success" />
        </div>
      </div>

      {/* Connection dots */}
      <div className="flex flex-col items-center gap-1.5 py-3 flex-1 overflow-y-auto">
        {connections.map((conn) => (
          <div key={conn.id} className="relative group">
            <button
              onClick={() => onSelectConnection(conn.id)}
              onMouseEnter={() => setHoveredId(conn.id)}
              onMouseLeave={() => setHoveredId(null)}
              className={`
                w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer
                transition-all duration-200 relative
                ${
                  activeConnectionId === conn.id
                    ? "bg-base-100 shadow-lg scale-110"
                    : "hover:bg-base-100/50 hover:scale-105"
                }
              `}
              aria-label={conn.name}
            >
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: conn.color }}
              />
              <div className="absolute -bottom-0.5 -right-0.5">
                {STATUS_ICONS[conn.status]}
              </div>
            </button>
            {/* Tooltip */}
            {hoveredId === conn.id && (
              <div className="absolute left-12 top-1/2 -translate-y-1/2 z-50 pointer-events-none">
                <div className="bg-base-100 border border-base-content/10 rounded-lg px-2.5 py-1.5 shadow-xl whitespace-nowrap">
                  <p className="text-xs font-medium font-mono">{conn.name}</p>
                  <p className="text-[10px] text-base-content/50">
                    {conn.host}:{conn.port}
                  </p>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Add connection */}
        <button
          onClick={onNewConnection}
          className="w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer hover:bg-base-100/50 transition-all duration-200 text-base-content/30 hover:text-success border border-dashed border-base-content/20 hover:border-success/50"
          aria-label={messages.sidebar.newConnection}
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Bottom actions */}
      <div className="flex flex-col items-center gap-1.5 py-3 border-t border-base-100/50">
        <button
          onClick={() => onSetPanelTab("cli")}
          className={`w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer transition-all duration-200 ${
            panelTab === "cli"
              ? "bg-success/20 text-success"
              : "text-base-content/40 hover:bg-base-100/50 hover:text-base-content"
          }`}
          aria-label={messages.sidebar.cli}
        >
          <Terminal size={15} />
        </button>
        <button
          onClick={() => onSetPanelTab("ai")}
          className={`w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer transition-all duration-200 ${
            panelTab === "ai"
              ? "bg-success/20 text-success"
              : "text-base-content/40 hover:bg-base-100/50 hover:text-base-content"
          }`}
          aria-label={messages.sidebar.aiAgent}
        >
          <Bot size={15} />
        </button>
        <button
          onClick={onOpenSettings}
          className="w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer transition-all duration-200 text-base-content/40 hover:bg-base-100/50 hover:text-base-content"
          aria-label={messages.sidebar.settings}
        >
          <Settings size={15} />
        </button>
      </div>
    </aside>
  );
}
