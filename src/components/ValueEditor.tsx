import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  Copy,
  Trash2,
  Clock,
  Edit3,
  Check,
  X,
  Save,
  ChevronRight,
  LoaderCircle,
  Plus,
  RotateCw,
} from "lucide-react";
import type { KeyValue, RedisConnection, ZSetMember } from "../types";
import { useI18n } from "../i18n";
import { getRedisErrorMessage } from "../lib/redis";
import type { RedisListInsertPosition } from "../lib/redis";
import { useAppSettings } from "../hooks/useAppSettings";
import { useModalTransition } from "../hooks/useModalTransition";
import type { JsonCodeEditorProps } from "./JsonCodeEditor";
import { RedisStreamViewer } from "./RedisStreamViewer";
import { useToast } from "./ToastProvider";

const LazyJsonCodeEditor = lazy(() => import("./JsonCodeEditor"));

interface ValueEditorProps {
  activeConnection?: RedisConnection;
  selectedDb: number;
  keyValue: KeyValue | null;
  onRefreshKeyValue: () => Promise<void>;
  onDeleteKey: (key: string) => Promise<void>;
  onJumpToClusterNode?: (nodeAddress: string | null) => Promise<void> | void;
  onUpdateStringValue: (key: string, nextValue: string) => Promise<void>;
  onUpdateKeyTtl: (key: string, nextTtl: number) => Promise<void>;
  onUpdateJsonValue: (key: string, nextValue: string) => Promise<void>;
  onAppendListValue: (
    key: string,
    value: string,
    position: RedisListInsertPosition
  ) => Promise<void>;
  onUpdateListValue: (key: string, index: number, value: string) => Promise<void>;
  onDeleteListValue: (key: string, index: number) => Promise<void>;
  onAddSetMember: (key: string, member: string) => Promise<void>;
  onAddHashEntry: (key: string, field: string, value: string) => Promise<void>;
  onUpdateHashEntry: (
    key: string,
    oldField: string,
    nextField: string,
    nextValue: string
  ) => Promise<void>;
  onDeleteHashEntry: (key: string, field: string) => Promise<void>;
  onAddZSetEntry: (key: string, member: string, score: number) => Promise<void>;
  onUpdateZSetEntry: (
    key: string,
    oldMember: string,
    nextMember: string,
    nextScore: number
  ) => Promise<void>;
  onDeleteZSetEntry: (key: string, member: string) => Promise<void>;
}

interface TtlUnits {
  second: string;
  minute: string;
  hour: string;
  day: string;
}

interface EditorRuntimeSettings {
  autoFormatJson: boolean;
  wordWrap: boolean;
  syntaxHighlighting: boolean;
  maxValueSize: string;
  defaultTtl: string;
  hashDisplayMode: "table" | "json";
}

function replaceTemplate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : `{${key}}`
  );
}

export function ValueEditor({
  activeConnection,
  selectedDb,
  keyValue,
  onRefreshKeyValue,
  onDeleteKey,
  onJumpToClusterNode,
  onUpdateStringValue,
  onUpdateKeyTtl,
  onUpdateJsonValue,
  onAppendListValue,
  onUpdateListValue,
  onDeleteListValue,
  onAddSetMember,
  onAddHashEntry,
  onUpdateHashEntry,
  onDeleteHashEntry,
  onAddZSetEntry,
  onUpdateZSetEntry,
  onDeleteZSetEntry,
}: ValueEditorProps) {
  const { messages } = useI18n();
  const appSettings = useAppSettings();
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const [isDeletingKey, setIsDeletingKey] = useState(false);
  const [editingTTL, setEditingTTL] = useState(false);
  const [ttlInput, setTtlInput] = useState("");
  const [isUpdatingTTL, setIsUpdatingTTL] = useState(false);
  const [hashEditorState, setHashEditorState] = useState<{
    mode: "create" | "edit";
    field: string;
    value: string;
  } | null>(null);
  const [zSetEditorState, setZSetEditorState] = useState<{
    mode: "create" | "edit";
    member: string;
    score: number;
  } | null>(null);
  const [singleValueEditorState, setSingleValueEditorState] = useState<{
    kind: "list" | "set";
    mode: "create" | "edit";
    value: string;
    index?: number;
    insertPosition?: RedisListInsertPosition;
  } | null>(null);

  useEffect(() => {
    setEditingTTL(false);
    setTtlInput("");
    setIsDeletingKey(false);
    setIsUpdatingTTL(false);
    setHashEditorState(null);
    setZSetEditorState(null);
    setSingleValueEditorState(null);
  }, [keyValue?.key, keyValue?.type]);

  const copyText = async (text: string) => {
    await navigator.clipboard.writeText(text);
    showToast({
      message: messages.common.copied,
      tone: "success",
    });
  };

  if (!keyValue) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-base-content/30 gap-3">
        <div className="w-16 h-16 rounded-2xl bg-base-200 flex items-center justify-center">
          <ChevronRight size={24} />
        </div>
        <p className="text-sm font-mono">{messages.valueEditor.emptyState}</p>
      </div>
    );
  }

  const handleCopy = () => {
    const text =
      typeof keyValue.value === "string"
        ? keyValue.value
        : JSON.stringify(keyValue.value, null, 2);
    void copyText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSaveTtl = async () => {
    if (isUpdatingTTL) {
      return;
    }

    const rawTtlValue =
      ttlInput.trim().length > 0 ? ttlInput.trim() : editorSettings.defaultTtl;
    const nextTtl = Number.parseInt(rawTtlValue, 10);

    if (!Number.isInteger(nextTtl) || nextTtl < -1 || nextTtl === 0) {
      showToast({
        message: "TTL must be -1 or a positive integer",
        tone: "error",
        duration: 1800,
      });
      return;
    }

    setIsUpdatingTTL(true);

    try {
      await onUpdateKeyTtl(keyValue.key, nextTtl);
      setEditingTTL(false);
      setTtlInput("");
    } catch (error) {
      showToast({
        message: getRedisErrorMessage(error),
        tone: "error",
        duration: 1800,
      });
    } finally {
      setIsUpdatingTTL(false);
    }
  };

  const handleDeleteKey = async () => {
    if (isDeletingKey) {
      return;
    }

    if (appSettings.general.confirmDelete) {
      const confirmed = await confirm(
        replaceTemplate(messages.valueEditor.confirmDeleteKey, {
          key: keyValue.key,
        }),
        {
          title: "NeoRDM",
          kind: "warning",
          okLabel: messages.common.delete,
          cancelLabel: messages.common.cancel,
        }
      );

      if (!confirmed) {
        return;
      }
    }

    setIsDeletingKey(true);

    try {
      await onDeleteKey(keyValue.key);
    } catch (error) {
      showToast({
        message: getRedisErrorMessage(error),
        tone: "error",
        duration: 1800,
      });
    } finally {
      setIsDeletingKey(false);
    }
  };

  const ttlDisplay =
    keyValue.ttl === -1
      ? messages.valueEditor.noExpiry
      : keyValue.ttl === -2
      ? messages.valueEditor.expired
      : formatTTLFull(keyValue.ttl, messages.units.full);
  const usesTableViewer =
    keyValue.type === "hash" || keyValue.type === "zset";
  const editorSettings: EditorRuntimeSettings = appSettings.editor;
  const headerAddLabel =
    keyValue.type === "hash"
      ? messages.keyBrowser.addEntry
      : keyValue.type === "list"
      ? messages.keyBrowser.addValue
      : keyValue.type === "set" || keyValue.type === "zset"
      ? messages.keyBrowser.addMember
      : "";
  const canOpenCreateEditor =
    keyValue.type === "hash" ||
    keyValue.type === "list" ||
    keyValue.type === "set" ||
    keyValue.type === "zset";

  const handleOpenCreateEditor = () => {
    if (keyValue.type === "hash") {
      setHashEditorState({
        mode: "create",
        field: "",
        value: "",
      });
      setZSetEditorState(null);
      setSingleValueEditorState(null);
      return;
    }

    if (keyValue.type === "zset") {
      setZSetEditorState({
        mode: "create",
        member: "",
        score: 0,
      });
      setHashEditorState(null);
      setSingleValueEditorState(null);
      return;
    }

    if (keyValue.type === "list" || keyValue.type === "set") {
      setSingleValueEditorState({
        kind: keyValue.type,
        mode: "create",
        value: "",
        insertPosition: keyValue.type === "list" ? "tail" : undefined,
      });
      setHashEditorState(null);
      setZSetEditorState(null);
    }
  };

  return (
    <div className="relative flex flex-col flex-1 min-h-0">
      <div className="px-4 py-3 border-b border-base-200/50 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`badge badge-xs font-mono uppercase tracking-wider ${TYPE_BADGE[keyValue.type]}`}
              >
                {keyValue.type}
              </span>
              {keyValue.ttl > 0 && (
                <span className="badge badge-xs badge-warning font-mono">
                  {messages.valueEditor.ttlBadge}{" "}
                  {formatTTL(keyValue.ttl, messages.units.compact)}
                </span>
              )}
              {keyValue.ttl === -1 && (
                <span className="badge badge-xs badge-ghost font-mono">
                  {messages.valueEditor.persistent}
                </span>
              )}
              {typeof keyValue.slot === "number" && (
                <span className="badge badge-xs badge-ghost font-mono">
                  slot {keyValue.slot}
                </span>
              )}
              {keyValue.nodeAddress ? (
                <button
                  type="button"
                  onClick={() => {
                    void onJumpToClusterNode?.(keyValue.nodeAddress ?? null);
                  }}
                  className="badge badge-xs badge-ghost gap-1 border-base-content/10 font-mono transition-colors duration-150 hover:border-primary/20 hover:bg-primary/8 hover:text-primary cursor-pointer"
                  title={`${messages.valueEditor.browseNode} · ${keyValue.nodeAddress}`}
                >
                  {keyValue.nodeAddress}
                </button>
              ) : null}
            </div>
            <h2 className="text-sm font-mono font-semibold text-base-content truncate">
              {keyValue.key}
            </h2>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {canOpenCreateEditor ? (
              <button
                type="button"
                onClick={handleOpenCreateEditor}
                className="btn btn-ghost btn-xs gap-1 cursor-pointer"
                aria-label={headerAddLabel}
                title={headerAddLabel}
              >
                <Plus size={12} />
              </button>
            ) : null}
            <button
              onClick={handleCopy}
              className="btn btn-ghost btn-xs gap-1 cursor-pointer"
              aria-label={messages.valueEditor.copyValue}
            >
              {copied ? (
                <Check size={12} className="text-success" />
              ) : (
                <Copy size={12} />
              )}
            </button>
            <button
              onClick={() => {
                void handleDeleteKey();
              }}
              disabled={isDeletingKey}
              className="btn btn-ghost btn-xs cursor-pointer text-error hover:bg-error/10"
              aria-label={messages.valueEditor.deleteKey}
            >
              {isDeletingKey ? (
                <LoaderCircle size={12} className="animate-spin" />
              ) : (
                <Trash2 size={12} />
              )}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-2">
          <Clock size={11} className="text-base-content/40" />
          {editingTTL ? (
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={ttlInput}
                onChange={(e) => setTtlInput(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleSaveTtl();
                  } else if (event.key === "Escape") {
                    setEditingTTL(false);
                  }
                }}
                className="input input-xs w-24 font-mono bg-base-200 user-select-text"
                placeholder={
                  editorSettings.defaultTtl !== "-1"
                    ? editorSettings.defaultTtl
                    : messages.valueEditor.ttlInputPlaceholder
                }
                autoFocus
              />
              <button
                className="btn btn-ghost btn-xs text-primary cursor-pointer"
                onClick={() => void handleSaveTtl()}
                disabled={isUpdatingTTL}
              >
                {isUpdatingTTL ? (
                  <LoaderCircle size={11} className="animate-spin" />
                ) : (
                  <Save size={11} />
                )}
              </button>
              <button
                className="btn btn-ghost btn-xs cursor-pointer"
                onClick={() => {
                  setEditingTTL(false);
                  setTtlInput("");
                }}
                disabled={isUpdatingTTL}
              >
                <X size={11} />
              </button>
            </div>
          ) : (
              <button
                onClick={() => {
                  setTtlInput(
                    String(
                      keyValue.ttl > 0
                        ? keyValue.ttl
                        : editorSettings.defaultTtl !== "-1"
                        ? editorSettings.defaultTtl
                        : ""
                    )
                  );
                  setEditingTTL(true);
                }}
              className="text-xs font-mono text-base-content/50 hover:text-base-content cursor-pointer flex items-center gap-1 transition-colors duration-150"
            >
              {ttlDisplay}
              <Edit3 size={9} className="opacity-0 group-hover:opacity-100" />
            </button>
          )}
        </div>
      </div>

      <div
        className={`flex-1 min-h-0 p-4 ${
          usesTableViewer ? "overflow-hidden" : "overflow-auto"
        } relative`}
      >
        {keyValue.type === "string" && (
          <StringViewer
            value={keyValue.value as string}
            settings={editorSettings}
            onSave={(nextValue) => onUpdateStringValue(keyValue.key, nextValue)}
          />
        )}
        {keyValue.type === "json" && (
          <JsonEditorViewer
            value={keyValue.value as string}
            settings={editorSettings}
            onSave={(nextValue) => onUpdateJsonValue(keyValue.key, nextValue)}
          />
        )}
        {keyValue.type === "stream" && (
          <RedisStreamViewer
            activeConnection={activeConnection}
            selectedDb={selectedDb}
            keyName={keyValue.key}
            rawValue={keyValue.value as string}
            onCopy={copyText}
            onRefreshStream={onRefreshKeyValue}
          />
        )}
        {keyValue.type === "hash" && (
          <HashViewer
            value={keyValue.value as Record<string, string>}
            settings={editorSettings}
            confirmDeleteEnabled={appSettings.general.confirmDelete}
            onCopy={copyText}
            onRefresh={onRefreshKeyValue}
            onEditRow={(field, value) => {
              setZSetEditorState(null);
              setSingleValueEditorState(null);
              setHashEditorState({
                mode: "edit",
                field,
                value,
              });
            }}
            onDeleteRow={(field) => onDeleteHashEntry(keyValue.key, field)}
          />
        )}
        {keyValue.type === "list" && (
          <ListViewer
            value={keyValue.value as string[]}
            confirmDeleteEnabled={appSettings.general.confirmDelete}
            onCopy={copyText}
            onEditValue={(index, value) => {
              setHashEditorState(null);
              setZSetEditorState(null);
              setSingleValueEditorState({
                kind: "list",
                mode: "edit",
                value,
                index,
              });
            }}
            onDeleteValue={(index) => onDeleteListValue(keyValue.key, index)}
            onRefresh={onRefreshKeyValue}
          />
        )}
        {keyValue.type === "set" && (
          <SetViewer
            value={keyValue.value as string[]}
            onCopy={copyText}
          />
        )}
        {keyValue.type === "zset" && (
          <ZSetViewer
            value={keyValue.value as ZSetMember[]}
            confirmDeleteEnabled={appSettings.general.confirmDelete}
            onCopy={copyText}
            onRefresh={onRefreshKeyValue}
            onEditRow={(member, score) => {
              setHashEditorState(null);
              setSingleValueEditorState(null);
              setZSetEditorState({
                mode: "edit",
                member,
                score,
              });
            }}
            onDeleteRow={(member) => onDeleteZSetEntry(keyValue.key, member)}
          />
        )}

      </div>

      {hashEditorState ? (
        <HashRowEditDrawer
          key={`${keyValue.key}:${hashEditorState.mode}:${hashEditorState.field}`}
          keyName={keyValue.key}
          mode={hashEditorState.mode}
          initialField={hashEditorState.field}
          initialValue={hashEditorState.value}
          settings={editorSettings}
          onClose={() => setHashEditorState(null)}
          onSave={async (nextField, nextValue) => {
            if (hashEditorState.mode === "create") {
              await onAddHashEntry(keyValue.key, nextField, nextValue);
              return;
            }

            await onUpdateHashEntry(keyValue.key, hashEditorState.field, nextField, nextValue);
          }}
        />
      ) : null}

      {zSetEditorState ? (
        <ZSetRowEditDrawer
          key={`${keyValue.key}:${zSetEditorState.mode}:${zSetEditorState.member}`}
          keyName={keyValue.key}
          mode={zSetEditorState.mode}
          initialMember={zSetEditorState.member}
          initialScore={zSetEditorState.score}
          onClose={() => setZSetEditorState(null)}
          onSave={async (nextMember, nextScore) => {
            if (zSetEditorState.mode === "create") {
              await onAddZSetEntry(keyValue.key, nextMember, nextScore);
              return;
            }

            await onUpdateZSetEntry(
              keyValue.key,
              zSetEditorState.member,
              nextMember,
              nextScore
            );
          }}
        />
      ) : null}

      {singleValueEditorState ? (
        <SingleValueEditDrawer
          key={`${keyValue.key}:${singleValueEditorState.kind}:${singleValueEditorState.mode}:${singleValueEditorState.index ?? "new"}`}
          keyName={keyValue.key}
          mode={singleValueEditorState.mode}
          kind={singleValueEditorState.kind}
          initialValue={singleValueEditorState.value}
          initialInsertPosition={singleValueEditorState.insertPosition}
          settings={editorSettings}
          onClose={() => setSingleValueEditorState(null)}
          onSave={async (nextValue, insertPosition) => {
            if (singleValueEditorState.kind === "list") {
              if (singleValueEditorState.mode === "edit") {
                await onUpdateListValue(
                  keyValue.key,
                  singleValueEditorState.index ?? 0,
                  nextValue
                );
                return;
              }

              await onAppendListValue(keyValue.key, nextValue, insertPosition ?? "tail");
              return;
            }

            await onAddSetMember(keyValue.key, nextValue);
          }}
        />
      ) : null}

    </div>
  );
}

function StringViewer({
  value,
  settings,
  onSave,
}: {
  value: string;
  settings: EditorRuntimeSettings;
  onSave?: (nextValue: string) => Promise<void>;
}) {
  const { messages } = useI18n();
  const [isEditing, setIsEditing] = useState(false);
  const [editVal, setEditVal] = useState(value);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setEditVal(value);
    setIsEditing(false);
    setError("");
    setIsSaving(false);
  }, [value]);

  const maxPreviewBytes = parseMaxValueSizeBytes(settings.maxValueSize);
  const canAutoFormat =
    settings.autoFormatJson && estimateTextSize(value) <= maxPreviewBytes;
  let formatted = value;
  let isJson = false;
  if (canAutoFormat) {
    try {
      formatted = JSON.stringify(JSON.parse(value), null, 2);
      isJson = true;
    } catch {}
  }
  const editorModeLabel = isJson ? "JSON" : "TEXT";
  const previewValue = truncateTextByBytes(
    isJson ? formatted : value,
    maxPreviewBytes
  );

  const handleSave = async () => {
    if (!onSave) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      await onSave(editVal);
      setIsEditing(false);
    } catch (saveError) {
      setError(getRedisErrorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  if (isEditing) {
    return (
      <div className="flex h-full flex-col gap-2">
        <JsonCodeEditor
          value={editVal}
          onChange={setEditVal}
          className="min-h-0 flex-1"
          autoFocus
          mode={isJson ? "json" : "text"}
          wordWrap={settings.wordWrap}
          syntaxHighlightingEnabled={settings.syntaxHighlighting}
        />
        {error ? (
          <p className="rounded-lg border border-error/15 bg-error/8 px-3 py-2 text-xs text-error">
            {error}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <span className="badge badge-xs badge-ghost font-mono uppercase tracking-wider text-base-content/50">
            {editorModeLabel}
          </span>
          <div className="flex gap-2">
          <button
            onClick={() => void handleSave()}
            disabled={isSaving}
            className="btn btn-primary btn-sm gap-1.5 cursor-pointer disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <LoaderCircle size={13} className="animate-spin" />
            ) : (
              <Save size={13} />
            )}{" "}
            {messages.common.save}
          </button>
          <button
            onClick={() => {
              setEditVal(value);
              setError("");
              setIsEditing(false);
            }}
            disabled={isSaving}
            className="btn btn-ghost btn-sm cursor-pointer disabled:cursor-not-allowed"
          >
            {messages.common.cancel}
          </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative group">
      <button
        disabled={!onSave}
        onClick={() => {
          setEditVal(
            isJson && settings.autoFormatJson ? formatJsonDraft(value) : value
          );
          setError("");
          setIsEditing(true);
        }}
        className="absolute top-2 right-2 btn btn-ghost btn-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200 cursor-pointer disabled:pointer-events-none disabled:opacity-0"
      >
        <Edit3 size={11} />
      </button>
      <pre
        className={`text-xs font-mono bg-base-200 rounded-xl p-4 overflow-auto user-select-text leading-relaxed ${
          settings.wordWrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"
        }`}
      >
        {isJson && settings.syntaxHighlighting ? (
          <JsonHighlight code={previewValue} />
        ) : (
          <span className="text-base-content">{previewValue}</span>
        )}
      </pre>
    </div>
  );
}

function JsonEditorViewer({
  value,
  settings,
  onSave,
}: {
  value: string;
  settings: EditorRuntimeSettings;
  onSave?: (nextValue: string) => Promise<void>;
}) {
  const { messages } = useI18n();
  const shouldAutoFormat =
    settings.autoFormatJson &&
    estimateTextSize(value) <= parseMaxValueSizeBytes(settings.maxValueSize);
  const [draft, setDraft] = useState(() =>
    shouldAutoFormat ? formatJsonDraft(value) : value
  );
  const [error, setError] = useState(() => getJsonDraftError(value));
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraft(shouldAutoFormat ? formatJsonDraft(value) : value);
    setError(getJsonDraftError(value));
    setSaveError("");
    setIsSaving(false);
  }, [shouldAutoFormat, value]);

  const handleReset = () => {
    setDraft(shouldAutoFormat ? formatJsonDraft(value) : value);
    setError(getJsonDraftError(value));
    setSaveError("");
  };

  const handleSave = async () => {
    if (!onSave || error) {
      return;
    }

    setIsSaving(true);
    setSaveError("");

    try {
      await onSave(compactJsonDraft(draft));
    } catch (saveError) {
      setSaveError(getRedisErrorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!onSave || !!error || isSaving}
          className="btn btn-primary btn-sm gap-1.5 cursor-pointer disabled:cursor-not-allowed"
        >
          {isSaving ? (
            <LoaderCircle size={13} className="animate-spin" />
          ) : (
            <Save size={13} />
          )}{" "}
          {messages.common.save}
        </button>
        <button
          type="button"
          onClick={handleReset}
          disabled={isSaving}
          className="btn btn-ghost btn-xs cursor-pointer font-mono disabled:cursor-not-allowed"
        >
          {messages.common.reset}
        </button>
      </div>
      {error || saveError ? (
        <p className="rounded-lg border border-error/15 bg-error/8 px-3 py-2 text-xs text-error">
          {error || saveError}
        </p>
      ) : null}
      <JsonCodeEditor
        value={draft}
        onChange={(nextDraft) => {
          setDraft(nextDraft);
          setError(getJsonDraftError(nextDraft));
          setSaveError("");
        }}
        className="h-full min-h-0 flex-1"
        wordWrap={settings.wordWrap}
        syntaxHighlightingEnabled={settings.syntaxHighlighting}
      />
    </div>
  );
}

function TableActionError({ error }: { error: string }) {
  if (!error) {
    return null;
  }

  return (
    <div className="rounded-lg border border-error/15 bg-error/8 px-3 py-2 text-[11px] text-error">
      {error}
    </div>
  );
}

function CopyableCellValue({
  displayValue,
  copyValue,
  className,
  onCopy,
}: {
  displayValue: string;
  copyValue?: string;
  className?: string;
  onCopy: (text: string) => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = window.setTimeout(() => {
      setCopied(false);
    }, 900);

    return () => {
      window.clearTimeout(timer);
    };
  }, [copied]);

  return (
    <button
      type="button"
      onClick={() => {
        void onCopy(copyValue ?? displayValue).then(() => {
          setCopied(true);
        });
      }}
      className={`block w-full cursor-copy truncate text-left font-mono text-xs transition-colors duration-150 motion-reduce:transition-none ${
        copied ? "text-success" : ""
      } ${className ?? ""}`}
    >
      {displayValue}
    </button>
  );
}

function RowActionButton({
  label,
  onClick,
  tone = "default",
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  tone?: "default" | "danger" | "success";
  disabled?: boolean;
  children: ReactNode;
}) {
  const toneClass =
    tone === "danger"
      ? "text-error hover:bg-error/10 hover:text-error"
      : tone === "success"
      ? "text-success hover:bg-success/10 hover:text-success"
      : "text-base-content/50 hover:bg-base-100 hover:text-base-content";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`btn btn-ghost btn-xs h-6 min-h-6 w-6 rounded-md border-0 p-0 transition-colors duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50 ${toneClass}`}
    >
      {children}
    </button>
  );
}

function TableRowActions({
  onCopy,
  onRefresh,
  onEdit,
  onDelete,
  showCopyAction = true,
  confirmDeleteEnabled = false,
  confirmDeleteMessage,
  onError,
}: {
  onCopy: () => void | Promise<void>;
  onRefresh: () => Promise<void>;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  showCopyAction?: boolean;
  confirmDeleteEnabled?: boolean;
  confirmDeleteMessage?: string;
  onError?: (error: unknown) => void;
}) {
  const { messages } = useI18n();
  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = window.setTimeout(() => {
      setCopied(false);
    }, 1400);

    return () => {
      window.clearTimeout(timer);
    };
  }, [copied]);

  const handleCopy = () => {
    Promise.resolve()
      .then(() => onCopy())
      .then(() => {
        setCopied(true);
      })
      .catch((error) => {
        onError?.(error);
      });
  };

  const handleRefresh = () => {
    setCopied(false);
    setIsRefreshing(true);

    void Promise.resolve()
      .then(() => onRefresh())
      .catch((error) => {
        onError?.(error);
      })
      .finally(() => {
        setIsRefreshing(false);
      });
  };

  const handleDelete = async () => {
    setCopied(false);

    if (confirmDeleteEnabled && confirmDeleteMessage) {
      const confirmed = await confirm(confirmDeleteMessage, {
        title: "NeoRDM",
        kind: "warning",
        okLabel: messages.common.delete,
        cancelLabel: messages.common.cancel,
      });

      if (!confirmed) {
        return;
      }
    }

    setIsDeleting(true);

    await Promise.resolve()
      .then(() => onDelete())
      .catch((error) => {
        onError?.(error);
      })
      .finally(() => {
        setIsDeleting(false);
      });
  };

  const handleEdit = () => {
    setCopied(false);
    onEdit();
  };

  return (
    <div
      className="flex w-28 items-center justify-end gap-0.5 opacity-0 transition-opacity duration-150 motion-reduce:transition-none group-hover:opacity-100 group-focus-within:opacity-100"
    >
      {showCopyAction ? (
        <RowActionButton label={messages.common.copy} onClick={handleCopy}>
          {copied ? <Check size={10} /> : <Copy size={10} />}
        </RowActionButton>
      ) : null}
      <RowActionButton
        label={messages.common.refresh}
        onClick={handleRefresh}
        disabled={isRefreshing}
      >
        {isRefreshing ? (
          <LoaderCircle size={10} className="animate-spin" />
        ) : (
          <RotateCw size={10} />
        )}
      </RowActionButton>
      <RowActionButton label={messages.common.edit} onClick={handleEdit}>
        <Edit3 size={10} />
      </RowActionButton>
      <RowActionButton
        label={messages.common.delete}
        onClick={() => {
          void handleDelete();
        }}
        tone="danger"
        disabled={isDeleting}
      >
        {isDeleting ? (
          <LoaderCircle size={10} className="animate-spin" />
        ) : (
          <Trash2 size={10} />
        )}
      </RowActionButton>
    </div>
  );
}

function HashViewer({
  value,
  settings,
  confirmDeleteEnabled,
  onCopy,
  onRefresh,
  onEditRow,
  onDeleteRow,
}: {
  value: Record<string, string>;
  settings: EditorRuntimeSettings;
  confirmDeleteEnabled: boolean;
  onCopy: (text: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onEditRow: (field: string, value: string) => void;
  onDeleteRow: (field: string) => Promise<void>;
}) {
  const { messages } = useI18n();
  const entries = Object.entries(value);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    setActionError("");
  }, [value]);

  if (settings.hashDisplayMode === "json") {
    const jsonText = truncateTextByBytes(
      JSON.stringify(value, null, 2),
      parseMaxValueSizeBytes(settings.maxValueSize)
    );

    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        <TableActionError error={actionError} />
        <pre
          className={`rounded-xl border border-base-200/50 bg-base-200/40 p-4 text-xs font-mono leading-relaxed user-select-text ${
            settings.wordWrap ? "whitespace-pre-wrap break-all" : "whitespace-pre overflow-auto"
          }`}
        >
          {settings.syntaxHighlighting ? (
            <JsonHighlight code={jsonText} />
          ) : (
            <span className="text-base-content">{jsonText}</span>
          )}
        </pre>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <TableActionError error={actionError} />
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-xl border border-base-200/50">
        <table className="table table-xs table-pin-rows table-fixed w-full">
          <thead>
            <tr className="bg-base-200/80">
              <th className="w-12 font-mono text-base-content/50 text-center whitespace-nowrap">
                {messages.valueEditor.headers.index}
              </th>
              <th className="w-[28%] font-mono text-base-content/50 whitespace-nowrap">
                {messages.valueEditor.field}
              </th>
              <th className="font-mono text-base-content/50 whitespace-nowrap">
                {messages.valueEditor.value}
              </th>
              <th className="w-28 whitespace-nowrap" />
            </tr>
          </thead>
          <tbody>
            {entries.map(([field, val], index) => (
              <tr key={field} className="hover:bg-base-200/30 group">
              <td className="font-mono text-base-content/30 text-center text-[10px] whitespace-nowrap align-top">
                {index + 1}
              </td>
                <td className="max-w-0 align-top">
                  <CopyableCellValue
                    displayValue={field}
                    className="text-primary"
                    onCopy={onCopy}
                  />
                </td>
                <td className="max-w-0 align-top">
                  <CopyableCellValue
                    displayValue={val}
                    className="text-base-content/80"
                    onCopy={onCopy}
                  />
                </td>
                <td className="whitespace-nowrap align-top">
                  <TableRowActions
                    onCopy={() => {
                      setActionError("");
                      return onCopy(
                        JSON.stringify(
                          {
                            field,
                            value: val,
                          },
                          null,
                          2
                        )
                      );
                    }}
                    onRefresh={async () => {
                      setActionError("");
                      await onRefresh();
                    }}
                    onEdit={() => {
                      setActionError("");
                      onEditRow(field, val);
                    }}
                    onDelete={async () => {
                      setActionError("");
                      await onDeleteRow(field);
                    }}
                    confirmDeleteEnabled={confirmDeleteEnabled}
                    confirmDeleteMessage={replaceTemplate(
                      messages.valueEditor.confirmDeleteField,
                      { field }
                    )}
                    onError={(error) => {
                      setActionError(getRedisErrorMessage(error));
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ListViewer({
  value,
  confirmDeleteEnabled,
  onCopy,
  onRefresh,
  onEditValue,
  onDeleteValue,
}: {
  value: string[];
  confirmDeleteEnabled: boolean;
  onCopy: (text: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onEditValue: (index: number, value: string) => void;
  onDeleteValue: (index: number) => Promise<void>;
}) {
  const { messages } = useI18n();
  const [actionError, setActionError] = useState("");

  return (
    <div className="flex flex-col gap-2">
      <TableActionError error={actionError} />
      {value.map((item, index) => (
        <div
          key={index}
          className="group flex w-full items-start gap-2 rounded-lg bg-base-200/50 p-2.5 transition-colors duration-150 hover:bg-base-200"
        >
          <div className="flex min-w-0 flex-1 items-start gap-3 text-left">
            <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-[10px] text-base-content/30">
              {index}
            </span>
            <span className="min-w-0 flex-1 break-all font-mono text-xs text-base-content/80">
              {item}
            </span>
          </div>
          <div className="shrink-0">
            <TableRowActions
              onCopy={() => {
                setActionError("");
                return onCopy(item);
              }}
              onRefresh={async () => {
                setActionError("");
                await onRefresh();
              }}
              onEdit={() => {
                setActionError("");
                onEditValue(index, item);
              }}
              onDelete={async () => {
                setActionError("");
                await onDeleteValue(index);
              }}
              confirmDeleteEnabled={confirmDeleteEnabled}
              confirmDeleteMessage={replaceTemplate(
                messages.valueEditor.confirmDeleteListItem,
                { index }
              )}
              onError={(error) => {
                setActionError(getRedisErrorMessage(error));
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function SetViewer({
  value,
  onCopy,
}: {
  value: string[];
  onCopy: (text: string) => Promise<void>;
}) {
  const { messages } = useI18n();
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (copiedIndex === null) {
      return;
    }

    const timer = window.setTimeout(() => {
      setCopiedIndex(null);
    }, 900);

    return () => {
      window.clearTimeout(timer);
    };
  }, [copiedIndex]);

  return (
    <div className="flex flex-wrap gap-2">
      {value.map((item, index) => (
        <button
          type="button"
          key={index}
          onClick={() => {
            void onCopy(item).then(() => {
              setCopiedIndex(index);
            });
          }}
          className="flex max-w-full cursor-copy items-center gap-1.5 rounded-full bg-base-200 px-3 py-1.5 transition-colors duration-150 group hover:bg-base-200/80"
          aria-label={`${messages.common.copy} ${item}`}
        >
          <span className="min-w-0 truncate text-xs font-mono text-base-content/80">
            {item}
          </span>
          <span className="flex h-4 w-4 shrink-0 items-center justify-center text-base-content/35 transition-colors duration-150 group-hover:text-base-content/60">
            {copiedIndex === index ? (
              <Check size={9} className="text-success" />
            ) : (
              <Copy size={9} />
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

function ZSetViewer({
  value,
  confirmDeleteEnabled,
  onCopy,
  onRefresh,
  onEditRow,
  onDeleteRow,
}: {
  value: ZSetMember[];
  confirmDeleteEnabled: boolean;
  onCopy: (text: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onEditRow: (member: string, score: number) => void;
  onDeleteRow: (member: string) => Promise<void>;
}) {
  const { messages } = useI18n();
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    setActionError("");
  }, [value]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <TableActionError error={actionError} />
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-xl border border-base-200/50">
        <table
          className="table table-xs table-pin-rows w-full"
          style={{ tableLayout: "fixed" }}
        >
          <colgroup>
            <col className="w-16" />
            <col />
            <col className="w-28" />
            <col className="w-28" />
          </colgroup>
          <thead>
            <tr className="bg-base-200/80">
              <th className="w-16 font-mono text-base-content/50 text-center whitespace-nowrap">
                {messages.valueEditor.rank}
              </th>
              <th className="font-mono text-base-content/50 whitespace-nowrap">
                {messages.valueEditor.member}
              </th>
              <th className="w-28 font-mono text-base-content/50 text-right whitespace-nowrap">
                {messages.valueEditor.score}
              </th>
              <th className="w-28 whitespace-nowrap" />
            </tr>
          </thead>
          <tbody>
            {value.map((item, index) => (
              <tr key={item.member} className="hover:bg-base-200/30 group">
                <td className="font-mono text-center whitespace-nowrap align-top">
                  <span
                    className={`badge badge-xs font-mono ${
                      index === 0
                        ? "badge-warning"
                        : index === 1
                        ? "badge-ghost"
                        : "badge-ghost opacity-50"
                    }`}
                  >
                    #{index + 1}
                  </span>
                </td>
                <td className="max-w-0 align-top">
                  <CopyableCellValue
                    displayValue={item.member}
                    className="text-base-content/80"
                    onCopy={onCopy}
                  />
                </td>
                <td className="w-28 max-w-0 align-top text-right">
                  <CopyableCellValue
                    displayValue={item.score.toLocaleString()}
                    copyValue={String(item.score)}
                    className="text-right whitespace-nowrap text-primary"
                    onCopy={onCopy}
                  />
                </td>
                <td className="w-28 whitespace-nowrap align-top">
                  <TableRowActions
                    onCopy={() => {
                      setActionError("");
                      return onCopy(
                        JSON.stringify(
                          {
                            member: item.member,
                            score: item.score,
                          },
                          null,
                          2
                        )
                      );
                    }}
                    onRefresh={async () => {
                      setActionError("");
                      await onRefresh();
                    }}
                    onEdit={() => {
                      setActionError("");
                      onEditRow(item.member, item.score);
                    }}
                    onDelete={async () => {
                      setActionError("");
                      await onDeleteRow(item.member);
                    }}
                    confirmDeleteEnabled={confirmDeleteEnabled}
                    confirmDeleteMessage={replaceTemplate(
                      messages.valueEditor.confirmDeleteMember,
                      { member: item.member }
                    )}
                    onError={(error) => {
                      setActionError(getRedisErrorMessage(error));
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function JsonCodeEditor({
  value,
  onChange,
  className = "h-[18rem]",
  surfaceClassName = "bg-base-200",
  autoFocus = false,
  mode = "json",
  wordWrap = true,
  syntaxHighlightingEnabled = true,
}: {
  value: string;
  onChange: (nextValue: string) => void;
  className?: string;
  surfaceClassName?: string;
  autoFocus?: boolean;
  mode?: "json" | "text";
  wordWrap?: boolean;
  syntaxHighlightingEnabled?: boolean;
}) {
  return (
    <Suspense
      fallback={
        <JsonCodeEditorFallback
          value={value}
          onChange={onChange}
          className={className}
          surfaceClassName={surfaceClassName}
          autoFocus={autoFocus}
          mode={mode}
          wordWrap={wordWrap}
        />
      }
    >
      <LazyJsonCodeEditor
        value={value}
        onChange={onChange}
        className={className}
        surfaceClassName={surfaceClassName}
        autoFocus={autoFocus}
        mode={mode}
        wordWrap={wordWrap}
        syntaxHighlightingEnabled={syntaxHighlightingEnabled}
      />
    </Suspense>
  );
}

function JsonCodeEditorFallback({
  value,
  onChange,
  className = "h-[18rem]",
  surfaceClassName = "bg-base-200",
  autoFocus = false,
  wordWrap = true,
}: JsonCodeEditorProps) {
  return (
    <div
      className={`relative w-full overflow-visible rounded-xl ${className}`}
    >
      <div
        className={`h-full overflow-hidden rounded-xl border border-base-content/10 ${surfaceClassName}`}
      >
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`textarea h-full w-full resize-none overflow-auto border-0 bg-transparent px-3 py-3 font-mono text-xs leading-relaxed outline-none user-select-text ${
            wordWrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"
          }`}
          spellCheck={false}
          autoFocus={autoFocus}
        />
      </div>
    </div>
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function JsonHighlight({ code }: { code: string }) {
  const highlighted = escapeHtml(code).replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match: string) => {
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          return `<span style="color:var(--neordm-syntax-key)">${match}</span>`;
        }
        return `<span style="color:var(--neordm-syntax-string)">${match}</span>`;
      }
      if (/true|false/.test(match)) {
        return `<span style="color:var(--neordm-syntax-number)">${match}</span>`;
      }
      if (/null/.test(match)) {
        return `<span style="color:var(--neordm-syntax-null)">${match}</span>`;
      }
      return `<span style="color:var(--neordm-syntax-number)">${match}</span>`;
    }
  );

  return (
    <span
      style={{ color: "oklch(var(--bc) / 0.34)" }}
      dangerouslySetInnerHTML={{ __html: highlighted }}
    />
  );
}

const TYPE_BADGE: Record<string, string> = {
  string: "badge-info",
  hash: "badge-secondary",
  list: "badge-accent",
  set: "badge-warning",
  zset: "badge-error",
  stream: "badge-primary",
  json: "badge-primary",
};

function formatTTL(ttl: number, units: TtlUnits): string {
  if (ttl < 60) return `${ttl}${units.second}`;
  if (ttl < 3600) return `${Math.floor(ttl / 60)}${units.minute}`;
  if (ttl < 86400) return `${Math.floor(ttl / 3600)}${units.hour}`;
  return `${Math.floor(ttl / 86400)}${units.day}`;
}

function formatTTLFull(ttl: number, units: TtlUnits): string {
  if (ttl < 60) return `${ttl} ${units.second}`;
  if (ttl < 3600) return `${Math.floor(ttl / 60)} ${units.minute}`;
  if (ttl < 86400) return `${Math.floor(ttl / 3600)} ${units.hour}`;
  return `${Math.floor(ttl / 86400)} ${units.day}`;
}

function formatJsonDraft(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function parseMaxValueSizeBytes(value: string) {
  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1024 * 1024;
  }

  return Math.max(1, Math.round(parsed * 1024 * 1024));
}

function estimateTextSize(value: string) {
  return new TextEncoder().encode(value).length;
}

function truncateTextByBytes(value: string, maxBytes: number) {
  if (estimateTextSize(value) <= maxBytes) {
    return value;
  }

  const encoder = new TextEncoder();
  let end = value.length;

  while (end > 0 && encoder.encode(`${value.slice(0, end)}…`).length > maxBytes) {
    end -= 1;
  }

  return `${value.slice(0, end)}…`;
}

function compactJsonDraft(value: string) {
  try {
    return JSON.stringify(JSON.parse(value));
  } catch {
    return value;
  }
}

function getJsonDraftError(value: string) {
  try {
    JSON.parse(value);
    return "";
  } catch (error) {
    return getRedisErrorMessage(error);
  }
}

function isStructuredJsonText(value: string) {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}

function RowEditDrawerShell({
  title,
  subtitle,
  isSaving,
  error,
  onClose,
  onSave,
  children,
}: {
  title: string;
  subtitle: string;
  isSaving: boolean;
  error: string;
  onClose: () => void;
  onSave: () => Promise<boolean>;
  children: ReactNode;
}) {
  const { messages } = useI18n();
  const { isVisible, requestClose, handleBackdropClick } =
    useModalTransition(onClose);

  return (
    <div
      className={`absolute inset-0 z-30 flex justify-end bg-black/30 backdrop-blur-[1px] transition-opacity duration-200 ease-out motion-reduce:transition-none ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
      onClick={handleBackdropClick}
    >
      <div
        className={`flex h-full w-full max-w-sm flex-col border-l border-base-content/10 bg-base-200 shadow-2xl transition-transform duration-200 ease-out motion-reduce:transition-none ${
          isVisible ? "translate-x-0" : "translate-x-6"
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-base-content/10 px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-mono font-semibold text-base-content/85">
              {title}
            </h3>
            <p className="mt-1 truncate text-[11px] font-mono text-base-content/45">
              {subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="btn btn-ghost btn-xs shrink-0 cursor-pointer"
            aria-label={messages.common.cancel}
          >
            <X size={12} />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-4 py-4">{children}</div>

        <div className="border-t border-base-content/10 px-4 py-3">
          {error ? (
            <p className="mb-3 rounded-lg border border-error/15 bg-error/8 px-3 py-2 text-xs text-error">
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={requestClose}
              disabled={isSaving}
              className="btn btn-ghost btn-sm cursor-pointer"
            >
              {messages.common.cancel}
            </button>
            <button
              type="button"
              onClick={() => {
                void onSave().then((shouldClose) => {
                  if (!shouldClose) return;
                  requestClose();
                });
              }}
              disabled={isSaving}
              className="btn btn-primary btn-sm gap-1.5 cursor-pointer font-mono"
            >
              {isSaving ? <LoaderCircle size={13} className="animate-spin" /> : <Save size={13} />}
              {messages.common.save}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function HashRowEditDrawer({
  keyName,
  mode,
  initialField,
  initialValue,
  settings,
  onClose,
  onSave,
}: {
  keyName: string;
  mode: "create" | "edit";
  initialField: string;
  initialValue: string;
  settings: EditorRuntimeSettings;
  onClose: () => void;
  onSave: (nextField: string, nextValue: string) => Promise<void>;
}) {
  const { messages } = useI18n();
  const usesJsonValueEditor = useMemo(
    () => isStructuredJsonText(initialValue),
    [initialValue]
  );
  const [field, setField] = useState(initialField);
  const [value, setValue] = useState(() =>
    usesJsonValueEditor && settings.autoFormatJson
      ? formatJsonDraft(initialValue)
      : initialValue
  );
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const jsonValidationError = usesJsonValueEditor ? getJsonDraftError(value) : "";
  const error = saveError || jsonValidationError;

  const handleResetValue = () => {
    setValue(
      settings.autoFormatJson ? formatJsonDraft(initialValue) : initialValue
    );
    setSaveError("");
  };

  const handleSave = async () => {
    if (!field.length) {
      setSaveError(`${messages.valueEditor.field} cannot be empty`);
      return false;
    }

    if (usesJsonValueEditor && jsonValidationError) {
      setSaveError(jsonValidationError);
      return false;
    }

    setIsSaving(true);
    setSaveError("");

    try {
      await onSave(
        field,
        usesJsonValueEditor ? compactJsonDraft(value) : value
      );
      return true;
    } catch (saveError) {
      setSaveError(getRedisErrorMessage(saveError));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <RowEditDrawerShell
      title={mode === "create" ? messages.keyBrowser.addEntry : messages.common.edit}
      subtitle={keyName}
      isSaving={isSaving}
      error={error}
      onClose={onClose}
      onSave={handleSave}
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-mono text-base-content/50">
            {messages.valueEditor.field}
          </span>
          <input
            type="text"
            value={field}
            onChange={(event) => {
              setField(event.target.value);
              setSaveError("");
            }}
            className="input input-sm w-full bg-base-100 font-mono user-select-text"
            autoFocus
          />
        </label>
        {usesJsonValueEditor ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-mono text-base-content/50">
                {messages.valueEditor.value}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleResetValue}
                  className="btn btn-ghost btn-xs cursor-pointer font-mono"
                >
                  {messages.common.reset}
                </button>
              </div>
            </div>
            <JsonCodeEditor
              value={value}
              onChange={(nextValue) => {
                setValue(nextValue);
                setSaveError("");
              }}
              className="h-[18rem]"
              surfaceClassName="bg-base-100"
              wordWrap={settings.wordWrap}
              syntaxHighlightingEnabled={settings.syntaxHighlighting}
            />
          </div>
        ) : (
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-mono text-base-content/50">
              {messages.valueEditor.value}
            </span>
            <input
              type="text"
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setSaveError("");
              }}
              className="input input-sm w-full bg-base-100 font-mono user-select-text"
            />
          </label>
        )}
      </div>
    </RowEditDrawerShell>
  );
}

function ZSetRowEditDrawer({
  keyName,
  mode,
  initialMember,
  initialScore,
  onClose,
  onSave,
}: {
  keyName: string;
  mode: "create" | "edit";
  initialMember: string;
  initialScore: number;
  onClose: () => void;
  onSave: (nextMember: string, nextScore: number) => Promise<void>;
}) {
  const { messages } = useI18n();
  const [member, setMember] = useState(initialMember);
  const [score, setScore] = useState(String(initialScore));
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!member.length) {
      setError(`${messages.valueEditor.member} cannot be empty`);
      return false;
    }

    const nextScore = Number(score);

    if (!Number.isFinite(nextScore)) {
      setError("Score must be a valid number");
      return false;
    }

    setIsSaving(true);
    setError("");

    try {
      await onSave(member, nextScore);
      return true;
    } catch (saveError) {
      setError(getRedisErrorMessage(saveError));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <RowEditDrawerShell
      title={mode === "create" ? messages.keyBrowser.addMember : messages.common.edit}
      subtitle={keyName}
      isSaving={isSaving}
      error={error}
      onClose={onClose}
      onSave={handleSave}
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-mono text-base-content/50">
            {messages.valueEditor.member}
          </span>
          <input
            type="text"
            value={member}
            onChange={(event) => setMember(event.target.value)}
            className="input input-sm w-full bg-base-100 font-mono user-select-text"
            autoFocus
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-mono text-base-content/50">
            {messages.valueEditor.score}
          </span>
          <input
            type="number"
            step="any"
            value={score}
            onChange={(event) => setScore(event.target.value)}
            className="input input-sm w-full bg-base-100 font-mono user-select-text"
          />
        </label>
      </div>
    </RowEditDrawerShell>
  );
}

function SingleValueEditDrawer({
  keyName,
  mode,
  kind,
  initialValue,
  initialInsertPosition = "tail",
  settings,
  onClose,
  onSave,
}: {
  keyName: string;
  mode: "create" | "edit";
  kind: "list" | "set";
  initialValue: string;
  initialInsertPosition?: RedisListInsertPosition;
  settings: EditorRuntimeSettings;
  onClose: () => void;
  onSave: (
    nextValue: string,
    insertPosition?: RedisListInsertPosition
  ) => Promise<void>;
}) {
  const { messages } = useI18n();
  const usesJsonValueEditor = useMemo(
    () => mode === "edit" && isStructuredJsonText(initialValue),
    [initialValue, mode]
  );
  const [value, setValue] = useState(() =>
    usesJsonValueEditor && settings.autoFormatJson
      ? formatJsonDraft(initialValue)
      : initialValue
  );
  const [insertPosition, setInsertPosition] =
    useState<RedisListInsertPosition>(initialInsertPosition);
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const jsonValidationError = usesJsonValueEditor ? getJsonDraftError(value) : "";
  const error = saveError || jsonValidationError;
  const label = kind === "list" ? messages.valueEditor.value : messages.valueEditor.member;
  const showsInsertPosition = kind === "list" && mode === "create";
  const title =
    mode === "create"
      ? kind === "list"
        ? messages.keyBrowser.addValue
        : messages.keyBrowser.addMember
      : messages.common.edit;

  const handleResetValue = () => {
    setValue(
      usesJsonValueEditor && settings.autoFormatJson
        ? formatJsonDraft(initialValue)
        : initialValue
    );
    setSaveError("");
  };

  const handleSave = async () => {
    const nextValue = usesJsonValueEditor ? compactJsonDraft(value) : value.trim();

    if (!nextValue.length) {
      setSaveError(`${label} cannot be empty`);
      return false;
    }

    if (usesJsonValueEditor && jsonValidationError) {
      setSaveError(jsonValidationError);
      return false;
    }

    setIsSaving(true);
    setSaveError("");

    try {
      await onSave(nextValue, showsInsertPosition ? insertPosition : undefined);
      return true;
    } catch (saveError) {
      setSaveError(getRedisErrorMessage(saveError));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <RowEditDrawerShell
      title={title}
      subtitle={keyName}
      isSaving={isSaving}
      error={error}
      onClose={onClose}
      onSave={handleSave}
    >
      <div className="flex flex-col gap-4">
        {usesJsonValueEditor ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-mono text-base-content/50">
                {label}
              </span>
              <button
                type="button"
                onClick={handleResetValue}
                className="btn btn-ghost btn-xs cursor-pointer font-mono"
              >
                {messages.common.reset}
              </button>
            </div>
            <JsonCodeEditor
              value={value}
              onChange={(nextValue) => {
                setValue(nextValue);
                setSaveError("");
              }}
              className="h-[18rem]"
              surfaceClassName="bg-base-100"
              wordWrap={settings.wordWrap}
              syntaxHighlightingEnabled={settings.syntaxHighlighting}
              autoFocus
            />
          </div>
        ) : (
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-mono text-base-content/50">{label}</span>
            <input
              type="text"
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setSaveError("");
              }}
              className="input input-sm w-full bg-base-100 font-mono user-select-text"
              autoFocus
            />
          </label>
        )}
        {showsInsertPosition ? (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-base-200/60 py-2">
            <span className="text-[11px] font-mono text-base-content/50">
              {messages.valueEditor.insertPosition}
            </span>
            <div className="tabs tabs-box tabs-xs rounded-lg bg-base-100/70 p-0.5">
              <button
                type="button"
                onClick={() => {
                  setInsertPosition("head");
                  setSaveError("");
                }}
                className={`tab cursor-pointer rounded-md font-mono text-[11px] transition-colors duration-150 ${
                  insertPosition === "head" ? "tab-active" : ""
                }`}
              >
                {messages.valueEditor.insertHead}
              </button>
              <button
                type="button"
                onClick={() => {
                  setInsertPosition("tail");
                  setSaveError("");
                }}
                className={`tab cursor-pointer rounded-md font-mono text-[11px] transition-colors duration-150 ${
                  insertPosition === "tail" ? "tab-active" : ""
                }`}
              >
                {messages.valueEditor.insertTail}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </RowEditDrawerShell>
  );
}
