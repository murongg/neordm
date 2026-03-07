import { LazyStore } from "@tauri-apps/plugin-store";

export const SETTINGS_STORE_PATH = "settings.json";
export const settingsStore = new LazyStore(SETTINGS_STORE_PATH);
