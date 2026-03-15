import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
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
  DATA_TABLE_CELL_CLASS,
  DATA_TABLE_HEADER_CLASS,
  DATA_TABLE_INDEX_CELL_CLASS,
  DATA_TABLE_INDEX_HEADER_CLASS,
  DATA_TABLE_PANEL_CLASS,
  DATA_TABLE_ROW_CLASS,
  DataTable,
} from "../DataTable";
import {
  HeaderToolbar,
  type HeaderToolbarConfig,
  useSyncHeaderToolbar,
} from "./HeaderToolbar";
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
  onRefresh,
  onHeaderToolbarChange,
}: {
  value: string;
  settings: EditorRuntimeSettings;
  onSave?: (nextValue: string) => Promise<void>;
  onRefresh?: () => Promise<void>;
  onHeaderToolbarChange?: (config: HeaderToolbarConfig | null) => void;
}) {
  const { messages } = useI18n();
  const [isEditing, setIsEditing] = useState(false);
  const [editVal, setEditVal] = useState(value);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    setEditVal(value);
    setIsEditing(false);
    setError("");
    setIsSaving(false);
    setIsRefreshing(false);
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

  const handleRefresh = useCallback(async () => {
    if (!onRefresh || isRefreshing || isEditing || isSaving) {
      return;
    }

    setError("");
    setIsRefreshing(true);

    try {
      await onRefresh();
    } catch (refreshError) {
      setError(getRedisErrorMessage(refreshError));
    } finally {
      setIsRefreshing(false);
    }
  }, [isEditing, isRefreshing, isSaving, onRefresh]);

  const headerToolbarConfig = useMemo<HeaderToolbarConfig | null>(
    () =>
      onRefresh
        ? {
            refreshAction: {
              label: messages.common.refresh,
              onClick: () => {
                void handleRefresh();
              },
              disabled: isRefreshing || isEditing || isSaving,
              isLoading: isRefreshing,
            },
          }
        : null,
    [
      handleRefresh,
      isEditing,
      isRefreshing,
      isSaving,
      messages.common.refresh,
      onRefresh,
    ]
  );

  useSyncHeaderToolbar(headerToolbarConfig, onHeaderToolbarChange);

  const localToolbar = onHeaderToolbarChange ? undefined : headerToolbarConfig ? (
    <HeaderToolbar config={headerToolbarConfig} />
  ) : undefined;

  if (isEditing) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        {localToolbar ? <div className="flex shrink-0">{localToolbar}</div> : null}
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
    <div className="flex h-full min-h-0 flex-col gap-2">
      {localToolbar ? <div className="flex shrink-0">{localToolbar}</div> : null}
      {error ? (
        <p className="rounded-lg border border-error/15 bg-error/8 px-3 py-2 text-xs text-error">
          {error}
        </p>
      ) : null}
      <div className="relative min-h-0 flex-1 group">
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
          className={`h-full text-xs font-mono bg-base-200 rounded-xl p-4 overflow-auto user-select-text leading-relaxed ${
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
    </div>
  );
}

export function JsonEditorViewer({
  value,
  settings,
  onSave,
  onRefresh,
  onHeaderToolbarChange,
}: {
  value: string;
  settings: EditorRuntimeSettings;
  onSave?: (nextValue: string) => Promise<void>;
  onRefresh?: () => Promise<void>;
  onHeaderToolbarChange?: (config: HeaderToolbarConfig | null) => void;
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
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    setDraft(shouldAutoFormat ? formatJsonDraft(value) : value);
    setError(getJsonDraftError(value));
    setSaveError("");
    setIsSaving(false);
    setIsRefreshing(false);
  }, [shouldAutoFormat, value]);

  const sourceDraft = shouldAutoFormat ? formatJsonDraft(value) : value;
  const hasUnsavedChanges = draft !== sourceDraft;

  const handleReset = () => {
    setDraft(sourceDraft);
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

  const handleRefresh = useCallback(async () => {
    if (!onRefresh || isRefreshing || isSaving || hasUnsavedChanges) {
      return;
    }

    setSaveError("");
    setIsRefreshing(true);

    try {
      await onRefresh();
    } catch (refreshError) {
      setSaveError(getRedisErrorMessage(refreshError));
    } finally {
      setIsRefreshing(false);
    }
  }, [hasUnsavedChanges, isRefreshing, isSaving, onRefresh]);

  const headerToolbarConfig = useMemo<HeaderToolbarConfig | null>(
    () =>
      onRefresh
        ? {
            refreshAction: {
              label: messages.common.refresh,
              onClick: () => {
                void handleRefresh();
              },
              disabled: isRefreshing || isSaving || hasUnsavedChanges,
              isLoading: isRefreshing,
            },
          }
        : null,
    [
      handleRefresh,
      hasUnsavedChanges,
      isRefreshing,
      isSaving,
      messages.common.refresh,
      onRefresh,
    ]
  );

  useSyncHeaderToolbar(headerToolbarConfig, onHeaderToolbarChange);

  const localToolbar = onHeaderToolbarChange ? undefined : headerToolbarConfig ? (
    <HeaderToolbar config={headerToolbarConfig} />
  ) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {localToolbar ? <div className="flex shrink-0">{localToolbar}</div> : null}
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
      title={displayValue}
      className={`block w-full cursor-copy truncate text-left font-mono text-xs transition-colors duration-150 motion-reduce:transition-none ${
        copied ? "text-success" : ""
      } ${className ?? ""}`}
    >
      {displayValue}
    </button>
  );
}

const TABLE_PANEL_CLASS = `${DATA_TABLE_PANEL_CLASS} flex`;
const TABLE_ACTION_COLUMN_CLASS = "w-24";
const TABLE_ACTION_CELL_CLASS = `${TABLE_ACTION_COLUMN_CLASS} whitespace-nowrap align-top`;

type HeaderToolbarChangeHandler = (config: HeaderToolbarConfig | null) => void;

interface ViewerLoadMoreState {
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
}

interface IndexedValueRow {
  index: number;
  value: string;
}

interface RankedZSetRow {
  rank: number;
  member: string;
  score: number;
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
        : "text-base-content/45 hover:bg-base-100/90 hover:text-base-content/82";

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
        title: messages.ui.appName,
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
    <div className="flex w-24 items-center justify-end gap-0 opacity-0 transition-opacity duration-150 motion-reduce:transition-none group-hover:opacity-100 group-focus-within:opacity-100">
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

function TableViewerFrame({
  error,
  toolbar,
  children,
}: {
  error?: string;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 max-h-full flex-col gap-2">
      <TableActionError error={error ?? ""} />
      {toolbar ? <div className="flex shrink-0">{toolbar}</div> : null}
      <div className={TABLE_PANEL_CLASS}>{children}</div>
    </div>
  );
}

export function HashViewer({
  value,
  settings,
  confirmDeleteEnabled,
  onCopy,
  onCreate,
  onRefresh,
  onEditRow,
  onDeleteRow,
  loadMoreState,
  onHeaderToolbarChange,
}: {
  value: Record<string, string>;
  settings: EditorRuntimeSettings;
  confirmDeleteEnabled: boolean;
  onCopy: (text: string) => Promise<void>;
  onCreate: () => void;
  onRefresh: () => Promise<void>;
  onEditRow: (field: string, value: string) => void;
  onDeleteRow: (field: string) => Promise<void>;
  loadMoreState?: ViewerLoadMoreState;
  onHeaderToolbarChange?: HeaderToolbarChangeHandler;
}) {
  const { messages } = useI18n();
  const entries = Object.entries(value);
  const [actionError, setActionError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const filteredEntries = useMemo(() => {
    const normalizedQuery = deferredSearchQuery.trim().toLocaleLowerCase();

    if (!normalizedQuery) {
      return entries;
    }

    return entries.filter(([field, entryValue]) => {
      return (
        field.toLocaleLowerCase().includes(normalizedQuery) ||
        entryValue.toLocaleLowerCase().includes(normalizedQuery)
      );
    });
  }, [deferredSearchQuery, entries]);

  useEffect(() => {
    setActionError("");
  }, [value]);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) {
      return;
    }

    setActionError("");
    setIsRefreshing(true);

    try {
      await onRefresh();
    } catch (error) {
      setActionError(getRedisErrorMessage(error));
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, onRefresh]);

  const headerToolbarConfig = useMemo<HeaderToolbarConfig>(
    () => ({
      search:
        settings.hashDisplayMode === "json"
          ? undefined
          : {
              value: searchQuery,
              onChange: setSearchQuery,
              placeholder: `${messages.valueEditor.field} / ${messages.valueEditor.value}`,
            },
      createAction: {
        label: messages.keyBrowser.addEntry,
        onClick: onCreate,
      },
      refreshAction: {
        label: messages.common.refresh,
        onClick: () => {
          void handleRefresh();
        },
        disabled: isRefreshing,
        isLoading: isRefreshing,
      },
    }),
    [
      handleRefresh,
      isRefreshing,
      messages.common.refresh,
      messages.keyBrowser.addEntry,
      messages.valueEditor.field,
      messages.valueEditor.value,
      onCreate,
      searchQuery,
      settings.hashDisplayMode,
    ]
  );

  useSyncHeaderToolbar(headerToolbarConfig, onHeaderToolbarChange);

  const localToolbar = onHeaderToolbarChange ? undefined : (
    <HeaderToolbar config={headerToolbarConfig} />
  );

  if (settings.hashDisplayMode === "json") {
    const jsonText = truncateTextByBytes(
      JSON.stringify(value, null, 2),
      parseMaxValueSizeBytes(settings.maxValueSize)
    );

    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        {localToolbar ? <div className="flex shrink-0">{localToolbar}</div> : null}
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
    <TableViewerFrame
      error={actionError}
      toolbar={localToolbar}
    >
      <DataTable
        rows={filteredEntries}
        getRowKey={([field]) => field}
        rowClassName={DATA_TABLE_ROW_CLASS}
        loadMore={
          loadMoreState
            ? {
                hasMore: loadMoreState.hasMore,
                isLoading: loadMoreState.isLoadingMore,
                label: messages.valueEditor.loadMore,
                loadingLabel: messages.valueEditor.loadingMore,
                onLoadMore: loadMoreState.onLoadMore,
              }
            : undefined
        }
        columns={[
          {
            id: "index",
            header: messages.valueEditor.headers.index,
            colClassName: "w-12",
            headerClassName: DATA_TABLE_INDEX_HEADER_CLASS,
            cellClassName: DATA_TABLE_INDEX_CELL_CLASS,
            renderCell: (_, index) => index + 1,
          },
          {
            id: "field",
            header: messages.valueEditor.field,
            colClassName: "w-[28%]",
            headerClassName: DATA_TABLE_HEADER_CLASS,
            cellClassName: DATA_TABLE_CELL_CLASS,
            renderCell: ([field]) => (
              <CopyableCellValue
                displayValue={field}
                className="text-primary/85"
                onCopy={onCopy}
              />
            ),
          },
          {
            id: "value",
            header: messages.valueEditor.value,
            headerClassName: DATA_TABLE_HEADER_CLASS,
            cellClassName: DATA_TABLE_CELL_CLASS,
            renderCell: ([, val]) => (
              <CopyableCellValue
                displayValue={val}
                className="text-base-content/70"
                onCopy={onCopy}
              />
            ),
          },
          {
            id: "actions",
            header: null,
            colClassName: TABLE_ACTION_COLUMN_CLASS,
            headerClassName: `${TABLE_ACTION_COLUMN_CLASS} whitespace-nowrap`,
            cellClassName: TABLE_ACTION_CELL_CLASS,
            renderCell: ([field, val]) => (
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
                  await handleRefresh();
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
            ),
          },
        ]}
      />
    </TableViewerFrame>
  );
}

export function ListViewer({
  value,
  confirmDeleteEnabled,
  onCopy,
  onCreate,
  onRefresh,
  onEditValue,
  onDeleteValue,
  loadMoreState,
  onHeaderToolbarChange,
}: {
  value: string[];
  confirmDeleteEnabled: boolean;
  onCopy: (text: string) => Promise<void>;
  onCreate: () => void;
  onRefresh: () => Promise<void>;
  onEditValue: (index: number, value: string) => void;
  onDeleteValue: (index: number) => Promise<void>;
  loadMoreState?: ViewerLoadMoreState;
  onHeaderToolbarChange?: HeaderToolbarChangeHandler;
}) {
  const { messages } = useI18n();
  const [actionError, setActionError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const valueRows = useMemo<IndexedValueRow[]>(
    () => value.map((item, index) => ({ index, value: item })),
    [value]
  );
  const filteredValue = useMemo(() => {
    const normalizedQuery = deferredSearchQuery.trim().toLocaleLowerCase();

    if (!normalizedQuery) {
      return valueRows;
    }

    return valueRows.filter((row) => {
      return (
        String(row.index).includes(normalizedQuery) ||
        row.value.toLocaleLowerCase().includes(normalizedQuery)
      );
    });
  }, [deferredSearchQuery, valueRows]);

  useEffect(() => {
    setActionError("");
  }, [value]);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) {
      return;
    }

    setActionError("");
    setIsRefreshing(true);

    try {
      await onRefresh();
    } catch (error) {
      setActionError(getRedisErrorMessage(error));
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, onRefresh]);

  const headerToolbarConfig = useMemo<HeaderToolbarConfig>(
    () => ({
      search: {
        value: searchQuery,
        onChange: setSearchQuery,
        placeholder: messages.valueEditor.value,
      },
      createAction: {
        label: messages.keyBrowser.addValue,
        onClick: onCreate,
      },
      refreshAction: {
        label: messages.common.refresh,
        onClick: () => {
          void handleRefresh();
        },
        disabled: isRefreshing,
        isLoading: isRefreshing,
      },
    }),
    [
      handleRefresh,
      isRefreshing,
      messages.common.refresh,
      messages.keyBrowser.addValue,
      messages.valueEditor.value,
      onCreate,
      searchQuery,
    ]
  );

  useSyncHeaderToolbar(headerToolbarConfig, onHeaderToolbarChange);

  const localToolbar = onHeaderToolbarChange ? undefined : (
    <HeaderToolbar config={headerToolbarConfig} />
  );

  return (
    <TableViewerFrame
      error={actionError}
      toolbar={localToolbar}
    >
      <DataTable
        rows={filteredValue}
        getRowKey={(row) => `${row.index}:${row.value}`}
        rowClassName={DATA_TABLE_ROW_CLASS}
        loadMore={
          loadMoreState
            ? {
                hasMore: loadMoreState.hasMore,
                isLoading: loadMoreState.isLoadingMore,
                label: messages.valueEditor.loadMore,
                loadingLabel: messages.valueEditor.loadingMore,
                onLoadMore: loadMoreState.onLoadMore,
              }
            : undefined
        }
        columns={[
          {
            id: "index",
            header: messages.valueEditor.headers.index,
            colClassName: "w-12",
            headerClassName: DATA_TABLE_INDEX_HEADER_CLASS,
            cellClassName: DATA_TABLE_INDEX_CELL_CLASS,
            renderCell: (row) => row.index,
          },
          {
            id: "value",
            header: messages.valueEditor.value,
            headerClassName: DATA_TABLE_HEADER_CLASS,
            cellClassName: DATA_TABLE_CELL_CLASS,
            renderCell: (row) => (
              <CopyableCellValue
                displayValue={row.value}
                className="text-base-content/70"
                onCopy={onCopy}
              />
            ),
          },
          {
            id: "actions",
            header: null,
            colClassName: TABLE_ACTION_COLUMN_CLASS,
            headerClassName: `${TABLE_ACTION_COLUMN_CLASS} whitespace-nowrap`,
            cellClassName: TABLE_ACTION_CELL_CLASS,
            renderCell: (row) => (
              <TableRowActions
                onCopy={() => {
                  setActionError("");
                  return onCopy(row.value);
                }}
                onRefresh={async () => {
                  await handleRefresh();
                }}
                onEdit={() => {
                  setActionError("");
                  onEditValue(row.index, row.value);
                }}
                onDelete={async () => {
                  setActionError("");
                  await onDeleteValue(row.index);
                }}
                confirmDeleteEnabled={confirmDeleteEnabled}
                confirmDeleteMessage={replaceTemplate(
                  messages.valueEditor.confirmDeleteListItem,
                  { index: row.index }
                )}
                onError={(error) => {
                  setActionError(getRedisErrorMessage(error));
                }}
              />
            ),
          },
        ]}
      />
    </TableViewerFrame>
  );
}

export function SetViewer({
  value,
  onCopy,
  onCreate,
  onRefresh,
  loadMoreState,
  onHeaderToolbarChange,
}: {
  value: string[];
  onCopy: (text: string) => Promise<void>;
  onCreate: () => void;
  onRefresh: () => Promise<void>;
  loadMoreState?: ViewerLoadMoreState;
  onHeaderToolbarChange?: HeaderToolbarChangeHandler;
}) {
  const { messages } = useI18n();
  const [actionError, setActionError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const filteredValue = useMemo(() => {
    const normalizedQuery = deferredSearchQuery.trim().toLocaleLowerCase();

    if (!normalizedQuery) {
      return value;
    }

    return value.filter((item) => item.toLocaleLowerCase().includes(normalizedQuery));
  }, [deferredSearchQuery, value]);

  useEffect(() => {
    setActionError("");
  }, [value]);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) {
      return;
    }

    setActionError("");
    setIsRefreshing(true);

    try {
      await onRefresh();
    } catch (error) {
      setActionError(getRedisErrorMessage(error));
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, onRefresh]);

  const headerToolbarConfig = useMemo<HeaderToolbarConfig>(
    () => ({
      search: {
        value: searchQuery,
        onChange: setSearchQuery,
        placeholder: messages.valueEditor.member,
      },
      createAction: {
        label: messages.keyBrowser.addMember,
        onClick: onCreate,
      },
      refreshAction: {
        label: messages.common.refresh,
        onClick: () => {
          void handleRefresh();
        },
        disabled: isRefreshing,
        isLoading: isRefreshing,
      },
    }),
    [
      handleRefresh,
      isRefreshing,
      messages.common.refresh,
      messages.keyBrowser.addMember,
      messages.valueEditor.member,
      onCreate,
      searchQuery,
    ]
  );

  useSyncHeaderToolbar(headerToolbarConfig, onHeaderToolbarChange);

  const localToolbar = onHeaderToolbarChange ? undefined : (
    <HeaderToolbar config={headerToolbarConfig} />
  );

  return (
    <TableViewerFrame
      error={actionError}
      toolbar={localToolbar}
    >
      <DataTable
        rows={filteredValue}
        getRowKey={(item, index) => `${index}:${item}`}
        rowClassName={DATA_TABLE_ROW_CLASS}
        loadMore={
          loadMoreState
            ? {
                hasMore: loadMoreState.hasMore,
                isLoading: loadMoreState.isLoadingMore,
                label: messages.valueEditor.loadMore,
                loadingLabel: messages.valueEditor.loadingMore,
                onLoadMore: loadMoreState.onLoadMore,
              }
            : undefined
        }
        columns={[
          {
            id: "index",
            header: messages.valueEditor.headers.index,
            colClassName: "w-12",
            headerClassName: DATA_TABLE_INDEX_HEADER_CLASS,
            cellClassName: DATA_TABLE_INDEX_CELL_CLASS,
            renderCell: (_, index) => index + 1,
          },
          {
            id: "member",
            header: messages.valueEditor.member,
            headerClassName: DATA_TABLE_HEADER_CLASS,
            cellClassName: DATA_TABLE_CELL_CLASS,
            renderCell: (item) => (
              <CopyableCellValue
                displayValue={item}
                className="text-base-content/70"
                onCopy={onCopy}
              />
            ),
          },
        ]}
      />
    </TableViewerFrame>
  );
}

export function ZSetViewer({
  value,
  confirmDeleteEnabled,
  onCopy,
  onCreate,
  onRefresh,
  onEditRow,
  onDeleteRow,
  loadMoreState,
  onHeaderToolbarChange,
}: {
  value: ZSetMember[];
  confirmDeleteEnabled: boolean;
  onCopy: (text: string) => Promise<void>;
  onCreate: () => void;
  onRefresh: () => Promise<void>;
  onEditRow: (member: string, score: number) => void;
  onDeleteRow: (member: string) => Promise<void>;
  loadMoreState?: ViewerLoadMoreState;
  onHeaderToolbarChange?: HeaderToolbarChangeHandler;
}) {
  const { messages } = useI18n();
  const [actionError, setActionError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const valueRows = useMemo<RankedZSetRow[]>(
    () =>
      value.map((item, index) => ({
        rank: index + 1,
        member: item.member,
        score: item.score,
      })),
    [value]
  );
  const filteredValue = useMemo(() => {
    const normalizedQuery = deferredSearchQuery.trim().toLocaleLowerCase();

    if (!normalizedQuery) {
      return valueRows;
    }

    return valueRows.filter((item) => {
      return (
        item.member.toLocaleLowerCase().includes(normalizedQuery) ||
        String(item.score).toLocaleLowerCase().includes(normalizedQuery) ||
        item.score.toLocaleString().toLocaleLowerCase().includes(normalizedQuery)
      );
    });
  }, [deferredSearchQuery, valueRows]);

  useEffect(() => {
    setActionError("");
  }, [value]);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) {
      return;
    }

    setActionError("");
    setIsRefreshing(true);

    try {
      await onRefresh();
    } catch (error) {
      setActionError(getRedisErrorMessage(error));
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, onRefresh]);

  const headerToolbarConfig = useMemo<HeaderToolbarConfig>(
    () => ({
      search: {
        value: searchQuery,
        onChange: setSearchQuery,
        placeholder: `${messages.valueEditor.member} / ${messages.valueEditor.score}`,
      },
      createAction: {
        label: messages.keyBrowser.addMember,
        onClick: onCreate,
      },
      refreshAction: {
        label: messages.common.refresh,
        onClick: () => {
          void handleRefresh();
        },
        disabled: isRefreshing,
        isLoading: isRefreshing,
      },
    }),
    [
      handleRefresh,
      isRefreshing,
      messages.common.refresh,
      messages.keyBrowser.addMember,
      messages.valueEditor.member,
      messages.valueEditor.score,
      onCreate,
      searchQuery,
    ]
  );

  useSyncHeaderToolbar(headerToolbarConfig, onHeaderToolbarChange);

  const localToolbar = onHeaderToolbarChange ? undefined : (
    <HeaderToolbar config={headerToolbarConfig} />
  );

  return (
    <TableViewerFrame
      error={actionError}
      toolbar={localToolbar}
    >
      <DataTable
        rows={filteredValue}
        getRowKey={(item) => item.member}
        rowClassName={DATA_TABLE_ROW_CLASS}
        loadMore={
          loadMoreState
            ? {
                hasMore: loadMoreState.hasMore,
                isLoading: loadMoreState.isLoadingMore,
                label: messages.valueEditor.loadMore,
                loadingLabel: messages.valueEditor.loadingMore,
                onLoadMore: loadMoreState.onLoadMore,
              }
            : undefined
        }
        columns={[
          {
            id: "rank",
            header: messages.valueEditor.rank,
            colClassName: "w-16",
            headerClassName:
              "w-16 text-center font-mono text-base-content/50 whitespace-nowrap",
            cellClassName: DATA_TABLE_INDEX_CELL_CLASS,
            renderCell: (item) => item.rank,
          },
          {
            id: "member",
            header: messages.valueEditor.member,
            headerClassName: DATA_TABLE_HEADER_CLASS,
            cellClassName: DATA_TABLE_CELL_CLASS,
            renderCell: (item) => (
              <CopyableCellValue
                displayValue={item.member}
                className="text-base-content/70"
                onCopy={onCopy}
              />
            ),
          },
          {
            id: "score",
            header: messages.valueEditor.score,
            colClassName: "w-28",
            headerClassName:
              "w-28 text-right font-mono text-base-content/50 whitespace-nowrap",
            cellClassName: "w-28 max-w-0 align-top text-right",
            renderCell: (item) => (
              <CopyableCellValue
                displayValue={item.score.toLocaleString()}
                copyValue={String(item.score)}
                className="text-right whitespace-nowrap text-primary/85"
                onCopy={onCopy}
              />
            ),
          },
          {
            id: "actions",
            header: null,
            colClassName: TABLE_ACTION_COLUMN_CLASS,
            headerClassName: `${TABLE_ACTION_COLUMN_CLASS} whitespace-nowrap`,
            cellClassName: TABLE_ACTION_CELL_CLASS,
            renderCell: (item) => (
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
                  await handleRefresh();
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
            ),
          },
        ]}
      />
    </TableViewerFrame>
  );
}
