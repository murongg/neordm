import type { MouseEvent } from "react";
import type { RedisConnection } from "../../types";
import {
  CONNECTION_ITEM_HEIGHT,
  CONNECTION_ITEM_SPACING,
} from "./constants";
import { ConnectionStatusBadge } from "./ConnectionStatusBadge";

interface SidebarConnectionRowProps {
  connection: RedisConnection;
  phase: "entering" | "idle" | "exiting";
  isActive: boolean;
  isCollapsed: boolean;
  activeContextMenuConnectionId: string | null;
  disconnectLabel: string;
  onSelectConnection: (connectionId: string) => void;
  onDisconnectConnection: (connectionId: string) => void;
  onOpenContextMenu: (
    event: MouseEvent<HTMLElement>,
    connectionId: string
  ) => void;
  onShowTooltip: (target: HTMLElement, content: string) => void;
  onHideTooltip: () => void;
  registerButtonRef: (element: HTMLButtonElement | null) => void;
}

export function SidebarConnectionRow({
  connection,
  phase,
  isActive,
  isCollapsed,
  activeContextMenuConnectionId,
  disconnectLabel,
  onSelectConnection,
  onDisconnectConnection,
  onOpenContextMenu,
  onShowTooltip,
  onHideTooltip,
  registerButtonRef,
}: SidebarConnectionRowProps) {
  const shouldCollapseLayout =
    phase === "exiting" || (phase === "entering" && !isActive);
  const isTransitioning = phase !== "idle";

  return (
    <div
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
          ref={registerButtonRef}
          onClick={() => onSelectConnection(connection.id)}
          onContextMenu={(event) => onOpenContextMenu(event, connection.id)}
          onMouseEnter={(event) => {
            if (isCollapsed) {
              onShowTooltip(event.currentTarget, connection.name);
            }
          }}
          onMouseLeave={onHideTooltip}
          onFocus={(event) => {
            if (isCollapsed) {
              onShowTooltip(event.currentTarget, connection.name);
            }
          }}
          onBlur={onHideTooltip}
          aria-haspopup="menu"
          aria-expanded={activeContextMenuConnectionId === connection.id}
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
          aria-label={connection.name}
        >
          <div
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: connection.color }}
          />
          {!isCollapsed ? (
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-mono">{connection.name}</div>
            </div>
          ) : null}
        </button>

        {isCollapsed ? (
          <ConnectionStatusBadge
            status={connection.status}
            onDisconnect={() => onDisconnectConnection(connection.id)}
            onContextMenu={(event) => onOpenContextMenu(event, connection.id)}
            disconnectLabel={disconnectLabel}
            onShowTooltip={onShowTooltip}
            onHideTooltip={onHideTooltip}
          />
        ) : (
          <ConnectionStatusBadge
            status={connection.status}
            placement="row-end"
            onDisconnect={() => onDisconnectConnection(connection.id)}
            onContextMenu={(event) => onOpenContextMenu(event, connection.id)}
          />
        )}
      </div>
    </div>
  );
}
