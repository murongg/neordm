import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_APP_SETTINGS,
  loadAppSettings,
  subscribeAppSettings,
  updateAppSettings,
  type AppSettings,
} from "../lib/appSettings";

export function useAppPreferencesState() {
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [keySeparator, setKeySeparatorState] = useState<string>(
    DEFAULT_APP_SETTINGS.general.keySeparator
  );
  const [isSidebarCollapsed, setIsSidebarCollapsedState] = useState(
    DEFAULT_APP_SETTINGS.ui.sidebarCollapsed
  );
  const [hasHydratedSettings, setHasHydratedSettings] = useState(false);
  const [hasHydratedPreferences, setHasHydratedPreferences] = useState(false);

  const setIsSidebarCollapsed = useCallback(
    (nextValue: boolean | ((previous: boolean) => boolean)) => {
      setIsSidebarCollapsedState((previous) => {
        const resolvedValue =
          typeof nextValue === "function" ? nextValue(previous) : nextValue;

        if (hasHydratedPreferences) {
          void updateAppSettings((current) => ({
            ...current,
            ui: {
              ...current.ui,
              sidebarCollapsed: resolvedValue,
            },
          }));
        }

        return resolvedValue;
      });
    },
    [hasHydratedPreferences]
  );

  const toggleSidebarCollapsed = useCallback(() => {
    setIsSidebarCollapsed((previous) => !previous);
  }, [setIsSidebarCollapsed]);

  useEffect(() => {
    let cancelled = false;

    const applySettings = (settings: AppSettings) => {
      if (cancelled) {
        return;
      }

      setAppSettings(settings);
      setKeySeparatorState(settings.general.keySeparator);
      setIsSidebarCollapsedState(settings.ui.sidebarCollapsed);
      setHasHydratedPreferences(true);
      setHasHydratedSettings(true);
    };

    const unsubscribe = subscribeAppSettings((settings) => {
      applySettings(settings);
    });

    void loadAppSettings()
      .then((settings) => {
        applySettings(settings);
      })
      .catch((error) => {
        console.error("Failed to load app settings", error);
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const setKeySeparator = useCallback(
    (value: string) => {
      setKeySeparatorState(value);

      if (hasHydratedPreferences) {
        void updateAppSettings((current) => ({
          ...current,
          general: {
            ...current.general,
            keySeparator: value,
          },
        }));
      }
    },
    [hasHydratedPreferences]
  );

  const persistLastConnectionId = useCallback(
    (nextConnectionId: string) => {
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
    [appSettings.ui.lastConnectionId, hasHydratedPreferences]
  );

  return {
    appSettings,
    hasHydratedSettings,
    isSidebarCollapsed,
    keySeparator,
    persistLastConnectionId,
    setIsSidebarCollapsed,
    setKeySeparator,
    toggleSidebarCollapsed,
  };
}
