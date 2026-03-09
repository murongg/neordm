import { memo } from "react";
import { Info } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useI18n } from "../i18n";
import { APP_NAME, APP_VERSION } from "../lib/appMeta";
import { useRedisWorkspaceStore } from "../store/useRedisWorkspaceState";
import { Tooltip } from "./Tooltip";

export const StatusBarPanel = memo(function StatusBarPanel() {
  const { messages, format } = useI18n();
  const { keysCount, selectedKey } = useRedisWorkspaceStore(
    useShallow((state) => ({
      keysCount: state.keys.length,
      selectedKey: state.selectedKey,
    }))
  );

  return (
    <div className="flex items-center justify-between px-4 h-7 border-t border-base-100/50 shrink-0">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <span className="shrink-0 text-[10px] font-mono text-base-content/30">
          {format(messages.app.status.keysCount, { count: keysCount })}
        </span>
        {selectedKey && (
          <>
            <span className="shrink-0 text-base-content/10">·</span>
            <Tooltip content={selectedKey.key} className="flex min-w-0">
              <span className="flex min-w-0 items-center gap-1 text-[10px] font-mono text-base-content/40">
                <Info size={9} className="shrink-0" />
                <span className="truncate">{selectedKey.key}</span>
              </span>
            </Tooltip>
          </>
        )}
      </div>
      <div className="ml-3 flex shrink-0 items-center gap-3">
        <span className="text-[10px] font-mono text-base-content/30">Redis 7.2.3</span>
        <span className="text-[10px] font-mono text-base-content/20">{APP_NAME} v{APP_VERSION}</span>
      </div>
    </div>
  );
});
