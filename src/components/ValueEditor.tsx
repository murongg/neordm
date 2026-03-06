import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
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
  RotateCw,
} from "lucide-react";
import type { KeyValue, ZSetMember } from "../types";
import { useI18n } from "../i18n";
import { getRedisErrorMessage } from "../lib/redis";
import { useModalTransition } from "../hooks/useModalTransition";
import type { JsonCodeEditorProps } from "./JsonCodeEditor";
import { useToast } from "./ToastProvider";

const LazyJsonCodeEditor = lazy(() => import("./JsonCodeEditor"));

interface ValueEditorProps {
  keyValue: KeyValue | null;
  onRefreshKeyValue: () => Promise<void>;
  onUpdateHashEntry: (
    key: string,
    oldField: string,
    nextField: string,
    nextValue: string
  ) => Promise<void>;
  onDeleteHashEntry: (key: string, field: string) => Promise<void>;
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

export function ValueEditor({
  keyValue,
  onRefreshKeyValue,
  onUpdateHashEntry,
  onDeleteHashEntry,
  onUpdateZSetEntry,
  onDeleteZSetEntry,
}: ValueEditorProps) {
  const { messages } = useI18n();
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const [editingTTL, setEditingTTL] = useState(false);
  const [ttlInput, setTtlInput] = useState("");
  const [editingHashRow, setEditingHashRow] = useState<{
    field: string;
    value: string;
  } | null>(null);
  const [editingZSetRow, setEditingZSetRow] = useState<{
    member: string;
    score: number;
  } | null>(null);

  useEffect(() => {
    setEditingHashRow(null);
    setEditingZSetRow(null);
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

  const ttlDisplay =
    keyValue.ttl === -1
      ? messages.valueEditor.noExpiry
      : keyValue.ttl === -2
      ? messages.valueEditor.expired
      : formatTTLFull(keyValue.ttl, messages.units.full);
  const usesTableViewer =
    keyValue.type === "hash" || keyValue.type === "zset";

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
            </div>
            <h2 className="text-sm font-mono font-semibold text-base-content truncate">
              {keyValue.key}
            </h2>
          </div>

          <div className="flex items-center gap-1 shrink-0">
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
              className="btn btn-ghost btn-xs cursor-pointer text-error hover:bg-error/10"
              aria-label={messages.valueEditor.deleteKey}
            >
              <Trash2 size={12} />
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
                className="input input-xs w-24 font-mono bg-base-200 user-select-text"
                placeholder={messages.valueEditor.ttlInputPlaceholder}
                autoFocus
              />
              <button
                className="btn btn-ghost btn-xs text-success cursor-pointer"
                onClick={() => setEditingTTL(false)}
              >
                <Save size={11} />
              </button>
              <button
                className="btn btn-ghost btn-xs cursor-pointer"
                onClick={() => setEditingTTL(false)}
              >
                <X size={11} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setTtlInput(String(keyValue.ttl > 0 ? keyValue.ttl : ""));
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
          <StringViewer value={keyValue.value as string} />
        )}
        {keyValue.type === "json" && (
          <JsonEditorViewer value={keyValue.value as string} />
        )}
        {keyValue.type === "stream" && (
          <StringViewer value={keyValue.value as string} />
        )}
        {keyValue.type === "hash" && (
          <HashViewer
            value={keyValue.value as Record<string, string>}
            onCopy={copyText}
            onRefresh={onRefreshKeyValue}
            onEditRow={(field, value) => {
              setEditingZSetRow(null);
              setEditingHashRow({ field, value });
            }}
            onDeleteRow={(field) => onDeleteHashEntry(keyValue.key, field)}
          />
        )}
        {keyValue.type === "list" && (
          <ListViewer
            value={keyValue.value as string[]}
            onCopy={copyText}
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
            onCopy={copyText}
            onRefresh={onRefreshKeyValue}
            onEditRow={(member, score) => {
              setEditingHashRow(null);
              setEditingZSetRow({ member, score });
            }}
            onDeleteRow={(member) => onDeleteZSetEntry(keyValue.key, member)}
          />
        )}

      </div>

      {editingHashRow ? (
        <HashRowEditDrawer
          key={`${keyValue.key}:${editingHashRow.field}`}
          keyName={keyValue.key}
          initialField={editingHashRow.field}
          initialValue={editingHashRow.value}
          onClose={() => setEditingHashRow(null)}
          onSave={async (nextField, nextValue) => {
            await onUpdateHashEntry(
              keyValue.key,
              editingHashRow.field,
              nextField,
              nextValue
            );
          }}
        />
      ) : null}

      {editingZSetRow ? (
        <ZSetRowEditDrawer
          key={`${keyValue.key}:${editingZSetRow.member}`}
          keyName={keyValue.key}
          initialMember={editingZSetRow.member}
          initialScore={editingZSetRow.score}
          onClose={() => setEditingZSetRow(null)}
          onSave={async (nextMember, nextScore) => {
            await onUpdateZSetEntry(
              keyValue.key,
              editingZSetRow.member,
              nextMember,
              nextScore
            );
          }}
        />
      ) : null}

    </div>
  );
}

function StringViewer({ value }: { value: string }) {
  const { messages } = useI18n();
  const [isEditing, setIsEditing] = useState(false);
  const [editVal, setEditVal] = useState(value);

  let formatted = value;
  let isJson = false;
  try {
    formatted = JSON.stringify(JSON.parse(value), null, 2);
    isJson = true;
  } catch {}

  if (isEditing) {
    return (
      <div className="flex flex-col gap-2 h-full">
        <textarea
          value={editVal}
          onChange={(e) => setEditVal(e.target.value)}
          className="textarea textarea-bordered flex-1 font-mono text-xs bg-base-200 resize-none user-select-text"
          autoFocus
        />
        <div className="flex gap-2">
          <button
            onClick={() => setIsEditing(false)}
            className="btn btn-success btn-sm gap-1.5 cursor-pointer"
          >
            <Save size={13} /> {messages.common.save}
          </button>
          <button
            onClick={() => setIsEditing(false)}
            className="btn btn-ghost btn-sm cursor-pointer"
          >
            {messages.common.cancel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative group">
      <button
        onClick={() => setIsEditing(true)}
        className="absolute top-2 right-2 btn btn-ghost btn-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200 cursor-pointer"
      >
        <Edit3 size={11} />
      </button>
      <pre className="text-xs font-mono bg-base-200 rounded-xl p-4 overflow-auto whitespace-pre-wrap break-all user-select-text leading-relaxed">
        {isJson ? (
          <JsonHighlight code={formatted} />
        ) : (
          <span className="text-base-content">{value}</span>
        )}
      </pre>
    </div>
  );
}

function JsonEditorViewer({ value }: { value: string }) {
  const { messages } = useI18n();
  const [draft, setDraft] = useState(() => formatJsonDraft(value));
  const [error, setError] = useState(() => getJsonDraftError(value));

  useEffect(() => {
    setDraft(formatJsonDraft(value));
    setError(getJsonDraftError(value));
  }, [value]);

  const handleReset = () => {
    setDraft(formatJsonDraft(value));
    setError(getJsonDraftError(value));
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleReset}
          className="btn btn-ghost btn-xs cursor-pointer font-mono"
        >
          {messages.common.reset}
        </button>
      </div>
      {error ? (
        <p className="rounded-lg border border-error/15 bg-error/8 px-3 py-2 text-xs text-error">
          {error}
        </p>
      ) : null}
      <JsonCodeEditor
        value={draft}
        onChange={(nextDraft) => {
          setDraft(nextDraft);
          setError(getJsonDraftError(nextDraft));
        }}
        className="h-full min-h-0 flex-1"
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
  onError,
}: {
  onCopy: () => void | Promise<void>;
  onRefresh: () => Promise<void>;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  onError?: (error: unknown) => void;
}) {
  const { messages } = useI18n();
  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDeleteConfirming, setIsDeleteConfirming] = useState(false);
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

  useEffect(() => {
    if (!isDeleteConfirming) {
      return;
    }

    const timer = window.setTimeout(() => {
      setIsDeleteConfirming(false);
    }, 2200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isDeleteConfirming]);

  const handleCopy = () => {
    setIsDeleteConfirming(false);

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
    setIsDeleteConfirming(false);
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

  const handleDelete = () => {
    setCopied(false);

    if (!isDeleteConfirming) {
      setIsDeleteConfirming(true);
      return;
    }

    setIsDeleting(true);

    void Promise.resolve()
      .then(() => onDelete())
      .catch((error) => {
        onError?.(error);
      })
      .finally(() => {
        setIsDeleting(false);
        setIsDeleteConfirming(false);
      });
  };

  const handleEdit = () => {
    setCopied(false);
    setIsDeleteConfirming(false);
    onEdit();
  };

  return (
    <div
      className={`flex w-28 items-center justify-end gap-0.5 transition-opacity duration-150 motion-reduce:transition-none ${
        isDeleteConfirming
          ? "opacity-100"
          : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
      }`}
    >
      {isDeleteConfirming ? (
        <>
          <RowActionButton
            label={messages.common.cancel}
            onClick={() => setIsDeleteConfirming(false)}
          >
            <X size={10} />
          </RowActionButton>
          <RowActionButton
            label={messages.common.delete}
            onClick={handleDelete}
            tone="danger"
            disabled={isDeleting}
          >
            {isDeleting ? (
              <LoaderCircle size={10} className="animate-spin" />
            ) : (
              <Trash2 size={10} />
            )}
          </RowActionButton>
        </>
      ) : (
        <>
          <RowActionButton label={messages.common.copy} onClick={handleCopy}>
            {copied ? <Check size={10} /> : <Copy size={10} />}
          </RowActionButton>
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
            onClick={handleDelete}
            tone="danger"
          >
            <Trash2 size={10} />
          </RowActionButton>
        </>
      )}
    </div>
  );
}

function HashViewer({
  value,
  onCopy,
  onRefresh,
  onEditRow,
  onDeleteRow,
}: {
  value: Record<string, string>;
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
                    className="text-success"
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
    <div className="flex flex-col gap-1.5">
      {value.map((item, index) => (
        <button
          type="button"
          key={index}
          onClick={() => {
            void onCopy(item).then(() => {
              setCopiedIndex(index);
            });
          }}
          className="flex w-full items-start gap-3 rounded-lg bg-base-200/50 p-2.5 text-left transition-colors duration-150 group hover:bg-base-200 cursor-copy"
          aria-label={`${messages.common.copy} ${item}`}
        >
          <span className="text-[10px] font-mono text-base-content/30 mt-0.5 w-5 text-right shrink-0">
            {index}
          </span>
          <span className="text-xs font-mono text-base-content/80 flex-1 min-w-0 break-all">
            {item}
          </span>
          <span className="flex h-5 w-5 shrink-0 items-center justify-center text-base-content/35 transition-colors duration-150 group-hover:text-base-content/60">
            {copiedIndex === index ? (
              <Check size={11} className="text-success" />
            ) : (
              <Copy size={11} />
            )}
          </span>
        </button>
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
  onCopy,
  onRefresh,
  onEditRow,
  onDeleteRow,
}: {
  value: ZSetMember[];
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
                    className="text-right whitespace-nowrap text-success"
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
}: {
  value: string;
  onChange: (nextValue: string) => void;
  className?: string;
  surfaceClassName?: string;
  autoFocus?: boolean;
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
        />
      }
    >
      <LazyJsonCodeEditor
        value={value}
        onChange={onChange}
        className={className}
        surfaceClassName={surfaceClassName}
        autoFocus={autoFocus}
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
}: JsonCodeEditorProps) {
  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl border border-base-content/10 focus-within:border-primary/35 ${surfaceClassName} ${className}`}
    >
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="textarea h-full w-full resize-none overflow-auto border-0 bg-transparent px-3 py-3 font-mono text-xs leading-relaxed outline-none user-select-text"
        spellCheck={false}
        autoFocus={autoFocus}
      />
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
          return `<span style="color:var(--color-primary)">${match}</span>`;
        }
        return `<span style="color:#93c5fd">${match}</span>`;
      }
      if (/true|false/.test(match)) {
        return `<span style="color:#fcd34d">${match}</span>`;
      }
      if (/null/.test(match)) {
        return `<span style="color:#f87171">${match}</span>`;
      }
      return `<span style="color:#c4b5fd">${match}</span>`;
    }
  );

  return <span dangerouslySetInnerHTML={{ __html: highlighted }} />;
}

const TYPE_BADGE: Record<string, string> = {
  string: "badge-info",
  hash: "badge-secondary",
  list: "badge-accent",
  set: "badge-warning",
  zset: "badge-error",
  stream: "badge-primary",
  json: "badge-success",
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
              className="btn btn-success btn-sm gap-1.5 cursor-pointer font-mono"
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
  initialField,
  initialValue,
  onClose,
  onSave,
}: {
  keyName: string;
  initialField: string;
  initialValue: string;
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
    usesJsonValueEditor ? formatJsonDraft(initialValue) : initialValue
  );
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const jsonValidationError = usesJsonValueEditor ? getJsonDraftError(value) : "";
  const error = saveError || jsonValidationError;

  const handleResetValue = () => {
    setValue(formatJsonDraft(initialValue));
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
      title={messages.common.edit}
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
  initialMember,
  initialScore,
  onClose,
  onSave,
}: {
  keyName: string;
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
      title={messages.common.edit}
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
