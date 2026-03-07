import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_APP_SETTINGS,
  loadAppSettings,
  updateAppSettings,
} from "../lib/appSettings";

export type ThemeMode = "light" | "dark" | "system";

// DaisyUI theme names
const LIGHT_THEME = "nord";
const DARK_THEME = "night";

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(mode: ThemeMode) {
  const resolved = mode === "system" ? getSystemTheme() : mode;
  const theme = resolved === "dark" ? DARK_THEME : LIGHT_THEME;
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.setAttribute("data-color-mode", resolved);
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(
    DEFAULT_APP_SETTINGS.appearance.themeMode
  );
  const hasHydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void loadAppSettings().then((settings) => {
      if (cancelled) {
        return;
      }

      setModeState(settings.appearance.themeMode);
      hasHydratedRef.current = true;
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((nextMode: ThemeMode) => {
    setModeState(nextMode);

    if (!hasHydratedRef.current) {
      return;
    }

    void updateAppSettings((current) => ({
      ...current,
      appearance: {
        ...current.appearance,
        themeMode: nextMode,
      },
    }));
  }, []);

  // Apply on mount & mode change
  useEffect(() => {
    applyTheme(mode);
  }, [mode]);

  // Listen for system preference changes when mode === "system"
  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [mode]);

  return { mode, setMode };
}
