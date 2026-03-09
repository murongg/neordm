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
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import type { RedisConnection, PanelTab } from "../types";
import { useI18n } from "../i18n";
import { prepareAIAgentExperience } from "../lib/aiPrefetch";

interface SidebarProps {
  connections: RedisConnection[];
  activeConnectionId: string;
  isCollapsed: boolean;
  confirmBeforeDelete: boolean;
  onSelectConnection: (id: string) => void;
  onNewConnection: () => void;
  onEditConnection: (id: string) => void;
  onDisconnectConnection: (id: string) => void;
  onDeleteConnection: (id: string) => void;
  panelTab: PanelTab;
  onSetPanelTab: (tab: PanelTab) => void;
  onToggleCollapsed: () => void;
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
  onDisconnect,
  onContextMenu,
  disconnectLabel,
  onShowTooltip,
  onHideTooltip,
  placement = "overlay",
}: {
  status: RedisConnection["status"];
  onDisconnect?: () => void;
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
  disconnectLabel?: string;
  onShowTooltip?: (target: HTMLElement, content: string) => void;
  onHideTooltip?: () => void;
  placement?: "overlay" | "inline" | "row-end";
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

  const placementClassName =
    placement === "inline"
      ? "relative shrink-0"
      : placement === "row-end"
      ? "absolute right-3 top-1/2 -translate-y-1/2"
      : "absolute -bottom-0.5 -right-0.5";
  const badgeClassName = `${placementClassName} grid h-3.5 w-3.5 place-items-center rounded-full ring-1 ring-base-300/90 backdrop-blur-sm transition-[opacity,transform,background-color,box-shadow] duration-150 ease-out motion-reduce:transition-none ${
    STATUS_BADGE_CLASSES[displayStatus]
  } ${isVisible ? "scale-100 opacity-100" : "scale-75 opacity-0"}`;

  if (displayStatus === "connected" && onDisconnect) {
    return (
      <button
        type="button"
        onClick={onDisconnect}
        onContextMenu={onContextMenu}
        onMouseEnter={(event) => {
          if (disconnectLabel) {
            onShowTooltip?.(event.currentTarget, disconnectLabel);
          }
        }}
        onMouseLeave={onHideTooltip}
        onFocus={(event) => {
          if (disconnectLabel) {
            onShowTooltip?.(event.currentTarget, disconnectLabel);
          }
        }}
        onBlur={onHideTooltip}
        className={`${badgeClassName} cursor-pointer hover:scale-105 hover:bg-success/18 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-success`}
        aria-label={disconnectLabel}
      >
        {STATUS_ICONS[displayStatus]}
      </button>
    );
  }

  return (
    <span
      className={badgeClassName}
    >
      {STATUS_ICONS[displayStatus]}
    </span>
  );
}

export function Sidebar({
  connections,
  activeConnectionId,
  isCollapsed,
  confirmBeforeDelete,
  onSelectConnection,
  onNewConnection,
  onEditConnection,
  onDisconnectConnection,
  onDeleteConnection,
  panelTab,
  onSetPanelTab,
  onToggleCollapsed,
  onOpenSettings,
}: SidebarProps) {
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
  const [sidebarTooltip, setSidebarTooltip] = useState<{
    content: string;
    x: number;
    y: number;
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
  const showDisconnectContextConnection =
    contextConnection?.status === "connected";
  const hasActiveConnection = renderedConnections.some(
    (item) =>
      item.connection.id === activeConnectionId && item.phase !== "exiting"
  );

  const showSidebarTooltip = useCallback(
    (target: HTMLElement, content: string) => {
      const rect = target.getBoundingClientRect();

      setSidebarTooltip({
        content,
        x: rect.right + 12,
        y: rect.top + rect.height / 2,
      });
    },
    []
  );

  const hideSidebarTooltip = useCallback(() => {
    setSidebarTooltip(null);
  }, []);

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

  useEffect(() => {
    setSidebarTooltip(null);
  }, [isCollapsed]);

  const closeContextMenu = useCallback(() => {
    setConfirmingDeleteId(null);

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

  useLayoutEffect(() => {
    updateActiveIndicatorPosition();
  }, [
    activeConnectionId,
    isCollapsed,
    renderedConnections,
    updateActiveIndicatorPosition,
  ]);

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
  }, [activeConnectionId, isCollapsed, updateActiveIndicatorPosition]);

  useLayoutEffect(() => {
    if (!renderedContextMenu) return;

    const handleMouseDown = (event: globalThis.MouseEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return;
      closeContextMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    };

    document.addEventListener("mousedown", handleMouseDown, true);
    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [closeContextMenu, renderedContextMenu]);

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
    event: MouseEvent<HTMLElement>,
    connectionId: string
  ) => {
    event.preventDefault();
    hideSidebarTooltip();

    const menuWidth = 168;
    const menuHeight = 176;
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
    <aside
      className={`relative z-20 flex h-full flex-col border-r border-base-100/50 bg-base-300 transition-[width] duration-200 ease-linear motion-reduce:transition-none ${
        isCollapsed ? "w-14" : "w-[13.5rem]"
      }`}
    >
      {sidebarTooltip ? (
        <div
          className="pointer-events-none fixed z-[140] -translate-y-1/2"
          style={{
            left: sidebarTooltip.x,
            top: sidebarTooltip.y,
          }}
        >
          <div className="rounded-lg border border-base-content/10 bg-base-100 px-2.5 py-1.5 text-[11px] font-mono leading-snug text-base-content shadow-lg">
            {sidebarTooltip.content}
          </div>
        </div>
      ) : null}

      <div className="relative h-12 shrink-0 border-b border-base-100/50">
        <div
          data-tauri-drag-region
          className="absolute inset-0 select-none"
        />
        <div
          className={`relative z-10 flex h-full items-center ${
            isCollapsed ? "justify-center" : "px-3.5"
          }`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/20">
              <Database size={15} className="text-primary" />
            </div>
            {!isCollapsed ? (
              <span className="truncate text-[11px] font-mono uppercase tracking-[0.18em] text-base-content/50">
                NeoRDM
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div
        ref={listContainerRef}
        className={`relative flex flex-1 flex-col overflow-y-auto py-3 ${
          isCollapsed ? "items-center" : "px-2.5"
        }`}
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
              className="w-full flex justify-center overflow-y-hidden overflow-x-visible transition-[max-height,margin-bottom,opacity,transform] duration-200 ease-out motion-reduce:transition-none"
              style={{
                maxHeight: shouldCollapseLayout ? 0 : CONNECTION_ITEM_HEIGHT,
                marginBottom: shouldCollapseLayout ? 0 : CONNECTION_ITEM_SPACING,
                opacity: isTransitioning ? 0 : 1,
                transform: isTransitioning
                  ? "translateY(-4px) scale(0.96)"
                  : "translateY(0) scale(1)",
              }}
            >
              <div
                className={`relative z-10 group flex items-center py-1.5 ${
                  isCollapsed ? "justify-center" : "w-full"
                }`}
              >
                <button
                  ref={(element) => {
                    connectionButtonRefs.current[conn.id] = element;
                  }}
                  onClick={() => onSelectConnection(conn.id)}
                  onContextMenu={(event) => openContextMenu(event, conn.id)}
                  onMouseEnter={(event) => {
                    if (isCollapsed) {
                      showSidebarTooltip(event.currentTarget, conn.name);
                    }
                  }}
                  onMouseLeave={hideSidebarTooltip}
                  onFocus={(event) => {
                    if (isCollapsed) {
                      showSidebarTooltip(event.currentTarget, conn.name);
                    }
                  }}
                  onBlur={hideSidebarTooltip}
                  aria-haspopup="menu"
                  aria-expanded={renderedContextMenu?.connectionId === conn.id}
                  className={`
                    relative flex items-center rounded-xl cursor-pointer
                    transition-[background-color,color,transform,box-shadow] duration-150
                    ${
                      isCollapsed
                        ? "h-9 w-9 justify-center"
                        : "h-10 w-full min-w-0 justify-start gap-3 px-3 pr-10 text-left"
                    }
                    ${
                      isActive
                        ? "text-base-content"
                        : "text-base-content/72 hover:bg-base-100/56 hover:text-base-content"
                    }
                  `}
                  aria-label={conn.name}
                >
                  <div
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: conn.color }}
                  />
                  {!isCollapsed ? (
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-mono">
                        {conn.name}
                      </div>
                    </div>
                  ) : null}
                </button>

                {isCollapsed ? (
                  <ConnectionStatusBadge
                    status={conn.status}
                    onDisconnect={() => onDisconnectConnection(conn.id)}
                    onContextMenu={(event) => openContextMenu(event, conn.id)}
                    disconnectLabel={messages.common.disconnect}
                    onShowTooltip={showSidebarTooltip}
                    onHideTooltip={hideSidebarTooltip}
                  />
                ) : (
                  <ConnectionStatusBadge
                    status={conn.status}
                    placement="row-end"
                    onDisconnect={() => onDisconnectConnection(conn.id)}
                    onContextMenu={(event) => openContextMenu(event, conn.id)}
                  />
                )}
              </div>
            </div>
          );
        })}

        <button
          onClick={onNewConnection}
          onMouseEnter={(event) => {
            if (isCollapsed) {
              showSidebarTooltip(event.currentTarget, messages.sidebar.newConnection);
            }
          }}
          onMouseLeave={hideSidebarTooltip}
          onFocus={(event) => {
            if (isCollapsed) {
              showSidebarTooltip(event.currentTarget, messages.sidebar.newConnection);
            }
          }}
          onBlur={hideSidebarTooltip}
          className={`rounded-xl border border-dashed border-base-content/20 text-base-content/30 transition-all duration-200 hover:border-primary/50 hover:bg-base-100/50 hover:text-primary cursor-pointer ${
            isCollapsed
              ? "flex h-9 w-9 items-center justify-center"
              : "mt-1 flex h-10 w-full items-center gap-3 px-3"
          }`}
          aria-label={messages.sidebar.newConnection}
        >
          <Plus size={14} />
          {!isCollapsed ? (
            <span className="truncate text-xs font-mono">
              {messages.sidebar.newConnection}
            </span>
          ) : null}
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
              onClick={() => {
                if (!confirmBeforeDelete) {
                  onDeleteConnection(contextConnection.id);
                  closeContextMenu();
                  return;
                }

                setConfirmingDeleteId(contextConnection.id);
              }}
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

          {showDisconnectContextConnection ? (
            <button
              role="menuitem"
              onClick={() => {
                onDisconnectConnection(contextConnection.id);
                closeContextMenu();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-mono text-base-content/80 transition-colors duration-150 hover:bg-base-100 cursor-pointer"
            >
              <WifiOff size={12} />
              {messages.common.disconnect}
            </button>
          ) : null}
        </div>
      )}

      <div
        className={`border-t border-base-100/50 py-3 ${
          isCollapsed
            ? "flex flex-col items-center gap-1.5"
            : "flex flex-col gap-1.5 px-2"
        }`}
      >
        <button
          onClick={() => onSetPanelTab("cli")}
          onMouseEnter={(event) => {
            if (isCollapsed) {
              showSidebarTooltip(event.currentTarget, messages.sidebar.cli);
            }
          }}
          onMouseLeave={hideSidebarTooltip}
          onFocus={(event) => {
            if (isCollapsed) {
              showSidebarTooltip(event.currentTarget, messages.sidebar.cli);
            }
          }}
          onBlur={hideSidebarTooltip}
          className={`rounded-xl cursor-pointer transition-[background-color,color] duration-150 ${
            isCollapsed
              ? "flex h-9 w-9 items-center justify-center"
              : "flex h-10 w-full items-center gap-3 px-3"
          } ${
            panelTab === "cli"
              ? "bg-primary/18 text-primary"
              : "text-base-content/42 hover:bg-base-100/50 hover:text-base-content"
          }`}
          aria-label={messages.sidebar.cli}
        >
          <Terminal size={15} />
          {!isCollapsed ? (
            <span className="truncate text-xs font-mono">{messages.sidebar.cli}</span>
          ) : null}
        </button>
        <button
          onClick={() => {
            void prepareAIAgentExperience().catch(() => {});
            onSetPanelTab("ai");
          }}
          onMouseEnter={(event) => {
            void prepareAIAgentExperience().catch(() => {});
            if (isCollapsed) {
              showSidebarTooltip(event.currentTarget, messages.sidebar.aiAgent);
            }
          }}
          onMouseLeave={hideSidebarTooltip}
          onFocus={(event) => {
            void prepareAIAgentExperience().catch(() => {});
            if (isCollapsed) {
              showSidebarTooltip(event.currentTarget, messages.sidebar.aiAgent);
            }
          }}
          onBlur={hideSidebarTooltip}
          className={`rounded-xl cursor-pointer transition-[background-color,color] duration-150 ${
            isCollapsed
              ? "flex h-9 w-9 items-center justify-center"
              : "flex h-10 w-full items-center gap-3 px-3"
          } ${
            panelTab === "ai"
              ? "bg-primary/18 text-primary"
              : "text-base-content/42 hover:bg-base-100/50 hover:text-base-content"
          }`}
          aria-label={messages.sidebar.aiAgent}
        >
          <Bot size={15} />
          {!isCollapsed ? (
            <span className="truncate text-xs font-mono">
              {messages.sidebar.aiAgent}
            </span>
          ) : null}
        </button>
        <button
          onClick={onOpenSettings}
          onMouseEnter={(event) => {
            if (isCollapsed) {
              showSidebarTooltip(event.currentTarget, messages.sidebar.settings);
            }
          }}
          onMouseLeave={hideSidebarTooltip}
          onFocus={(event) => {
            if (isCollapsed) {
              showSidebarTooltip(event.currentTarget, messages.sidebar.settings);
            }
          }}
          onBlur={hideSidebarTooltip}
          className={`cursor-pointer rounded-xl text-base-content/42 transition-[background-color,color] duration-150 hover:bg-base-100/50 hover:text-base-content ${
            isCollapsed
              ? "flex h-9 w-9 items-center justify-center"
              : "flex h-10 w-full items-center gap-3 px-3"
          }`}
          aria-label={messages.sidebar.settings}
        >
          <Settings size={15} />
          {!isCollapsed ? (
            <span className="truncate text-xs font-mono">
              {messages.sidebar.settings}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={onToggleCollapsed}
          onMouseEnter={(event) => {
            if (isCollapsed) {
              showSidebarTooltip(event.currentTarget, messages.sidebar.expand);
            }
          }}
          onMouseLeave={hideSidebarTooltip}
          onFocus={(event) => {
            if (isCollapsed) {
              showSidebarTooltip(event.currentTarget, messages.sidebar.expand);
            }
          }}
          onBlur={hideSidebarTooltip}
          className={`cursor-pointer rounded-xl text-base-content/42 transition-[background-color,color] duration-150 hover:bg-base-100/50 hover:text-base-content ${
            isCollapsed
              ? "flex h-9 w-9 items-center justify-center"
              : "mt-1.5 flex h-10 w-full items-center gap-3 px-3"
          }`}
          aria-label={
            isCollapsed ? messages.sidebar.expand : messages.sidebar.collapse
          }
        >
          {isCollapsed ? (
            <ChevronsRight size={15} />
          ) : (
            <ChevronsLeft size={15} />
          )}
          {!isCollapsed ? (
            <span className="truncate text-xs font-mono">
              {isCollapsed ? messages.sidebar.expand : messages.sidebar.collapse}
            </span>
          ) : null}
        </button>
      </div>
    </aside>
  );
}
