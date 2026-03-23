import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appSource = readFileSync(resolve("src/App.tsx"), "utf8");
const statusbarSource = readFileSync(resolve("src-tauri/src/statusbar.rs"), "utf8");

if (!appSource.includes("isMainWindowVisible")) {
  throw new Error("App.tsx is missing main window visibility state.");
}

if (
  !appSource.includes("if (!preferences.hasHydratedSettings || autoRefreshIntervalSeconds <= 0)")
    || !appSource.includes("if (!isMainWindowVisible)")
) {
  throw new Error(
    "Auto-refresh interval in App.tsx must be gated by main window visibility."
  );
}

if (!appSource.includes("neordm://window/visibility")) {
  throw new Error("App.tsx is missing the main window visibility listener.");
}

if (!statusbarSource.includes("neordm://window/visibility")) {
  throw new Error("statusbar.rs is missing the main window visibility event name.");
}

if (!statusbarSource.includes('emit_main_window_visibility(app, "hidden")')) {
  throw new Error("hide_main_window must emit a hidden visibility event.");
}

if (!statusbarSource.includes('emit_main_window_visibility(app, "visible")')) {
  throw new Error("show_main_window must emit a visible visibility event.");
}

console.log("Auto-refresh window visibility check passed.");
