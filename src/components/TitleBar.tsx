import { getCurrentWindow } from "@tauri-apps/api/window";
import { useI18n } from "../i18n";

export function TitleBar() {
  const win = getCurrentWindow();
  const { messages } = useI18n();

  return (
    <div
      data-tauri-drag-region
      className="flex items-center gap-1.5 px-3 h-12 shrink-0 select-none"
    >
      {/* macOS traffic lights */}
      <button
        onClick={() => win.close()}
        className="w-3 h-3 rounded-full bg-[#ff5f57] hover:brightness-90 active:brightness-75 cursor-pointer transition-[filter] duration-150 group relative"
        aria-label={messages.ui.titleBar.close}
      >
        <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 text-[#820005] leading-none" style={{ fontSize: 8 }}>✕</span>
      </button>
      <button
        onClick={() => win.minimize()}
        className="w-3 h-3 rounded-full bg-[#febc2e] hover:brightness-90 active:brightness-75 cursor-pointer transition-[filter] duration-150 group relative"
        aria-label={messages.ui.titleBar.minimize}
      >
        <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 text-[#7d5000] leading-none" style={{ fontSize: 10 }}>−</span>
      </button>
      <button
        onClick={() => win.toggleMaximize()}
        className="w-3 h-3 rounded-full bg-[#28c840] hover:brightness-90 active:brightness-75 cursor-pointer transition-[filter] duration-150 group relative"
        aria-label={messages.ui.titleBar.maximize}
      >
        <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 text-[#006500] leading-none" style={{ fontSize: 8 }}>⤢</span>
      </button>
    </div>
  );
}
