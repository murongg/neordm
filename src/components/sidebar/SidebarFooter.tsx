import type { ReactNode } from "react";
import {
  Bot,
  ChevronsLeft,
  ChevronsRight,
  Settings,
  Terminal,
} from "lucide-react";
import { prepareAIAgentExperience } from "../../lib/aiPrefetch";
import type { PanelTab } from "../../types";

interface SidebarActionButtonProps {
  label: string;
  icon: ReactNode;
  isCollapsed: boolean;
  isActive?: boolean;
  className?: string;
  onClick: () => void;
  onShowTooltip: (target: HTMLElement, content: string) => void;
  onHideTooltip: () => void;
  onPrefetch?: () => void;
}

function SidebarActionButton({
  label,
  icon,
  isCollapsed,
  isActive = false,
  className = "",
  onClick,
  onShowTooltip,
  onHideTooltip,
  onPrefetch,
}: SidebarActionButtonProps) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={(event) => {
        onPrefetch?.();
        if (isCollapsed) {
          onShowTooltip(event.currentTarget, label);
        }
      }}
      onMouseLeave={onHideTooltip}
      onFocus={(event) => {
        onPrefetch?.();
        if (isCollapsed) {
          onShowTooltip(event.currentTarget, label);
        }
      }}
      onBlur={onHideTooltip}
      className={`${className} rounded-xl cursor-pointer transition-[background-color,color] duration-150 ${
        isCollapsed
          ? "flex h-9 w-9 items-center justify-center"
          : "flex h-10 w-full items-center gap-3 px-3"
      } ${
        isActive
          ? "bg-primary/18 text-primary"
          : "text-base-content/42 hover:bg-base-100/50 hover:text-base-content"
      }`}
      aria-label={label}
    >
      {icon}
      {!isCollapsed ? (
        <span className="truncate text-xs font-mono">{label}</span>
      ) : null}
    </button>
  );
}

interface SidebarFooterProps {
  isCollapsed: boolean;
  panelTab: PanelTab;
  cliLabel: string;
  aiLabel: string;
  settingsLabel: string;
  expandLabel: string;
  collapseLabel: string;
  onSetPanelTab: (tab: PanelTab) => void;
  onOpenSettings: () => void;
  onToggleCollapsed: () => void;
  onShowTooltip: (target: HTMLElement, content: string) => void;
  onHideTooltip: () => void;
}

export function SidebarFooter({
  isCollapsed,
  panelTab,
  cliLabel,
  aiLabel,
  settingsLabel,
  expandLabel,
  collapseLabel,
  onSetPanelTab,
  onOpenSettings,
  onToggleCollapsed,
  onShowTooltip,
  onHideTooltip,
}: SidebarFooterProps) {
  const collapseToggleLabel = isCollapsed ? expandLabel : collapseLabel;

  return (
    <div
      className={`border-t border-base-100/50 py-3 ${
        isCollapsed
          ? "flex flex-col items-center gap-1.5"
          : "flex flex-col gap-1.5 px-2"
      }`}
    >
      <SidebarActionButton
        label={cliLabel}
        icon={<Terminal size={15} />}
        isCollapsed={isCollapsed}
        isActive={panelTab === "cli"}
        onClick={() => onSetPanelTab("cli")}
        onShowTooltip={onShowTooltip}
        onHideTooltip={onHideTooltip}
      />
      <SidebarActionButton
        label={aiLabel}
        icon={<Bot size={15} />}
        isCollapsed={isCollapsed}
        isActive={panelTab === "ai"}
        onClick={() => {
          void prepareAIAgentExperience().catch(() => undefined);
          onSetPanelTab("ai");
        }}
        onShowTooltip={onShowTooltip}
        onHideTooltip={onHideTooltip}
        onPrefetch={() => {
          void prepareAIAgentExperience().catch(() => undefined);
        }}
      />
      <SidebarActionButton
        label={settingsLabel}
        icon={<Settings size={15} />}
        isCollapsed={isCollapsed}
        onClick={onOpenSettings}
        onShowTooltip={onShowTooltip}
        onHideTooltip={onHideTooltip}
      />
      <SidebarActionButton
        label={collapseToggleLabel}
        icon={
          isCollapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />
        }
        isCollapsed={isCollapsed}
        className={isCollapsed ? "" : "mt-1.5"}
        onClick={onToggleCollapsed}
        onShowTooltip={onShowTooltip}
        onHideTooltip={onHideTooltip}
      />
    </div>
  );
}
