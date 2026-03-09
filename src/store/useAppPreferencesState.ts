import { useEffect } from "react";
import { create } from "zustand";
import {
  DEFAULT_APP_SETTINGS,
  loadAppSettings,
  subscribeAppSettings,
  updateAppSettings,
  type AppSettings,
} from "../lib/appSettings";

interface AppPreferencesStoreState {
  appSettings: AppSettings;
  keySeparator: string;
  isSidebarCollapsed: boolean;
  hasHydratedSettings: boolean;
  hasHydratedPreferences: boolean;
  hydrate: (settings: AppSettings) => void;
  setIsSidebarCollapsed: (nextValue: boolean | ((previous: boolean) => boolean)) => void;
  toggleSidebarCollapsed: () => void;
  setKeySeparator: (value: string) => void;
  setKeyBrowserSettings: (
    value: Partial<
      Pick<AppSettings["general"], "keySeparator" | "maxKeys" | "scanCount">
    >
  ) => void;
  persistLastConnectionId: (nextConnectionId: string) => void;
}

export const useAppPreferencesStore = create<AppPreferencesStoreState>(
  (set, get) => ({
    appSettings: DEFAULT_APP_SETTINGS,
    keySeparator: DEFAULT_APP_SETTINGS.general.keySeparator,
    isSidebarCollapsed: DEFAULT_APP_SETTINGS.ui.sidebarCollapsed,
    hasHydratedSettings: false,
    hasHydratedPreferences: false,
    hydrate: (settings) => {
      set({
        appSettings: settings,
        keySeparator: settings.general.keySeparator,
        isSidebarCollapsed: settings.ui.sidebarCollapsed,
        hasHydratedPreferences: true,
        hasHydratedSettings: true,
      });
    },
    setIsSidebarCollapsed: (nextValue) => {
      const { hasHydratedPreferences } = get();

      set((state) => {
        const resolvedValue =
          typeof nextValue === "function"
            ? nextValue(state.isSidebarCollapsed)
            : nextValue;

        if (hasHydratedPreferences) {
          void updateAppSettings((current) => ({
            ...current,
            ui: {
              ...current.ui,
              sidebarCollapsed: resolvedValue,
            },
          }));
        }

        return {
          isSidebarCollapsed: resolvedValue,
        };
      });
    },
    toggleSidebarCollapsed: () => {
      get().setIsSidebarCollapsed((previous) => !previous);
    },
    setKeySeparator: (value) => {
      get().setKeyBrowserSettings({
        keySeparator: value,
      });
    },
    setKeyBrowserSettings: (value) => {
      const { hasHydratedPreferences } = get();

      set((state) => {
        const nextGeneralSettings = {
          ...state.appSettings.general,
          ...value,
        };

        return {
          appSettings: {
            ...state.appSettings,
            general: nextGeneralSettings,
          },
          keySeparator: nextGeneralSettings.keySeparator,
        };
      });

      if (hasHydratedPreferences) {
        void updateAppSettings((current) => ({
          ...current,
          general: {
            ...current.general,
            ...value,
          },
        }));
      }
    },
    persistLastConnectionId: (nextConnectionId) => {
      const { appSettings, hasHydratedPreferences } = get();

      if (
        !hasHydratedPreferences ||
        appSettings.ui.lastConnectionId === nextConnectionId
      ) {
        return;
      }

      void updateAppSettings((current) => ({
        ...current,
        ui: {
          ...current.ui,
          lastConnectionId: nextConnectionId,
        },
      }));
    },
  })
);

let hasInitializedAppPreferencesStore = false;

function initializeAppPreferencesStore() {
  if (hasInitializedAppPreferencesStore) {
    return;
  }

  hasInitializedAppPreferencesStore = true;

  subscribeAppSettings((settings) => {
    useAppPreferencesStore.getState().hydrate(settings);
  });

  void loadAppSettings()
    .then((settings) => {
      useAppPreferencesStore.getState().hydrate(settings);
    })
    .catch((error) => {
      console.error("Failed to load app settings", error);
    });
}

export function useInitializeAppPreferencesStore() {
  useEffect(() => {
    initializeAppPreferencesStore();
  }, []);
}

export function useAppPreferencesState() {
  useInitializeAppPreferencesStore();
  return useAppPreferencesStore();
}
