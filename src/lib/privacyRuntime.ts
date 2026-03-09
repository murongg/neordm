import { settingsStore } from "./settingsStore";

const AUDIT_LOG_KEY = "privacy.auditLogEntries";
const CRASH_REPORTS_KEY = "privacy.crashReports";
const TELEMETRY_COUNTERS_KEY = "privacy.telemetryCounters";

export async function recordAuditEvent(
  action: string,
  detail?: Record<string, string | number | boolean | null>
) {
  void action;
  void detail;
  return;
}

export async function recordCrashReport(context: string, error: unknown) {
  void context;
  void error;
  return;
}

export async function recordTelemetryEvent(eventName: string) {
  void eventName;
  return;
}

export async function clearPrivacyRuntimeData() {
  await settingsStore.set(AUDIT_LOG_KEY, []);
  await settingsStore.set(CRASH_REPORTS_KEY, []);
  await settingsStore.set(TELEMETRY_COUNTERS_KEY, {});
  await settingsStore.save();
}
