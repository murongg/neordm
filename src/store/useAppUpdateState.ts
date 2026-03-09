import { create } from "zustand";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";
import { APP_VERSION } from "../lib/appMeta";

type UpdateStatus =
  | "idle"
  | "checking"
  | "latest"
  | "available"
  | "downloading"
  | "installing"
  | "error";

interface CheckForUpdatesOptions {
  silent?: boolean;
}

interface AppUpdateState {
  status: UpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  releaseDate: string | null;
  releaseNotes: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  errorMessage: string | null;
  checkForUpdates: (options?: CheckForUpdatesOptions) => Promise<boolean>;
  installUpdate: () => Promise<boolean>;
  clearError: () => void;
}

let pendingUpdate: Update | null = null;

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function disposePendingUpdate(nextUpdate?: Update | null) {
  if (pendingUpdate && pendingUpdate !== nextUpdate) {
    await pendingUpdate.close().catch(() => undefined);
  }

  pendingUpdate = nextUpdate ?? null;
}

export const useAppUpdateStore = create<AppUpdateState>((set) => ({
  status: "idle",
  currentVersion: APP_VERSION,
  availableVersion: null,
  releaseDate: null,
  releaseNotes: null,
  downloadedBytes: 0,
  totalBytes: null,
  errorMessage: null,
  checkForUpdates: async (options = {}) => {
    await disposePendingUpdate();

    set((state) => ({
      ...state,
      status: "checking",
      currentVersion: APP_VERSION,
      downloadedBytes: 0,
      totalBytes: null,
      errorMessage: null,
    }));

    try {
      const update = await check({ timeout: 15000 });

      if (!update) {
        set((state) => ({
          ...state,
          status: options.silent ? "idle" : "latest",
          availableVersion: null,
          releaseDate: null,
          releaseNotes: null,
          downloadedBytes: 0,
          totalBytes: null,
        }));
        return false;
      }

      pendingUpdate = update;
      set((state) => ({
        ...state,
        status: "available",
        currentVersion: update.currentVersion,
        availableVersion: update.version,
        releaseDate: update.date ?? null,
        releaseNotes: update.body ?? null,
        downloadedBytes: 0,
        totalBytes: null,
      }));
      return true;
    } catch (error) {
      if (options.silent) {
        set((state) => ({
          ...state,
          status: "idle",
        }));
        return false;
      }

      set((state) => ({
        ...state,
        status: "error",
        errorMessage: getErrorMessage(error),
      }));
      return false;
    }
  },
  installUpdate: async () => {
    if (!pendingUpdate) {
      return false;
    }

    let downloadedBytes = 0;
    let totalBytes: number | null = null;

    set((state) => ({
      ...state,
      status: "downloading",
      downloadedBytes: 0,
      totalBytes: null,
      errorMessage: null,
    }));

    try {
      await pendingUpdate.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          totalBytes = event.data.contentLength ?? null;
          downloadedBytes = 0;
          set((state) => ({
            ...state,
            status: "downloading",
            downloadedBytes,
            totalBytes,
          }));
          return;
        }

        if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          set((state) => ({
            ...state,
            status: "downloading",
            downloadedBytes,
            totalBytes,
          }));
          return;
        }

        set((state) => ({
          ...state,
          status: "installing",
          downloadedBytes,
          totalBytes,
        }));
      });

      await disposePendingUpdate();
      await relaunch();
      return true;
    } catch (error) {
      set((state) => ({
        ...state,
        status: "error",
        errorMessage: getErrorMessage(error),
      }));
      return false;
    }
  },
  clearError: () => {
    set((state) => ({
      ...state,
      errorMessage: null,
      status:
        state.availableVersion !== null
          ? "available"
          : state.status === "error"
          ? "idle"
          : state.status,
    }));
  },
}));
