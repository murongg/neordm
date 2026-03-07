import { useEffect, useRef, useState } from "react";
import { Loader, X, Wifi, Lock, Database } from "lucide-react";
import type { RedisConnection } from "../types";
import { useI18n } from "../i18n";
import { useModalTransition } from "../hooks/useModalTransition";
import { getRandomStableColor } from "../utils/colors";
import {
  getRedisErrorMessage,
  testRedisConnection,
} from "../lib/redis";
import {
  recordCrashReport,
  recordTelemetryEvent,
} from "../lib/privacyRuntime";

interface ConnectionModalProps {
  onClose: () => void;
  onSave: (conn: Omit<RedisConnection, "id" | "status">) => Promise<void> | void;
  connection?: RedisConnection;
}

type TestStatus = "success" | "error";
const TEST_STATUS_TRANSITION_MS = 160;

function createInitialForm(connection?: RedisConnection) {
  return {
    name: connection?.name ?? "",
    host: connection?.host ?? "127.0.0.1",
    port: String(connection?.port ?? 6379),
    password: connection?.password ?? "",
    db: String(connection?.db ?? 0),
    tls: connection?.tls ?? false,
    color:
      connection?.color ??
      getRandomStableColor({
        scope: "connection",
      }),
  };
}

function ConnectionTestStatusAlert({
  status,
  message,
  successLabel,
  failureLabel,
}: {
  status: TestStatus | null;
  message: string;
  successLabel: string;
  failureLabel: string;
}) {
  const [shouldRender, setShouldRender] = useState(Boolean(status));
  const [isVisible, setIsVisible] = useState(Boolean(status));
  const [renderedStatus, setRenderedStatus] = useState<TestStatus | null>(status);
  const [renderedMessage, setRenderedMessage] = useState(message);
  const enterFrameRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (enterFrameRef.current !== null) {
      window.cancelAnimationFrame(enterFrameRef.current);
      enterFrameRef.current = null;
    }

    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    if (status === null) {
      setIsVisible(false);
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null;
        setShouldRender(false);
        setRenderedStatus(null);
        setRenderedMessage("");
      }, TEST_STATUS_TRANSITION_MS);
      return;
    }

    setRenderedStatus(status);
    setRenderedMessage(message);
    setShouldRender(true);
    setIsVisible(false);

    enterFrameRef.current = window.requestAnimationFrame(() => {
      enterFrameRef.current = null;
      setIsVisible(true);
    });
  }, [message, status]);

  useEffect(() => {
    return () => {
      if (enterFrameRef.current !== null) {
        window.cancelAnimationFrame(enterFrameRef.current);
      }

      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  if (!shouldRender || renderedStatus === null) {
    return null;
  }

  return (
    <div
      className={`overflow-hidden px-5 transition-[max-height,padding-bottom,opacity,transform] duration-200 ease-out motion-reduce:transition-none ${
        isVisible
          ? "max-h-28 pb-1 opacity-100 translate-y-0"
          : "max-h-0 pb-0 opacity-0 -translate-y-1"
      }`}
    >
      <div
        className={`rounded-xl border px-3 py-2 text-xs transition-[opacity,transform,background-color,border-color] duration-150 ease-out motion-reduce:transition-none ${
          isVisible
            ? "translate-y-0 scale-100 opacity-100"
            : "-translate-y-1 scale-[0.98] opacity-0"
        } ${
          renderedStatus === "success"
            ? "border-success/15 bg-success/10 text-success"
            : "border-error/15 bg-error/10 text-error"
        }`}
      >
        <div className="flex items-center gap-2 font-mono">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              renderedStatus === "success" ? "bg-success" : "bg-error"
            }`}
          />
          <span>
            {renderedStatus === "success" ? successLabel : failureLabel}
          </span>
        </div>
        {renderedStatus === "error" && renderedMessage && (
          <div className="mt-1 break-words text-[11px] text-error/80">
            {renderedMessage}
          </div>
        )}
      </div>
    </div>
  );
}

export function ConnectionModal({
  onClose,
  onSave,
  connection,
}: ConnectionModalProps) {
  const { messages } = useI18n();
  const { isVisible, requestClose, handleBackdropClick } =
    useModalTransition(onClose);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus | null>(null);
  const [testMessage, setTestMessage] = useState<string>("");
  const [form, setForm] = useState(() => createInitialForm(connection));

  useEffect(() => {
    setForm(createInitialForm(connection));
    setIsTesting(false);
    setIsSaving(false);
    setTestStatus(null);
    setTestMessage("");
  }, [connection]);

  const update = (field: string, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setTestStatus(null);
    setTestMessage("");
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestStatus(null);
    setTestMessage("");
    void recordTelemetryEvent("connection.test");

    try {
      await testRedisConnection({
        host: form.host,
        port: Number(form.port),
        password: form.password,
        db: Number(form.db),
        tls: form.tls,
      });
      setTestStatus("success");
    } catch (error) {
      void recordCrashReport("connection.test", error);
      setTestStatus("error");
      setTestMessage(getRedisErrorMessage(error));
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    if (isSaving) return;

    setIsSaving(true);
    setTestStatus(null);
    setTestMessage("");

    try {
      await onSave({
        name: form.name || `${form.host}:${form.port}`,
        host: form.host,
        port: Number(form.port),
        password: form.password || undefined,
        db: Number(form.db),
        tls: form.tls,
        color: form.color,
      });
      requestClose();
    } catch (error) {
      void recordCrashReport("connection.save", error);
      setTestStatus("error");
      setTestMessage(getRedisErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      onClick={handleBackdropClick}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity duration-200 ease-out motion-reduce:transition-none ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        className={`bg-base-200 rounded-2xl w-full max-w-md mx-4 shadow-2xl border border-base-content/10 overflow-hidden transition-all duration-200 ease-out motion-reduce:transition-none ${
          isVisible
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-3 scale-[0.98] opacity-0"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-base-content/10">
          <h2 className="text-sm font-semibold font-mono">
            {connection ? messages.common.edit : messages.connectionModal.title}
          </h2>
          <button
            onClick={requestClose}
            className="btn btn-ghost btn-xs btn-circle cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>

        {/* Form */}
        <div className="px-5 py-4 flex flex-col gap-4">
          {/* Name */}
          <div>
            <label className="text-[10px] font-mono text-base-content/50 uppercase tracking-wider mb-1.5 block">
              {messages.connectionModal.name}
            </label>
            <div className="relative">
              <input
                type="text"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder={messages.connectionModal.namePlaceholder}
                className="input input-sm w-full bg-base-300 border-base-content/10 pl-12 font-mono text-xs user-select-text"
              />
              <div className="pointer-events-none absolute inset-y-2 left-10 w-px bg-base-content/10" />
              <label className="absolute left-2.5 top-1/2 h-5 w-5 -translate-y-1/2 cursor-pointer">
                <span
                  aria-hidden="true"
                  className="block h-full w-full rounded-full shadow-sm"
                  style={{ backgroundColor: form.color }}
                />
                <input
                  type="color"
                  value={form.color}
                  onChange={(e) => update("color", e.target.value)}
                  aria-label={messages.connectionModal.color}
                  title={messages.connectionModal.color}
                  className="absolute inset-0 cursor-pointer opacity-0"
                />
              </label>
            </div>
          </div>

          {/* Host + Port */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-[10px] font-mono text-base-content/50 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <Wifi size={9} /> {messages.connectionModal.host}
              </label>
              <input
                type="text"
                value={form.host}
                onChange={(e) => update("host", e.target.value)}
                className="input input-sm w-full bg-base-300 border-base-content/10 font-mono text-xs user-select-text"
              />
            </div>
            <div className="w-24">
              <label className="text-[10px] font-mono text-base-content/50 uppercase tracking-wider mb-1.5 block">
                {messages.connectionModal.port}
              </label>
              <input
                type="number"
                value={form.port}
                onChange={(e) => update("port", e.target.value)}
                className="input input-sm w-full bg-base-300 border-base-content/10 font-mono text-xs user-select-text"
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className="text-[10px] font-mono text-base-content/50 uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Lock size={9} /> {messages.connectionModal.password}
            </label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => update("password", e.target.value)}
              placeholder={messages.connectionModal.passwordPlaceholder}
              className="input input-sm w-full bg-base-300 border-base-content/10 font-mono text-xs user-select-text"
            />
          </div>

          {/* DB + TLS row */}
          <div className="flex gap-3 items-end">
            <div className="w-24">
              <label className="text-[10px] font-mono text-base-content/50 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <Database size={9} /> {messages.connectionModal.database}
              </label>
              <input
                type="number"
                min="0"
                max="15"
                value={form.db}
                onChange={(e) => update("db", e.target.value)}
                className="input input-sm w-full bg-base-300 border-base-content/10 font-mono text-xs user-select-text"
              />
            </div>
            <div className="flex-1">
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.tls}
                  onChange={(e) => update("tls", e.target.checked)}
                  className="toggle toggle-sm toggle-success cursor-pointer"
                />
                <span className="text-xs font-mono text-base-content/70">
                  {messages.connectionModal.tls}
                </span>
              </label>
            </div>
          </div>
        </div>

        <ConnectionTestStatusAlert
          status={testStatus}
          message={testMessage}
          successLabel={messages.connectionModal.success}
          failureLabel={messages.connectionModal.failure}
        />

        {/* Footer */}
        <div className="flex justify-between gap-2 px-5 py-4 border-t border-base-content/10">
          <button
            onClick={handleTestConnection}
            disabled={isTesting || isSaving}
            className="btn btn-ghost btn-sm cursor-pointer font-mono"
          >
            {isTesting ? (
              <span className="flex items-center gap-1.5">
                <Loader size={13} className="animate-spin" />
                {messages.connectionModal.testing}
              </span>
            ) : (
              messages.connectionModal.testConnection
            )}
          </button>

          <div className="flex gap-2">
          <button onClick={requestClose} disabled={isSaving} className="btn btn-ghost btn-sm cursor-pointer font-mono">
            {messages.common.cancel}
          </button>
          <button
            onClick={handleSave}
            disabled={isTesting || isSaving}
            className="btn btn-success btn-sm cursor-pointer font-mono"
          >
            {isSaving ? (
              <span className="flex items-center gap-1.5">
                <Loader size={13} className="animate-spin" />
                {messages.common.save}
              </span>
            ) : (
              messages.common.save
            )}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}
