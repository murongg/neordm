import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
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
  Pencil,
  Trash2,
} from "lucide-react";
import type { RedisConnection, PanelTab } from "../types";
import { useI18n } from "../i18n";

interface SidebarProps {
  connections: RedisConnection[];
  activeConnectionId: string;
  onSelectConnection: (id: string) => void;
  onNewConnection: () => void;
  onEditConnection: (id: string) => void;
  onDeleteConnection: (id: string) => void;
  panelTab: PanelTab;
  onSetPanelTab: (tab: PanelTab) => void;
  onOpenSettings: () => void;
}

interface ContextMenuState {
  connectionId: string;
  x: number;
  y: number;
}

interface AnimatedConnectionItem {
  connection: RedisConnection;
  phase: "entering" | "idle" | "exiting";
}

const CONTEXT_MENU_TRANSITION_MS = 140;
const CONNECTION_ITEM_TRANSITION_MS = 180;
const CONNECTION_ITEM_SPACING = 2;
const CONNECTION_ITEM_HEIGHT = 48;
const STATUS_TRANSITION_MS = 160;

const STATUS_ICONS = {
  connected: <Wifi size={10} className="text-success" />,
  disconnected: <WifiOff size={10} className="text-base-content/30" />,
  connecting: <Loader size={10} className="text-warning animate-spin" />,
  error: <AlertCircle size={10} className="text-error" />,
};

const STATUS_BADGE_CLASSES: Record<RedisConnection["status"], string> = {
  connected: "bg-success/12 shadow-[0_0_0_1px_rgba(34,197,94,0.12)]",
  disconnected: "bg-base-200/90 shadow-[0_0_0_1px_rgba(148,163,184,0.08)]",
  connecting: "bg-warning/12 shadow-[0_0_0_1px_rgba(245,158,11,0.12)]",
  error: "bg-error/12 shadow-[0_0_0_1px_rgba(239,68,68,0.12)]",
};

function toAnimatedConnections(
  connections: RedisConnection[]
): AnimatedConnectionItem[] {
  return connections.map((connection) => ({
    connection,
    phase: "idle",
  }));
}

function ConnectionStatusBadge({
  status,
}: {
  status: RedisConnection["status"];
}) {
  const [displayStatus, setDisplayStatus] = useState(status);
  const [isVisible, setIsVisible] = useState(true);
  const statusEnterFrameRef = useRef<number | null>(null);
  const statusSwapTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (status === displayStatus) return;

    if (statusEnterFrameRef.current !== null) {
      window.cancelAnimationFrame(statusEnterFrameRef.current);
      statusEnterFrameRef.current = null;
    }

    if (statusSwapTimerRef.current !== null) {
      window.clearTimeout(statusSwapTimerRef.current);
      statusSwapTimerRef.current = null;
    }

    setIsVisible(false);
    statusSwapTimerRef.current = window.setTimeout(() => {
      statusSwapTimerRef.current = null;
      setDisplayStatus(status);
      statusEnterFrameRef.current = window.requestAnimationFrame(() => {
        statusEnterFrameRef.current = null;
        setIsVisible(true);
      });
    }, STATUS_TRANSITION_MS / 2);
  }, [displayStatus, status]);

  useEffect(() => {
    return () => {
      if (statusEnterFrameRef.current !== null) {
        window.cancelAnimationFrame(statusEnterFrameRef.current);
      }

      if (statusSwapTimerRef.current !== null) {
        window.clearTimeout(statusSwapTimerRef.current);
      }
    };
  }, []);

  return (
    <span
      className={`absolute -bottom-0.5 -right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full ring-1 ring-base-300/90 backdrop-blur-sm transition-[opacity,transform,background-color,box-shadow] duration-150 ease-out motion-reduce:transition-none ${
        STATUS_BADGE_CLASSES[displayStatus]
      } ${isVisible ? "scale-100 opacity-100" : "scale-75 opacity-0"}`}
    >
      {STATUS_ICONS[displayStatus]}
    </span>
  );
}

export function Sidebar({
  connections,
  activeConnectionId,
  onSelectConnection,
  onNewConnection,
  onEditConnection,
  onDeleteConnection,
  panelTab,
  onSetPanelTab,
  onOpenSettings,
}: SidebarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renderedContextMenu, setRenderedContextMenu] =
    useState<ContextMenuState | null>(null);
  const [isContextMenuVisible, setIsContextMenuVisible] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null
  );
  const [renderedConnections, setRenderedConnections] = useState<
    AnimatedConnectionItem[]
  >(() => toAnimatedConnections(connections));
  const [activeIndicatorRect, setActiveIndicatorRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const connectionButtonRefs = useRef<Record<string, HTMLButtonElement | null>>(
    {}
  );
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const contextMenuEnterFrameRef = useRef<number | null>(null);
  const contextMenuCloseTimerRef = useRef<number | null>(null);
  const listEnterFrameRef = useRef<number | null>(null);
  const listCleanupTimerRef = useRef<number | null>(null);

  const { messages } = useI18n();
  const contextConnection =
    connections.find(
      (connection) => connection.id === renderedContextMenu?.connectionId
    ) ?? null;
  const isConfirmingDelete = confirmingDeleteId === contextConnection?.id;
  const hasActiveConnection = renderedConnections.some(
    (item) =>
      item.connection.id === activeConnectionId && item.phase !== "exiting"
  );

  const updateActiveIndicatorPosition = useCallback(() => {
    const listContainer = listContainerRef.current;
    const activeButton = connectionButtonRefs.current[activeConnectionId];

    if (!listContainer || !activeButton || !hasActiveConnection) {
      setActiveIndicatorRect(null);
      return;
    }

    const containerRect = listContainer.getBoundingClientRect();
    const buttonRect = activeButton.getBoundingClientRect();

    setActiveIndicatorRect({
      x: buttonRect.left - containerRect.left + listContainer.scrollLeft,
      y: buttonRect.top - containerRect.top + listContainer.scrollTop,
      width: buttonRect.width,
      height: buttonRect.height,
    });
  }, [activeConnectionId, hasActiveConnection]);

  const closeContextMenu = useCallback(() => {
    setConfirmingDeleteId(null);
    setContextMenu(null);

    if (!renderedContextMenu) return;
    if (contextMenuCloseTimerRef.current !== null) return;

    setIsContextMenuVisible(false);
    contextMenuCloseTimerRef.current = window.setTimeout(() => {
      contextMenuCloseTimerRef.current = null;
      setRenderedContextMenu(null);
    }, CONTEXT_MENU_TRANSITION_MS);
  }, [renderedContextMenu]);

  useEffect(() => {
    setRenderedConnections((previous) => {
      const previousMap = new Map(
        previous.map((item) => [item.connection.id, item])
      );
      const nextIds = new Set(connections.map((connection) => connection.id));
      const nextItems: AnimatedConnectionItem[] = connections.map((connection) => {
        const previousItem = previousMap.get(connection.id);

        if (!previousItem) {
          return {
            connection,
            phase:
              connection.id === activeConnectionId ? ("idle" as const) : ("entering" as const),
          };
        }

        return {
          connection,
          phase: previousItem.phase === "exiting" ? "idle" : previousItem.phase,
        };
      });

      const exitingItems = previous
        .filter((item) => !nextIds.has(item.connection.id))
        .map((item) => ({
          connection: item.connection,
          phase: "exiting" as const,
        }));

      if (!exitingItems.length) {
        return nextItems;
      }

      const mergedItems = [...nextItems];

      exitingItems.forEach((item) => {
        const previousIndex = previous.findIndex(
          (previousItem) => previousItem.connection.id === item.connection.id
        );
        const insertIndex = Math.min(previousIndex, mergedItems.length);
        mergedItems.splice(insertIndex, 0, item);
      });

      return mergedItems;
    });
  }, [activeConnectionId, connections]);

  useEffect(() => {
    const hasEnteringItems = renderedConnections.some(
      (item) => item.phase === "entering"
    );

    if (!hasEnteringItems) return;

    if (listEnterFrameRef.current !== null) {
      window.cancelAnimationFrame(listEnterFrameRef.current);
    }

    listEnterFrameRef.current = window.requestAnimationFrame(() => {
      listEnterFrameRef.current = null;
      setRenderedConnections((previous) =>
        previous.map((item) =>
          item.phase === "entering" ? { ...item, phase: "idle" } : item
        )
      );
    });

    return () => {
      if (listEnterFrameRef.current !== null) {
        window.cancelAnimationFrame(listEnterFrameRef.current);
        listEnterFrameRef.current = null;
      }
    };
  }, [renderedConnections]);

  useEffect(() => {
    const hasExitingItems = renderedConnections.some(
      (item) => item.phase === "exiting"
    );

    if (!hasExitingItems) {
      if (listCleanupTimerRef.current !== null) {
        window.clearTimeout(listCleanupTimerRef.current);
        listCleanupTimerRef.current = null;
      }
      return;
    }

    if (listCleanupTimerRef.current !== null) {
      window.clearTimeout(listCleanupTimerRef.current);
    }

    listCleanupTimerRef.current = window.setTimeout(() => {
      listCleanupTimerRef.current = null;
      setRenderedConnections((previous) =>
        previous.filter((item) => item.phase !== "exiting")
      );
    }, CONNECTION_ITEM_TRANSITION_MS);

    return () => {
      if (listCleanupTimerRef.current !== null) {
        window.clearTimeout(listCleanupTimerRef.current);
        listCleanupTimerRef.current = null;
      }
    };
  }, [renderedConnections]);

  useEffect(() => {
    if (hoveredId && !renderedConnections.some((item) => item.connection.id === hoveredId)) {
      setHoveredId(null);
    }
  }, [hoveredId, renderedConnections]);

  useLayoutEffect(() => {
    updateActiveIndicatorPosition();
  }, [activeConnectionId, renderedConnections, updateActiveIndicatorPosition]);

  useEffect(() => {
    const listContainer = listContainerRef.current;
    const activeButton = connectionButtonRefs.current[activeConnectionId];

    if (!listContainer) return;

    const handleScroll = () => updateActiveIndicatorPosition();
    const handleResize = () => updateActiveIndicatorPosition();
    const handleTransitionComplete = (event: TransitionEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      if (!event.target.dataset.connectionItem) return;
      if (
        event.propertyName !== "max-height" &&
        event.propertyName !== "margin-bottom"
      ) {
        return;
      }

      window.requestAnimationFrame(() => {
        updateActiveIndicatorPosition();
      });
    };
    const resizeObserver = new ResizeObserver(() => {
      updateActiveIndicatorPosition();
    });

    listContainer.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize);
    listContainer.addEventListener("transitionend", handleTransitionComplete);
    listContainer.addEventListener("transitioncancel", handleTransitionComplete);
    resizeObserver.observe(listContainer);

    if (activeButton) {
      resizeObserver.observe(activeButton);
    }

    return () => {
      listContainer.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
      listContainer.removeEventListener("transitionend", handleTransitionComplete);
      listContainer.removeEventListener(
        "transitioncancel",
        handleTransitionComplete
      );
      resizeObserver.disconnect();
    };
  }, [activeConnectionId, updateActiveIndicatorPosition]);

  useEffect(() => {
    if (!contextMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return;
      closeContextMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeContextMenu, contextMenu]);

  useEffect(() => {
    return () => {
      if (contextMenuEnterFrameRef.current !== null) {
        window.cancelAnimationFrame(contextMenuEnterFrameRef.current);
      }

      if (contextMenuCloseTimerRef.current !== null) {
        window.clearTimeout(contextMenuCloseTimerRef.current);
      }

      if (listEnterFrameRef.current !== null) {
        window.cancelAnimationFrame(listEnterFrameRef.current);
      }

      if (listCleanupTimerRef.current !== null) {
        window.clearTimeout(listCleanupTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!renderedContextMenu || contextConnection) return;
    closeContextMenu();
  }, [closeContextMenu, contextConnection, renderedContextMenu]);

  const openContextMenu = (
    event: MouseEvent<HTMLButtonElement>,
    connectionId: string
  ) => {
    event.preventDefault();
    setHoveredId(null);

    const menuWidth = 168;
    const menuHeight = 132;
    const padding = 8;
    const nextContextMenu = {
      connectionId,
      x: Math.max(
        padding,
        Math.min(event.clientX, window.innerWidth - menuWidth - padding)
      ),
      y: Math.max(
        padding,
        Math.min(event.clientY, window.innerHeight - menuHeight - padding)
      ),
    };

    setConfirmingDeleteId(null);
    setContextMenu(nextContextMenu);
    setRenderedContextMenu(nextContextMenu);

    if (contextMenuCloseTimerRef.current !== null) {
      window.clearTimeout(contextMenuCloseTimerRef.current);
      contextMenuCloseTimerRef.current = null;
    }

    if (contextMenuEnterFrameRef.current !== null) {
      window.cancelAnimationFrame(contextMenuEnterFrameRef.current);
    }

    setIsContextMenuVisible(false);
    contextMenuEnterFrameRef.current = window.requestAnimationFrame(() => {
      contextMenuEnterFrameRef.current = null;
      setIsContextMenuVisible(true);
    });
  };

  return (
    <aside className="flex flex-col w-14 bg-base-300 border-r border-base-100/50 h-full z-10">
      <div
        data-tauri-drag-region
        className="flex items-center justify-center h-12 border-b border-base-100/50 shrink-0 select-none"
      >
        <div className="w-7 h-7 rounded-lg bg-success/20 flex items-center justify-center">
          <Database size={15} className="text-success" />
        </div>
      </div>

      <div
        ref={listContainerRef}
        className="relative flex flex-col items-center py-3 flex-1 overflow-y-auto"
      >
        {activeIndicatorRect && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-0 z-0 rounded-xl bg-base-100 ring-1 ring-base-content/6 shadow-[0_10px_24px_-16px_rgb(0_0_0_/_0.45)] will-change-transform transition-transform duration-300 ease-linear motion-reduce:transition-none"
            style={{
              width: activeIndicatorRect.width,
              height: activeIndicatorRect.height,
              transform: `translate3d(${activeIndicatorRect.x}px, ${activeIndicatorRect.y}px, 0)`,
            }}
          />
        )}

        {renderedConnections.map((item) => {
          const conn = item.connection;
          const isActive = activeConnectionId === conn.id;
          const shouldCollapseLayout =
            item.phase === "exiting" || (item.phase === "entering" && !isActive);
          const isTransitioning = item.phase !== "idle";

          return (
            <div
              key={conn.id}
              data-connection-item="true"
              className="w-full flex justify-center overflow-hidden transition-[max-height,margin-bottom,opacity,transform] duration-200 ease-out motion-reduce:transition-none"
              style={{
                maxHeight: shouldCollapseLayout ? 0 : CONNECTION_ITEM_HEIGHT,
                marginBottom: shouldCollapseLayout ? 0 : CONNECTION_ITEM_SPACING,
                opacity: isTransitioning ? 0 : 1,
                transform: isTransitioning
                  ? "translateY(-4px) scale(0.96)"
                  : "translateY(0) scale(1)",
              }}
            >
              <div className="relative z-10 group flex items-center justify-center py-1.5">
                <button
                  ref={(element) => {
                    connectionButtonRefs.current[conn.id] = element;
                  }}
                  onClick={() => onSelectConnection(conn.id)}
                  onContextMenu={(event) => openContextMenu(event, conn.id)}
                  onMouseEnter={() => setHoveredId(conn.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  title={conn.name}
                  aria-haspopup="menu"
                  aria-expanded={contextMenu?.connectionId === conn.id}
                  className={`
                    w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer
                    transition-all duration-200 relative
                    ${
                      isActive
                        ? "scale-[1.03]"
                        : "hover:bg-base-100/50 hover:scale-105"
                    }
                  `}
                  aria-label={conn.name}
                >
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: conn.color }}
                  />
                  <ConnectionStatusBadge status={conn.status} />
                </button>

                {hoveredId === conn.id &&
                  renderedContextMenu?.connectionId !== conn.id && (
                    <div className="absolute left-12 top-1/2 -translate-y-1/2 z-50 pointer-events-none">
                      <div className="bg-base-100 border border-base-content/10 rounded-lg px-2.5 py-1.5 shadow-xl whitespace-nowrap">
                        <p className="text-xs font-medium font-mono">
                          {conn.name}
                        </p>
                      </div>
                    </div>
                  )}
              </div>
            </div>
          );
        })}

        <button
          onClick={onNewConnection}
          className="w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer hover:bg-base-100/50 transition-all duration-200 text-base-content/30 hover:text-success border border-dashed border-base-content/20 hover:border-success/50"
          aria-label={messages.sidebar.newConnection}
        >
          <Plus size={14} />
        </button>
      </div>

      {renderedContextMenu && contextConnection && (
        <div
          ref={contextMenuRef}
          role="menu"
          style={{ left: renderedContextMenu.x, top: renderedContextMenu.y }}
          className={`fixed z-[70] min-w-36 rounded-xl border border-base-content/10 bg-base-200 p-1.5 shadow-2xl origin-top-left transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none ${
            isContextMenuVisible
              ? "translate-y-0 scale-100 opacity-100"
              : "-translate-y-1 scale-95 opacity-0 pointer-events-none"
          }`}
        >
          <button
            role="menuitem"
            onClick={() => {
              setConfirmingDeleteId(null);
              onEditConnection(contextConnection.id);
              closeContextMenu();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-mono text-base-content/80 transition-colors duration-150 hover:bg-base-100 cursor-pointer"
          >
            <Pencil size={12} />
            {messages.common.edit}
          </button>

          {!isConfirmingDelete ? (
            <button
              role="menuitem"
              onClick={() => setConfirmingDeleteId(contextConnection.id)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-mono text-error transition-colors duration-150 hover:bg-error/10 cursor-pointer"
            >
              <Trash2 size={12} />
              {messages.common.delete}
            </button>
          ) : (
            <div className="mt-1 rounded-lg bg-error/8 px-2.5 py-2">
              <p className="truncate text-[11px] font-mono text-error/80">
                {contextConnection.name}
              </p>
              <div className="mt-2 flex gap-1.5">
                <button
                  role="menuitem"
                  onClick={() => setConfirmingDeleteId(null)}
                  className="flex-1 rounded-md px-2 py-1.5 text-[11px] font-mono text-base-content/70 transition-colors duration-150 hover:bg-base-100 cursor-pointer"
                >
                  {messages.common.cancel}
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    onDeleteConnection(contextConnection.id);
                    closeContextMenu();
                  }}
                  className="flex-1 rounded-md bg-error/12 px-2 py-1.5 text-[11px] font-mono text-error transition-colors duration-150 hover:bg-error/18 cursor-pointer"
                >
                  {messages.common.delete}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

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
