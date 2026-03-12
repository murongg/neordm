import { useEffect, type ReactNode } from "react";
import { LoaderCircle, Plus, RotateCw, Search } from "lucide-react";

export interface HeaderToolbarSearchConfig {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}

export interface HeaderToolbarCreateActionConfig {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export interface HeaderToolbarRefreshActionConfig {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  isLoading?: boolean;
}

export interface HeaderToolbarConfig {
  search?: HeaderToolbarSearchConfig;
  createAction?: HeaderToolbarCreateActionConfig;
  refreshAction?: HeaderToolbarRefreshActionConfig;
}

export interface HeaderToolbarTrailingAction {
  key: string;
  label: string;
  onClick: () => void;
  icon: ReactNode;
  disabled?: boolean;
  tone?: "default" | "danger";
}

interface HeaderToolbarProps {
  config?: HeaderToolbarConfig | null;
  trailingActions?: HeaderToolbarTrailingAction[];
}

const HEADER_TOOLBAR_ICON_BUTTON_CLASS = "btn btn-ghost btn-xs cursor-pointer";
const HEADER_TOOLBAR_DANGER_ICON_BUTTON_CLASS =
  "btn btn-ghost btn-xs cursor-pointer text-error hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-60";

function getActionClassName(action?: {
  disabled?: boolean;
  tone?: "default" | "danger";
}) {
  const baseClassName =
    action?.tone === "danger"
      ? HEADER_TOOLBAR_DANGER_ICON_BUTTON_CLASS
      : HEADER_TOOLBAR_ICON_BUTTON_CLASS;

  return `${baseClassName} ${
    action?.disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
  }`;
}

export function HeaderToolbar({
  config,
  trailingActions = [],
}: HeaderToolbarProps) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
      {config?.search ? (
        <label className="flex h-8 min-h-8 min-w-0 w-56 max-w-full flex-none items-center gap-1.5 rounded-xl border border-base-content/10 bg-base-100/80 px-2 shadow-none max-sm:w-full sm:flex-1 sm:max-w-72">
          <Search size={11} className="text-base-content/35" />
          <input
            type="text"
            value={config.search.value}
            onChange={(event) => {
              config.search?.onChange(event.target.value);
            }}
            placeholder={config.search.placeholder}
            className="min-w-0 w-full border-0 bg-transparent text-xs font-mono outline-none"
            spellCheck={false}
          />
        </label>
      ) : null}

      {config?.createAction ? (
        <button
          type="button"
          onClick={config.createAction.onClick}
          disabled={config.createAction.disabled}
          aria-label={config.createAction.label}
          title={config.createAction.label}
          className={getActionClassName(config.createAction)}
        >
          <Plus size={12} />
        </button>
      ) : null}

      {config?.refreshAction ? (
        <button
          type="button"
          onClick={config.refreshAction.onClick}
          disabled={config.refreshAction.disabled}
          aria-label={config.refreshAction.label}
          title={config.refreshAction.label}
          className={getActionClassName(config.refreshAction)}
        >
          {config.refreshAction.isLoading ? (
            <LoaderCircle size={12} className="animate-spin" />
          ) : (
            <RotateCw size={12} />
          )}
        </button>
      ) : null}

      {trailingActions.map((action) => (
        <button
          key={action.key}
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          aria-label={action.label}
          title={action.label}
          className={getActionClassName(action)}
        >
          {action.icon}
        </button>
      ))}
    </div>
  );
}

export function useSyncHeaderToolbar(
  config: HeaderToolbarConfig | null,
  onHeaderToolbarChange?: ((config: HeaderToolbarConfig | null) => void) | null
) {
  useEffect(() => {
    if (!onHeaderToolbarChange) {
      return;
    }

    onHeaderToolbarChange(config);
  }, [config, onHeaderToolbarChange]);

  useEffect(() => {
    if (!onHeaderToolbarChange) {
      return;
    }

    return () => {
      onHeaderToolbarChange(null);
    };
  }, [onHeaderToolbarChange]);
}
