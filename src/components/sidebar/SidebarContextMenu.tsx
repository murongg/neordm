import { Pencil, Trash2, WifiOff } from "lucide-react";
import type { RedisConnection } from "../../types";

interface SidebarContextMenuProps {
  connection: RedisConnection;
  x: number;
  y: number;
  isVisible: boolean;
  showDisconnectAction: boolean;
  editLabel: string;
  deleteLabel: string;
  disconnectLabel: string;
  onEdit: () => void;
  onDelete: () => void;
  onDisconnect: () => void;
  setRef: (element: HTMLDivElement | null) => void;
}

export function SidebarContextMenu({
  connection,
  x,
  y,
  isVisible,
  showDisconnectAction,
  editLabel,
  deleteLabel,
  disconnectLabel,
  onEdit,
  onDelete,
  onDisconnect,
  setRef,
}: SidebarContextMenuProps) {
  return (
    <div
      ref={setRef}
      role="menu"
      style={{ left: x, top: y }}
      className={`fixed z-[70] w-11 rounded-xl border border-base-content/10 bg-base-200 p-1 shadow-2xl origin-top-left transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none ${
        isVisible
          ? "translate-y-0 scale-100 opacity-100"
          : "-translate-y-1 scale-95 opacity-0 pointer-events-none"
      }`}
    >
      <button
        role="menuitem"
        onClick={onEdit}
        aria-label={editLabel}
        title={`${editLabel} · ${connection.name}`}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-base-content/80 transition-colors duration-150 hover:bg-base-100 cursor-pointer"
      >
        <Pencil size={12} />
      </button>

      <button
        role="menuitem"
        onClick={onDelete}
        aria-label={deleteLabel}
        title={`${deleteLabel} · ${connection.name}`}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-error transition-colors duration-150 hover:bg-error/10 cursor-pointer"
      >
        <Trash2 size={12} />
      </button>

      {showDisconnectAction ? (
        <button
          role="menuitem"
          onClick={onDisconnect}
          aria-label={disconnectLabel}
          title={`${disconnectLabel} · ${connection.name}`}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-base-content/80 transition-colors duration-150 hover:bg-base-100 cursor-pointer"
        >
          <WifiOff size={12} />
        </button>
      ) : null}
    </div>
  );
}
