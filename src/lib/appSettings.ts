import type { Locale } from "../locales";
import { LOCALE_OPTIONS } from "../locales";
import { settingsStore } from "./settingsStore";

export type ThemeModeSetting = "light" | "dark" | "system";
export type HashDisplayModeSetting = "table" | "json";

export interface GeneralAppSettings {
  locale: Locale;
  autoConnect: boolean;
  confirmDelete: boolean;
  maxKeys: string;
  scanCount: string;
  autoRefreshInterval: string;
  keySeparator: string;
}

export interface AppearanceAppSettings {
  themeMode: ThemeModeSetting;
  showKeyType: boolean;
  showTtl: boolean;
}

export interface EditorAppSettings {
  autoFormatJson: boolean;
  wordWrap: boolean;
  syntaxHighlighting: boolean;
  maxValueSize: string;
  defaultTtl: string;
  hashDisplayMode: HashDisplayModeSetting;
}

export interface CliAppSettings {
  historySize: string;
  timeout: string;
  showTimestamps: boolean;
  syntaxHighlighting: boolean;
  pipelineMode: boolean;
}

export interface PrivacyAppSettings {
  savePasswords: boolean;
}

export interface UiAppSettings {
  sidebarCollapsed: boolean;
  lastConnectionId: string;
}

export interface AppSettings {
  general: GeneralAppSettings;
  appearance: AppearanceAppSettings;
  editor: EditorAppSettings;
  cli: CliAppSettings;
  privacy: PrivacyAppSettings;
  ui: UiAppSettings;
}

const APP_SETTINGS_STORE_KEY = "app";
const LEGACY_LOCALE_STORAGE_KEY = "neordm-locale";
const LEGACY_THEME_STORAGE_KEY = "neordm-theme-mode";
const LEGACY_KEY_SEPARATOR_STORAGE_KEY = "neordm-key-separator";
const LEGACY_SIDEBAR_COLLAPSED_STORAGE_KEY = "neordm-sidebar-collapsed";

function getDefaultLocale(): Locale {
  if (typeof navigator === "undefined") {
    return "en";
  }

  const normalized = navigator.language.toLowerCase();
  const matched = LOCALE_OPTIONS.find((option) =>
    normalized.startsWith(option.value)
  );

  return matched?.value ?? "en";
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  general: {
    locale: getDefaultLocale(),
    autoConnect: true,
    confirmDelete: true,
    maxKeys: "10000",
    scanCount: "200",
    autoRefreshInterval: "0",
    keySeparator: ":",
  },
  appearance: {
    themeMode: "dark",
    showKeyType: true,
    showTtl: true,
  },
  editor: {
    autoFormatJson: true,
    wordWrap: true,
    syntaxHighlighting: true,
    maxValueSize: "1",
    defaultTtl: "-1",
    hashDisplayMode: "table",
  },
  cli: {
    historySize: "500",
    timeout: "30",
    showTimestamps: false,
    syntaxHighlighting: true,
    pipelineMode: false,
  },
  privacy: {
    savePasswords: true,
  },
  ui: {
    sidebarCollapsed: true,
    lastConnectionId: "",
  },
};

let cachedAppSettings: AppSettings | null = null;
let appSettingsWriteQueue = Promise.resolve<void>(undefined);
const appSettingsListeners = new Set<(settings: AppSettings) => void>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeLocale(value: unknown, fallback: Locale): Locale {
  return LOCALE_OPTIONS.some((option) => option.value === value)
    ? (value as Locale)
    : fallback;
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeThemeMode(
  value: unknown,
  fallback: ThemeModeSetting
): ThemeModeSetting {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : fallback;
}

function normalizeHashDisplayMode(
  value: unknown,
  fallback: HashDisplayModeSetting
): HashDisplayModeSetting {
  return value === "table" || value === "json" ? value : fallback;
}

function normalizeGeneralSettings(value: unknown): GeneralAppSettings {
  const source = isRecord(value) ? value : {};

  return {
    locale: normalizeLocale(source.locale, DEFAULT_APP_SETTINGS.general.locale),
    autoConnect: normalizeBoolean(
      source.autoConnect,
      DEFAULT_APP_SETTINGS.general.autoConnect
    ),
    confirmDelete: normalizeBoolean(
      source.confirmDelete,
      DEFAULT_APP_SETTINGS.general.confirmDelete
    ),
    maxKeys: normalizeString(source.maxKeys, DEFAULT_APP_SETTINGS.general.maxKeys),
    scanCount: normalizeString(
      source.scanCount,
      DEFAULT_APP_SETTINGS.general.scanCount
    ),
    autoRefreshInterval: normalizeString(
      source.autoRefreshInterval,
      DEFAULT_APP_SETTINGS.general.autoRefreshInterval
    ),
    keySeparator: normalizeString(
      source.keySeparator,
      DEFAULT_APP_SETTINGS.general.keySeparator
    ),
  };
}

function normalizeAppearanceSettings(value: unknown): AppearanceAppSettings {
  const source = isRecord(value) ? value : {};

  return {
    themeMode: normalizeThemeMode(
      source.themeMode,
      DEFAULT_APP_SETTINGS.appearance.themeMode
    ),
    showKeyType: normalizeBoolean(
      source.showKeyType,
      DEFAULT_APP_SETTINGS.appearance.showKeyType
    ),
    showTtl: normalizeBoolean(
      source.showTtl,
      DEFAULT_APP_SETTINGS.appearance.showTtl
    ),
  };
}

function normalizeEditorSettings(value: unknown): EditorAppSettings {
  const source = isRecord(value) ? value : {};

  return {
    autoFormatJson: normalizeBoolean(
      source.autoFormatJson,
      DEFAULT_APP_SETTINGS.editor.autoFormatJson
    ),
    wordWrap: normalizeBoolean(
      source.wordWrap,
      DEFAULT_APP_SETTINGS.editor.wordWrap
    ),
    syntaxHighlighting: normalizeBoolean(
      source.syntaxHighlighting,
      DEFAULT_APP_SETTINGS.editor.syntaxHighlighting
    ),
    maxValueSize: normalizeString(
      source.maxValueSize,
      DEFAULT_APP_SETTINGS.editor.maxValueSize
    ),
    defaultTtl: normalizeString(
      source.defaultTtl,
      DEFAULT_APP_SETTINGS.editor.defaultTtl
    ),
    hashDisplayMode: normalizeHashDisplayMode(
      source.hashDisplayMode,
      DEFAULT_APP_SETTINGS.editor.hashDisplayMode
    ),
  };
}

function normalizeCliSettings(value: unknown): CliAppSettings {
  const source = isRecord(value) ? value : {};

  return {
    historySize: normalizeString(
      source.historySize,
      DEFAULT_APP_SETTINGS.cli.historySize
    ),
    timeout: normalizeString(source.timeout, DEFAULT_APP_SETTINGS.cli.timeout),
    showTimestamps: normalizeBoolean(
      source.showTimestamps,
      DEFAULT_APP_SETTINGS.cli.showTimestamps
    ),
    syntaxHighlighting: normalizeBoolean(
      source.syntaxHighlighting,
      DEFAULT_APP_SETTINGS.cli.syntaxHighlighting
    ),
    pipelineMode: normalizeBoolean(
      source.pipelineMode,
      DEFAULT_APP_SETTINGS.cli.pipelineMode
    ),
  };
}

function normalizePrivacySettings(value: unknown): PrivacyAppSettings {
  const source = isRecord(value) ? value : {};

  return {
    savePasswords: normalizeBoolean(
      source.savePasswords,
      DEFAULT_APP_SETTINGS.privacy.savePasswords
    ),
  };
}

function normalizeUiSettings(value: unknown): UiAppSettings {
  const source = isRecord(value) ? value : {};

  return {
    sidebarCollapsed: normalizeBoolean(
      source.sidebarCollapsed,
      DEFAULT_APP_SETTINGS.ui.sidebarCollapsed
    ),
    lastConnectionId: normalizeString(
      source.lastConnectionId,
      DEFAULT_APP_SETTINGS.ui.lastConnectionId
    ),
  };
}

function normalizeAppSettings(value: unknown): AppSettings {
  const source = isRecord(value) ? value : {};

  return {
    general: normalizeGeneralSettings(source.general),
    appearance: normalizeAppearanceSettings(source.appearance),
    editor: normalizeEditorSettings(source.editor),
    cli: normalizeCliSettings(source.cli),
    privacy: normalizePrivacySettings(source.privacy),
    ui: normalizeUiSettings(source.ui),
  };
}

function persistLegacyMirrors(settings: AppSettings) {
  if (typeof localStorage === "undefined") {
    return;
  }

  try {
    localStorage.setItem(LEGACY_LOCALE_STORAGE_KEY, settings.general.locale);
    localStorage.setItem(
      LEGACY_THEME_STORAGE_KEY,
      settings.appearance.themeMode
    );
    localStorage.setItem(
      LEGACY_KEY_SEPARATOR_STORAGE_KEY,
      settings.general.keySeparator
    );
    localStorage.setItem(
      LEGACY_SIDEBAR_COLLAPSED_STORAGE_KEY,
      settings.ui.sidebarCollapsed ? "1" : "0"
    );
  } catch (error) {
    console.error("Failed to persist legacy app settings mirrors", error);
  }
}

function notifyAppSettingsListeners(settings: AppSettings) {
  for (const listener of appSettingsListeners) {
    listener(settings);
  }
}

function loadLegacyAppSettings(): AppSettings | null {
  if (typeof localStorage === "undefined") {
    return null;
  }

  try {
    const locale = localStorage.getItem(LEGACY_LOCALE_STORAGE_KEY);
    const themeMode = localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    const keySeparator = localStorage.getItem(LEGACY_KEY_SEPARATOR_STORAGE_KEY);
    const sidebarCollapsed = localStorage.getItem(
      LEGACY_SIDEBAR_COLLAPSED_STORAGE_KEY
    );

    if (
      locale === null &&
      themeMode === null &&
      keySeparator === null &&
      sidebarCollapsed === null
    ) {
      return null;
    }

    return {
      ...DEFAULT_APP_SETTINGS,
      general: {
        ...DEFAULT_APP_SETTINGS.general,
        locale: normalizeLocale(locale, DEFAULT_APP_SETTINGS.general.locale),
        keySeparator:
          keySeparator ?? DEFAULT_APP_SETTINGS.general.keySeparator,
      },
      appearance: {
        ...DEFAULT_APP_SETTINGS.appearance,
        themeMode: normalizeThemeMode(
          themeMode,
          DEFAULT_APP_SETTINGS.appearance.themeMode
        ),
      },
      ui: {
        ...DEFAULT_APP_SETTINGS.ui,
        sidebarCollapsed:
          sidebarCollapsed === null
            ? DEFAULT_APP_SETTINGS.ui.sidebarCollapsed
            : sidebarCollapsed === "1",
      },
    };
  } catch (error) {
    console.error("Failed to load legacy app settings", error);
    return null;
  }
}

export async function loadAppSettings(): Promise<AppSettings> {
  if (cachedAppSettings) {
    return cachedAppSettings;
  }

  try {
    const raw = await settingsStore.get<unknown>(APP_SETTINGS_STORE_KEY);

    if (raw !== undefined) {
      const normalized = normalizeAppSettings(raw);
      cachedAppSettings = normalized;
      persistLegacyMirrors(normalized);
      notifyAppSettingsListeners(normalized);
      return normalized;
    }
  } catch (error) {
    console.error("Failed to load app settings from settings.json", error);
  }

  const legacySettings = loadLegacyAppSettings();

  if (legacySettings) {
    cachedAppSettings = legacySettings;
    await persistAppSettings(legacySettings);
    return legacySettings;
  }

  cachedAppSettings = DEFAULT_APP_SETTINGS;
  notifyAppSettingsListeners(DEFAULT_APP_SETTINGS);
  return DEFAULT_APP_SETTINGS;
}

export async function persistAppSettings(settings: AppSettings) {
  const normalized = normalizeAppSettings(settings);
  cachedAppSettings = normalized;
  persistLegacyMirrors(normalized);
  notifyAppSettingsListeners(normalized);

  try {
    await settingsStore.set(APP_SETTINGS_STORE_KEY, normalized);
    await settingsStore.save();
  } catch (error) {
    console.error("Failed to persist app settings to settings.json", error);
  }
}

export async function updateAppSettings(
  updater: (current: AppSettings) => AppSettings
): Promise<AppSettings> {
  const nextPromise = appSettingsWriteQueue.then(async () => {
    const current = await loadAppSettings();
    const next = normalizeAppSettings(updater(current));
    await persistAppSettings(next);
    return next;
  });

  appSettingsWriteQueue = nextPromise.then(
    () => undefined,
    () => undefined
  );

  return nextPromise;
}

export function subscribeAppSettings(
  listener: (settings: AppSettings) => void
) {
  appSettingsListeners.add(listener);

  if (cachedAppSettings) {
    listener(cachedAppSettings);
  }

  return () => {
    appSettingsListeners.delete(listener);
  };
}
