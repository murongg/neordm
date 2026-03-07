import { loadAppSettings } from "./appSettings";
import { settingsStore } from "./settingsStore";

const AUDIT_LOG_KEY = "privacy.auditLogEntries";
const CRASH_REPORTS_KEY = "privacy.crashReports";
const TELEMETRY_COUNTERS_KEY = "privacy.telemetryCounters";
const MAX_AUDIT_LOG_ENTRIES = 200;
const MAX_CRASH_REPORTS = 50;

let privacyRuntimeInstalled = false;

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  action: string;
  detail?: Record<string, string | number | boolean | null>;
}

export interface CrashReportEntry {
  id: string;
  timestamp: string;
  context: string;
  message: string;
}

type TelemetryCounters = Record<string, number>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function createEntryId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function appendArrayEntry<T>(
  key: string,
  entry: T,
  maxEntries: number
) {
  const current = await settingsStore.get<unknown>(key);
  const nextEntries = Array.isArray(current) ? [...current, entry] : [entry];
  await settingsStore.set(key, nextEntries.slice(-maxEntries));
  await settingsStore.save();
}

export async function recordAuditEvent(
  action: string,
  detail?: Record<string, string | number | boolean | null>
) {
  const settings = await loadAppSettings();

  if (!settings.privacy.auditLog) {
    return;
  }

  await appendArrayEntry<AuditLogEntry>(
    AUDIT_LOG_KEY,
    {
      id: createEntryId(),
      timestamp: new Date().toISOString(),
      action,
      detail,
    },
    MAX_AUDIT_LOG_ENTRIES
  );
}

export async function recordCrashReport(context: string, error: unknown) {
  const settings = await loadAppSettings();

  if (!settings.privacy.crashReports) {
    return;
  }

  await appendArrayEntry<CrashReportEntry>(
    CRASH_REPORTS_KEY,
    {
      id: createEntryId(),
      timestamp: new Date().toISOString(),
      context,
      message: toErrorMessage(error),
    },
    MAX_CRASH_REPORTS
  );
}

export async function recordTelemetryEvent(eventName: string) {
  const settings = await loadAppSettings();

  if (!settings.privacy.telemetry) {
    return;
  }

  const current = await settingsStore.get<unknown>(TELEMETRY_COUNTERS_KEY);
  const counters: TelemetryCounters = isRecord(current)
    ? Object.fromEntries(
        Object.entries(current).map(([key, value]) => [
          key,
          typeof value === "number" ? value : 0,
        ])
      )
    : {};

  counters[eventName] = (counters[eventName] ?? 0) + 1;
  await settingsStore.set(TELEMETRY_COUNTERS_KEY, counters);
  await settingsStore.save();
}

export async function clearPrivacyRuntimeData() {
  await settingsStore.set(AUDIT_LOG_KEY, []);
  await settingsStore.set(CRASH_REPORTS_KEY, []);
  await settingsStore.set(TELEMETRY_COUNTERS_KEY, {});
  await settingsStore.save();
}

export function installPrivacyRuntimeHandlers() {
  if (privacyRuntimeInstalled || typeof window === "undefined") {
    return;
  }

  privacyRuntimeInstalled = true;

  window.addEventListener("error", (event) => {
    void recordCrashReport(
      "window.error",
      event.error ?? new Error(event.message)
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    void recordCrashReport("window.unhandledrejection", event.reason);
  });
}
