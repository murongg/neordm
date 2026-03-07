import { useEffect, useState } from "react";
import {
  DEFAULT_APP_SETTINGS,
  loadAppSettings,
  subscribeAppSettings,
  type AppSettings,
} from "../lib/appSettings";

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = subscribeAppSettings((nextSettings) => {
      if (!cancelled) {
        setSettings(nextSettings);
      }
    });

    void loadAppSettings().then((nextSettings) => {
      if (!cancelled) {
        setSettings(nextSettings);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return settings;
}
