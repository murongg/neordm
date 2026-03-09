import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Database,
  FolderOpen,
  Link2,
  Loader,
  Lock,
  Shield,
  User,
  Waypoints,
  Wifi,
  X,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import type { AppSettings } from "../lib/appSettings";
import {
  getRedisConnectionDefaultName,
  parseRedisConnectionUrl,
} from "../lib/redisConnection";
import type {
  RedisConnection,
  RedisConnectionMode,
  RedisSentinelConfig,
  RedisSentinelNode,
  RedisSshTunnel,
} from "../types";
import { useI18n } from "../i18n";
import { useModalTransition } from "../hooks/useModalTransition";
import { getRandomStableColor } from "../utils/colors";
import { getRedisErrorMessage, testRedisConnection } from "../lib/redis";
import {
  recordCrashReport,
  recordTelemetryEvent,
} from "../lib/privacyRuntime";

type KeyBrowserSettings = Pick<
  AppSettings["general"],
  "keySeparator" | "maxKeys" | "scanCount"
>;

interface ConnectionModalProps {
  onClose: () => void;
  onSave: (conn: Omit<RedisConnection, "id" | "status">) => Promise<void> | void;
  connection?: RedisConnection;
  keyBrowserSettings: KeyBrowserSettings;
  onKeyBrowserSettingsChange: (value: Partial<KeyBrowserSettings>) => void;
}

type TestStatus = "success" | "error";
const TEST_STATUS_TRANSITION_MS = 160;
const DEFAULT_SENTINEL_PORT = 26379;

interface ConnectionFormState {
  name: string;
  url: string;
  mode: RedisConnectionMode;
  host: string;
  port: string;
  sentinelMasterName: string;
  sentinelNodes: string;
  sentinelUsername: string;
  sentinelPassword: string;
  sentinelTls: boolean;
  username: string;
  password: string;
  db: string;
  tls: boolean;
  color: string;
  sshEnabled: boolean;
  sshHost: string;
  sshPort: string;
  sshUsername: string;
  sshPassword: string;
  sshPrivateKeyPath: string;
  sshPassphrase: string;
}

function formatSentinelNodes(nodes?: RedisSentinelNode[]) {
  if (!nodes?.length) {
    return "";
  }

  return nodes.map((node) => `${node.host}:${node.port}`).join("\n");
}

function createInitialForm(connection?: RedisConnection): ConnectionFormState {
  return {
    name: connection?.name ?? "",
    url: "",
    mode: connection?.mode ?? (connection?.sentinel ? "sentinel" : "direct"),
    host: connection?.host ?? "127.0.0.1",
    port: String(connection?.port ?? 6379),
    sentinelMasterName: connection?.sentinel?.masterName ?? "",
    sentinelNodes: formatSentinelNodes(connection?.sentinel?.nodes),
    sentinelUsername: connection?.sentinel?.username ?? "",
    sentinelPassword: connection?.sentinel?.password ?? "",
    sentinelTls: connection?.sentinel?.tls ?? false,
    username: connection?.username ?? "",
    password: connection?.password ?? "",
    db: String(connection?.db ?? 0),
    tls: connection?.tls ?? false,
    color:
      connection?.color ??
      getRandomStableColor({
        scope: "connection",
      }),
    sshEnabled: Boolean(connection?.sshTunnel),
    sshHost: connection?.sshTunnel?.host ?? "",
    sshPort: String(connection?.sshTunnel?.port ?? 22),
    sshUsername: connection?.sshTunnel?.username ?? "",
    sshPassword: connection?.sshTunnel?.password ?? "",
    sshPrivateKeyPath: connection?.sshTunnel?.privateKeyPath ?? "",
    sshPassphrase: connection?.sshTunnel?.passphrase ?? "",
  };
}

function parseSentinelNodes(value: string): RedisSentinelNode[] {
  return value
    .split(/[\n,]/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      let parsedUrl: URL;

      try {
        parsedUrl = new URL(
          segment.includes("://") ? segment : `redis://${segment}`
        );
      } catch {
        throw new Error(`Invalid sentinel node: ${segment}`);
      }

      const host = parsedUrl.hostname.trim();

      if (!host.length) {
        throw new Error(`Invalid sentinel node host: ${segment}`);
      }

      const port = parsedUrl.port
        ? Number.parseInt(parsedUrl.port, 10)
        : DEFAULT_SENTINEL_PORT;

      if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
        throw new Error(`Invalid sentinel node port: ${segment}`);
      }

      return {
        host,
        port,
      };
    });
}

function buildSshTunnelInput(form: ConnectionFormState): RedisSshTunnel | undefined {
  if (!form.sshEnabled) {
    return undefined;
  }

  const host = form.sshHost.trim();
  const port = Number.parseInt(form.sshPort, 10);
  const username = form.sshUsername.trim();

  if (!host.length) {
    throw new Error("SSH host cannot be empty");
  }

  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error("SSH port must be between 1 and 65535");
  }

  if (!username.length) {
    throw new Error("SSH username cannot be empty");
  }

  return {
    host,
    port,
    username,
    password: form.sshPassword || undefined,
    privateKeyPath: form.sshPrivateKeyPath.trim() || undefined,
    passphrase: form.sshPassphrase || undefined,
  };
}

function buildSentinelInput(
  form: ConnectionFormState
): RedisSentinelConfig | undefined {
  if (form.mode !== "sentinel") {
    return undefined;
  }

  const masterName = form.sentinelMasterName.trim();

  if (!masterName.length) {
    throw new Error("Sentinel master name cannot be empty");
  }

  const nodes = parseSentinelNodes(form.sentinelNodes);

  if (!nodes.length) {
    throw new Error("Add at least one sentinel node");
  }

  return {
    masterName,
    nodes,
    username: form.sentinelUsername.trim() || undefined,
    password: form.sentinelPassword || undefined,
    tls: form.sentinelTls,
  };
}

function buildConnectionInput(form: ConnectionFormState) {
  const db = Number.parseInt(form.db, 10);

  if (!Number.isInteger(db) || db < 0) {
    throw new Error("Database must be a non-negative integer");
  }

  const sentinel = buildSentinelInput(form);
  const sshTunnel = buildSshTunnelInput(form);

  if (form.mode === "sentinel") {
    const primaryNode = sentinel?.nodes[0];

    if (!primaryNode) {
      throw new Error("Add at least one sentinel node");
    }

    return {
      host: primaryNode.host,
      port: primaryNode.port,
      mode: "sentinel" as const,
      sentinel,
      username: form.username.trim() || undefined,
      password: form.password || undefined,
      db,
      tls: form.tls,
      sshTunnel,
    };
  }

  const host = form.host.trim();
  const port = Number.parseInt(form.port, 10);

  if (!host.length) {
    throw new Error("Host cannot be empty");
  }

  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error("Port must be between 1 and 65535");
  }

  return {
    host,
    port,
    mode: "direct" as const,
    sentinel: undefined,
    username: form.username.trim() || undefined,
    password: form.password || undefined,
    db,
    tls: form.tls,
    sshTunnel,
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

function FormCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-base-content/8 bg-base-100/85 p-3.5 shadow-[0_8px_24px_rgba(15,23,42,0.035)] backdrop-blur-sm ${className}`}
    >
      {children}
    </section>
  );
}

function FieldLabel({
  icon,
  children,
}: {
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="mb-1 flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-[0.16em] text-base-content/42">
      {icon}
      <span>{children}</span>
    </label>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex h-10 items-center justify-between rounded-lg border border-base-content/8 bg-base-100 px-3 cursor-pointer select-none transition-colors duration-150 hover:border-base-content/12">
      <span className="text-[11px] font-mono text-base-content/68">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="toggle toggle-sm toggle-primary m-0 cursor-pointer"
      />
    </label>
  );
}

export function ConnectionModal({
  onClose,
  onSave,
  connection,
  keyBrowserSettings,
  onKeyBrowserSettingsChange,
}: ConnectionModalProps) {
  const { messages } = useI18n();
  const { isVisible, requestClose, handleBackdropClick } =
    useModalTransition(onClose);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus | null>(null);
  const [testMessage, setTestMessage] = useState<string>("");
  const [form, setForm] = useState(() => createInitialForm(connection));
  const isSentinelMode = form.mode === "sentinel";

  useEffect(() => {
    setForm(createInitialForm(connection));
    setIsTesting(false);
    setIsSaving(false);
    setTestStatus(null);
    setTestMessage("");
  }, [connection]);

  const update = <K extends keyof ConnectionFormState>(
    field: K,
    value: ConnectionFormState[K]
  ) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setTestStatus(null);
    setTestMessage("");
  };

  const handleImportUrl = () => {
    try {
      const parsed = parseRedisConnectionUrl(form.url);

      setForm((previous) => ({
        ...previous,
        host: parsed.host,
        port: String(parsed.port),
        username: parsed.username ?? "",
        password: parsed.password ?? "",
        db: String(parsed.db),
        tls: parsed.tls,
      }));
      setTestStatus(null);
      setTestMessage("");
    } catch (error) {
      setTestStatus("error");
      setTestMessage(getRedisErrorMessage(error));
    }
  };

  const handlePickSshPrivateKeyPath = async () => {
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        defaultPath: form.sshPrivateKeyPath || undefined,
      });

      if (typeof selected === "string" && selected.length > 0) {
        update("sshPrivateKeyPath", selected);
      }
    } catch (error) {
      setTestStatus("error");
      setTestMessage(getRedisErrorMessage(error));
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestStatus(null);
    setTestMessage("");
    void recordTelemetryEvent("connection.test");

    try {
      await testRedisConnection(buildConnectionInput(form));
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
    if (isSaving) {
      return;
    }

    setIsSaving(true);
    setTestStatus(null);
    setTestMessage("");

    try {
      const connectionInput = buildConnectionInput(form);

      await onSave({
        name: form.name.trim() || getRedisConnectionDefaultName(connectionInput),
        host: connectionInput.host,
        port: connectionInput.port,
        mode: connectionInput.mode,
        sentinel: connectionInput.sentinel,
        username: connectionInput.username,
        password: connectionInput.password,
        db: connectionInput.db,
        tls: connectionInput.tls,
        sshTunnel: connectionInput.sshTunnel,
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
        className={`mx-4 flex max-h-[90vh] w-full max-w-[860px] flex-col overflow-hidden rounded-[24px] border border-base-content/10 bg-base-200/95 shadow-[0_24px_64px_rgba(15,23,42,0.2)] transition-all duration-200 ease-out motion-reduce:transition-none ${
          isVisible
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-3 scale-[0.98] opacity-0"
        }`}
      >
        <div className="flex items-center justify-between border-b border-base-content/8 px-5 py-4">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-full shadow-sm"
              style={{ backgroundColor: form.color }}
            />
            <h2 className="text-[15px] font-semibold tracking-tight">
              {connection ? messages.common.edit : messages.connectionModal.title}
            </h2>
          </div>
          <button
            onClick={requestClose}
            className="btn btn-ghost btn-xs btn-circle cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.28fr)_minmax(250px,0.78fr)]">
            <div className="flex flex-col gap-3">
              <FormCard>
                <div className="flex flex-col gap-3">
                  <div>
                    <FieldLabel>{messages.connectionModal.name}</FieldLabel>
                    <div className="relative">
                      <input
                        type="text"
                        value={form.name}
                        onChange={(event) => update("name", event.target.value)}
                        placeholder={messages.connectionModal.namePlaceholder}
                        className="input input-sm h-10 w-full border-base-content/8 bg-base-100 pl-11 font-mono text-xs user-select-text"
                      />
                      <div className="pointer-events-none absolute inset-y-2.5 left-9.5 w-px bg-base-content/10" />
                      <label className="absolute left-2.5 top-1/2 h-5 w-5 -translate-y-1/2 cursor-pointer">
                        <span
                          aria-hidden="true"
                          className="block h-full w-full rounded-full shadow-sm ring-3 ring-base-100"
                          style={{ backgroundColor: form.color }}
                        />
                        <input
                          type="color"
                          value={form.color}
                          onChange={(event) => update("color", event.target.value)}
                          aria-label={messages.connectionModal.color}
                          title={messages.connectionModal.color}
                          className="absolute inset-0 cursor-pointer opacity-0"
                        />
                      </label>
                    </div>
                  </div>

                  <div>
                    <FieldLabel>{messages.connectionModal.mode}</FieldLabel>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        {
                          value: "direct" as const,
                          icon: <Link2 size={12} />,
                          label: messages.connectionModal.direct,
                        },
                        {
                          value: "sentinel" as const,
                          icon: <Waypoints size={12} />,
                          label: messages.connectionModal.sentinel,
                        },
                      ] satisfies Array<{
                        value: RedisConnectionMode;
                        icon: ReactNode;
                        label: string;
                      }>).map((option) => {
                        const isActive = form.mode === option.value;

                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => update("mode", option.value)}
                            className={`flex h-10 items-center justify-center gap-2 rounded-lg border font-mono text-[11px] transition-colors ${
                              isActive
                                ? "border-primary/35 bg-primary/10 text-primary"
                                : "border-base-content/8 bg-base-100 text-base-content/60 hover:bg-base-200"
                            }`}
                          >
                            {option.icon}
                            <span>{option.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {isSentinelMode ? (
                    <>
                      <div>
                        <FieldLabel icon={<Waypoints size={10} />}>
                          {messages.connectionModal.sentinelMasterName}
                        </FieldLabel>
                        <input
                          type="text"
                          value={form.sentinelMasterName}
                          onChange={(event) =>
                            update("sentinelMasterName", event.target.value)
                          }
                          placeholder={
                            messages.connectionModal.sentinelMasterNamePlaceholder
                          }
                          className="input input-sm h-10 w-full border-base-content/8 bg-base-100 font-mono text-xs user-select-text"
                        />
                      </div>
                      <div>
                        <FieldLabel>{messages.connectionModal.sentinelNodes}</FieldLabel>
                        <textarea
                          value={form.sentinelNodes}
                          onChange={(event) =>
                            update("sentinelNodes", event.target.value)
                          }
                          placeholder={
                            messages.connectionModal.sentinelNodesPlaceholder
                          }
                          className="textarea textarea-sm min-h-[88px] w-full resize-none border-base-content/8 bg-base-100 font-mono text-xs leading-5 user-select-text"
                        />
                      </div>
                    </>
                  ) : (
                    <div>
                      <FieldLabel icon={<Link2 size={10} />}>
                        {messages.connectionModal.url}
                      </FieldLabel>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={form.url}
                          onChange={(event) => update("url", event.target.value)}
                          placeholder={messages.connectionModal.urlPlaceholder}
                          className="input input-sm h-10 flex-1 border-base-content/8 bg-base-100 font-mono text-xs user-select-text"
                        />
                        <button
                          type="button"
                          onClick={handleImportUrl}
                          disabled={isTesting || isSaving || !form.url.trim().length}
                          className="btn btn-sm h-10 min-h-10 rounded-lg border-base-content/8 bg-base-100 px-3.5 font-mono text-[11px] text-base-content/70 shadow-none hover:bg-base-200"
                        >
                          {messages.connectionModal.importUrl}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </FormCard>

              <FormCard>
                {!isSentinelMode && (
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7.5rem]">
                    <div>
                      <FieldLabel icon={<Wifi size={10} />}>
                        {messages.connectionModal.host}
                      </FieldLabel>
                      <input
                        type="text"
                        value={form.host}
                        onChange={(event) => update("host", event.target.value)}
                        className="input input-sm h-10 w-full border-base-content/8 bg-base-100 font-mono text-xs user-select-text"
                      />
                    </div>
                    <div>
                      <FieldLabel>{messages.connectionModal.port}</FieldLabel>
                      <input
                        type="number"
                        value={form.port}
                        onChange={(event) => update("port", event.target.value)}
                        className="input input-sm h-10 w-full border-base-content/8 bg-base-100 font-mono text-xs user-select-text"
                      />
                    </div>
                  </div>
                )}

                {isSentinelMode && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <FieldLabel icon={<User size={10} />}>
                        {messages.connectionModal.sentinelUsername}
                      </FieldLabel>
                      <input
                        type="text"
                        value={form.sentinelUsername}
                        onChange={(event) =>
                          update("sentinelUsername", event.target.value)
                        }
                        placeholder={messages.connectionModal.usernamePlaceholder}
                        className="input input-sm h-10 w-full border-base-content/8 bg-base-100 font-mono text-xs user-select-text"
                      />
                    </div>
                    <div>
                      <FieldLabel icon={<Lock size={10} />}>
                        {messages.connectionModal.sentinelPassword}
                      </FieldLabel>
                      <input
                        type="password"
                        value={form.sentinelPassword}
                        onChange={(event) =>
                          update("sentinelPassword", event.target.value)
                        }
                        placeholder={messages.connectionModal.passwordPlaceholder}
                        className="input input-sm h-10 w-full border-base-content/8 bg-base-100 font-mono text-xs user-select-text"
                      />
                    </div>
                  </div>
                )}

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <FieldLabel icon={<User size={10} />}>
                      {messages.connectionModal.username}
                    </FieldLabel>
                    <input
                      type="text"
                      value={form.username}
                      onChange={(event) => update("username", event.target.value)}
                      placeholder={messages.connectionModal.usernamePlaceholder}
                      className="input input-sm h-10 w-full border-base-content/8 bg-base-100 font-mono text-xs user-select-text"
                    />
                  </div>
                  <div>
                    <FieldLabel icon={<Lock size={10} />}>
                      {messages.connectionModal.password}
                    </FieldLabel>
                    <input
                      type="password"
                      value={form.password}
                      onChange={(event) => update("password", event.target.value)}
                      placeholder={messages.connectionModal.passwordPlaceholder}
                      className="input input-sm h-10 w-full border-base-content/8 bg-base-100 font-mono text-xs user-select-text"
                    />
                  </div>
                </div>

                <div
                  className={`mt-3 grid gap-3 ${
                    isSentinelMode
                      ? "sm:grid-cols-[7.5rem_minmax(0,1fr)_minmax(0,1fr)]"
                      : "sm:grid-cols-[7.5rem_minmax(0,1fr)]"
                  }`}
                >
                  <div>
                    <FieldLabel icon={<Database size={10} />}>
                      {messages.connectionModal.database}
                    </FieldLabel>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={form.db}
                      onChange={(event) => update("db", event.target.value)}
                      className="input input-sm h-10 w-full border-base-content/8 bg-base-100 font-mono text-xs user-select-text"
                    />
                  </div>
                  <div>
                    <FieldLabel icon={<Shield size={10} />}>
                      {messages.connectionModal.tls}
                    </FieldLabel>
                    <ToggleField
                      label={messages.connectionModal.tls}
                      checked={form.tls}
                      onChange={(checked) => update("tls", checked)}
                    />
                  </div>
                  {isSentinelMode && (
                    <div>
                      <FieldLabel icon={<Shield size={10} />}>
                        {messages.connectionModal.sentinelTls}
                      </FieldLabel>
                      <ToggleField
                        label={messages.connectionModal.sentinelTls}
                        checked={form.sentinelTls}
                        onChange={(checked) => update("sentinelTls", checked)}
                      />
                    </div>
                  )}
                </div>
              </FormCard>
            </div>

            <div className="flex flex-col gap-3">
              <FormCard className="h-fit">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[13px] font-semibold">
                      <Shield size={13} className="text-base-content/55" />
                      <span>{messages.connectionModal.sshTunnel}</span>
                    </div>
                    <p className="mt-1 text-[10px] font-mono text-base-content/40">
                      {form.sshEnabled
                        ? `${form.sshHost || "—"}:${form.sshPort || "22"}`
                        : messages.connectionModal.sshTunnel}
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={form.sshEnabled}
                    onChange={(event) => update("sshEnabled", event.target.checked)}
                    className="toggle toggle-sm toggle-primary cursor-pointer"
                  />
                </div>

                {form.sshEnabled ? (
                  <div className="mt-3 flex flex-col gap-3 border-t border-base-content/8 pt-3">
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_6.5rem] xl:grid-cols-1">
                      <div>
                        <FieldLabel>{messages.connectionModal.sshHost}</FieldLabel>
                        <input
                          type="text"
                          value={form.sshHost}
                          onChange={(event) => update("sshHost", event.target.value)}
                          className="input input-sm h-10 w-full border-base-content/8 bg-base-100 font-mono text-xs user-select-text"
                        />
                      </div>
                      <div>
                        <FieldLabel>{messages.connectionModal.sshPort}</FieldLabel>
                        <input
                          type="number"
                          value={form.sshPort}
                          onChange={(event) => update("sshPort", event.target.value)}
                          className="input input-sm h-10 w-full border-base-content/8 bg-base-100 font-mono text-xs user-select-text"
                        />
                      </div>
                    </div>

                    <div>
                      <FieldLabel>{messages.connectionModal.sshUsername}</FieldLabel>
                        <input
                          type="text"
                          value={form.sshUsername}
                          onChange={(event) => update("sshUsername", event.target.value)}
                          className="input input-sm h-10 w-full border-base-content/8 bg-base-100 font-mono text-xs user-select-text"
                        />
                      </div>

                    <div>
                      <FieldLabel>{messages.connectionModal.sshPrivateKeyPath}</FieldLabel>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={form.sshPrivateKeyPath}
                          onChange={(event) =>
                            update("sshPrivateKeyPath", event.target.value)
                          }
                          placeholder={
                            messages.connectionModal.sshPrivateKeyPathPlaceholder
                          }
                          className="input input-sm h-10 flex-1 border-base-content/8 bg-base-100 font-mono text-xs user-select-text"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            void handlePickSshPrivateKeyPath();
                          }}
                          className="btn btn-sm h-10 min-h-10 w-10 rounded-lg border-base-content/8 bg-base-100 px-0 text-base-content/65 shadow-none hover:bg-base-200"
                          aria-label={messages.connectionModal.sshPrivateKeyPath}
                          title={messages.connectionModal.sshPrivateKeyPath}
                        >
                          <FolderOpen size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                      <div>
                        <FieldLabel>{messages.connectionModal.sshPassword}</FieldLabel>
                        <input
                          type="password"
                          value={form.sshPassword}
                          onChange={(event) => update("sshPassword", event.target.value)}
                          placeholder={messages.connectionModal.sshPasswordPlaceholder}
                          className="input input-sm h-10 w-full border-base-content/8 bg-base-100 font-mono text-xs user-select-text"
                        />
                      </div>
                      <div>
                        <FieldLabel>{messages.connectionModal.sshPassphrase}</FieldLabel>
                        <input
                          type="password"
                          value={form.sshPassphrase}
                          onChange={(event) => update("sshPassphrase", event.target.value)}
                          placeholder={messages.connectionModal.sshPassphrasePlaceholder}
                          className="input input-sm h-10 w-full border-base-content/8 bg-base-100 font-mono text-xs user-select-text"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-dashed border-base-content/10 bg-base-200/60 px-3.5 py-4 text-center text-[11px] font-mono text-base-content/45">
                    {messages.connectionModal.sshTunnel}
                  </div>
                )}
              </FormCard>

              <FormCard className="h-fit">
                <div className="flex items-center gap-2 text-[13px] font-semibold">
                  <Database size={13} className="text-base-content/55" />
                  <span>{messages.settings.general.keyBrowser}</span>
                </div>

                <div className="mt-3 flex flex-col gap-3 border-t border-base-content/8 pt-3">
                  <div className="grid gap-3 sm:grid-cols-[6rem_minmax(0,1fr)] xl:grid-cols-1">
                    <div>
                      <FieldLabel>{messages.settings.general.keySeparator}</FieldLabel>
                      <input
                        type="text"
                        value={keyBrowserSettings.keySeparator}
                        onChange={(event) =>
                          onKeyBrowserSettingsChange({
                            keySeparator: event.target.value,
                          })
                        }
                        className="input input-sm h-10 w-full border-base-content/8 bg-base-100 font-mono text-center text-xs user-select-text"
                      />
                    </div>
                    <div>
                      <FieldLabel>{messages.settings.general.maxKeys}</FieldLabel>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={keyBrowserSettings.maxKeys}
                        onChange={(event) =>
                          onKeyBrowserSettingsChange({
                            maxKeys: event.target.value,
                          })
                        }
                        className="input input-sm h-10 w-full border-base-content/8 bg-base-100 font-mono text-xs user-select-text"
                      />
                    </div>
                  </div>

                  <div>
                    <FieldLabel>{messages.settings.general.scanCount}</FieldLabel>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={keyBrowserSettings.scanCount}
                      onChange={(event) =>
                        onKeyBrowserSettingsChange({
                          scanCount: event.target.value,
                        })
                      }
                      className="input input-sm h-10 w-full border-base-content/8 bg-base-100 font-mono text-xs user-select-text"
                    />
                  </div>
                </div>
              </FormCard>
            </div>
          </div>
        </div>

        <ConnectionTestStatusAlert
          status={testStatus}
          message={testMessage}
          successLabel={messages.connectionModal.success}
          failureLabel={messages.connectionModal.failure}
        />

        <div className="flex justify-between gap-2 border-t border-base-content/8 px-5 py-3.5">
          <button
            onClick={handleTestConnection}
            disabled={isTesting || isSaving}
            className="btn btn-ghost btn-sm h-10 min-h-10 rounded-lg cursor-pointer font-mono text-[11px]"
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
            <button
              onClick={requestClose}
              disabled={isSaving}
              className="btn btn-ghost btn-sm h-10 min-h-10 rounded-lg cursor-pointer font-mono text-[11px]"
            >
              {messages.common.cancel}
            </button>
            <button
              onClick={handleSave}
              disabled={isTesting || isSaving}
              className="btn btn-primary btn-sm h-10 min-h-10 rounded-lg px-4.5 cursor-pointer font-mono text-[11px] shadow-sm"
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
