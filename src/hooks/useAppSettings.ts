import type { AppSettings } from "../lib/appSettings";
import {
  useAppPreferencesStore,
  useInitializeAppPreferencesStore,
} from "../store/useAppPreferencesState";

export function useAppSettings() {
  useInitializeAppPreferencesStore();

  return useAppPreferencesStore(
    (state): AppSettings => state.appSettings
  );
}
