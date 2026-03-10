import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  Database,
  Plus,
} from "lucide-react";
import type { RedisConnection, PanelTab } from "../types";
import { useI18n } from "../i18n";
import {
  CONNECTION_ITEM_TRANSITION_MS,
  CONTEXT_MENU_TRANSITION_MS,
} from "./sidebar/constants";
import { SidebarConnectionRow } from "./sidebar/SidebarConnectionRow";
import { SidebarContextMenu } from "./sidebar/SidebarContextMenu";
import { SidebarFooter } from "./sidebar/SidebarFooter";

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

function replaceTemplate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : `{${key}}`
  );
}

function toAnimatedConnections(
  connections: RedisConnection[]
): AnimatedConnectionItem[] {
  return connections.map((connection) => ({
    connection,
    phase: "idle",
  }));
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
    if (!renderedContextMenu) return;
    if (contextMenuCloseTimerRef.current !== null) return;

    setIsContextMenuVisible(false);
    contextMenuCloseTimerRef.current = window.setTimeout(() => {
      contextMenuCloseTimerRef.current = null;
      setRenderedContextMenu(null);
    }, CONTEXT_MENU_TRANSITION_MS);
  }, [renderedContextMenu]);

  const handleDeleteConnectionFromContextMenu = useCallback(async () => {
    if (!contextConnection) {
      return;
    }

    if (confirmBeforeDelete) {
      const confirmed = await confirm(
        replaceTemplate(messages.sidebar.confirmDeleteConnection, {
          name: contextConnection.name,
        }),
        {
          title: "NeoRDM",
          kind: "warning",
          okLabel: messages.common.delete,
          cancelLabel: messages.common.cancel,
        }
      );

      if (!confirmed) {
        return;
      }
    }

    onDeleteConnection(contextConnection.id);
    closeContextMenu();
  }, [
    closeContextMenu,
    confirmBeforeDelete,
    contextConnection,
    messages.common.cancel,
    messages.common.delete,
    messages.sidebar.confirmDeleteConnection,
    onDeleteConnection,
  ]);

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
          return (
            <SidebarConnectionRow
              key={item.connection.id}
              connection={item.connection}
              phase={item.phase}
              isActive={activeConnectionId === item.connection.id}
              isCollapsed={isCollapsed}
              activeContextMenuConnectionId={renderedContextMenu?.connectionId ?? null}
              disconnectLabel={messages.common.disconnect}
              onSelectConnection={onSelectConnection}
              onDisconnectConnection={onDisconnectConnection}
              onOpenContextMenu={openContextMenu}
              onShowTooltip={showSidebarTooltip}
              onHideTooltip={hideSidebarTooltip}
              registerButtonRef={(element) => {
                connectionButtonRefs.current[item.connection.id] = element;
              }}
            />
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
        <SidebarContextMenu
          connection={contextConnection}
          x={renderedContextMenu.x}
          y={renderedContextMenu.y}
          isVisible={isContextMenuVisible}
          showDisconnectAction={showDisconnectContextConnection}
          editLabel={messages.common.edit}
          deleteLabel={messages.common.delete}
          disconnectLabel={messages.common.disconnect}
          onEdit={() => {
            onEditConnection(contextConnection.id);
            closeContextMenu();
          }}
          onDelete={() => {
            void handleDeleteConnectionFromContextMenu();
          }}
          onDisconnect={() => {
            onDisconnectConnection(contextConnection.id);
            closeContextMenu();
          }}
          setRef={(element) => {
            contextMenuRef.current = element;
          }}
        />
      )}

      <SidebarFooter
        isCollapsed={isCollapsed}
        panelTab={panelTab}
        cliLabel={messages.sidebar.cli}
        aiLabel={messages.sidebar.aiAgent}
        settingsLabel={messages.sidebar.settings}
        expandLabel={messages.sidebar.expand}
        collapseLabel={messages.sidebar.collapse}
        onSetPanelTab={onSetPanelTab}
        onOpenSettings={onOpenSettings}
        onToggleCollapsed={onToggleCollapsed}
        onShowTooltip={showSidebarTooltip}
        onHideTooltip={hideSidebarTooltip}
      />
    </aside>
  );
}
