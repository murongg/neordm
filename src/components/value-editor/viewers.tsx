import { useEffect, useState, type ReactNode } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  Check,
  Copy,
  Edit3,
  LoaderCircle,
  RotateCw,
  Save,
  Trash2,
} from "lucide-react";
import { useI18n } from "../../i18n";
import { getRedisErrorMessage } from "../../lib/redis";
import type { ZSetMember } from "../../types";
import {
  compactJsonDraft,
  EditorRuntimeSettings,
  estimateTextSize,
  formatJsonDraft,
  getJsonDraftError,
  JsonCodeEditor,
  JsonHighlight,
  parseMaxValueSizeBytes,
  replaceTemplate,
  truncateTextByBytes,
} from "./shared";

export function StringViewer({
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

export function JsonEditorViewer({
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
    <div className="flex w-28 items-center justify-end gap-0.5 opacity-0 transition-opacity duration-150 motion-reduce:transition-none group-hover:opacity-100 group-focus-within:opacity-100">
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

export function HashViewer({
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
            settings.wordWrap
              ? "whitespace-pre-wrap break-all"
              : "whitespace-pre overflow-auto"
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

export function ListViewer({
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

export function SetViewer({
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

export function ZSetViewer({
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
