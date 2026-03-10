import {
  useEffect,
  useState,
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
} from "lucide-react";
import type { KeyValue, RedisConnection, ZSetMember } from "../types";
import { useI18n } from "../i18n";
import { getRedisErrorMessage } from "../lib/redis";
import type { RedisListInsertPosition } from "../lib/redis";
import { useAppSettings } from "../hooks/useAppSettings";
import { RedisStreamViewer } from "./RedisStreamViewer";
import { useToast } from "./ToastProvider";
import {
  HashRowEditDrawer,
  SingleValueEditDrawer,
  ZSetRowEditDrawer,
} from "./value-editor/drawers";
import {
  HashViewer,
  JsonEditorViewer,
  ListViewer,
  SetViewer,
  StringViewer,
  ZSetViewer,
} from "./value-editor/viewers";
import {
  type EditorRuntimeSettings,
  formatTTL,
  formatTTLFull,
  replaceTemplate,
  TYPE_BADGE,
} from "./value-editor/shared";

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
