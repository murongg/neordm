import {
  LoaderCircle,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  memo,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { useI18n } from "../i18n";
import { getRedisErrorMessage, getRedisSlowLog } from "../lib/redis";
import { getRedisConnectionEndpointLabel } from "../lib/redisConnection";
import { useRedisWorkspaceStore } from "../store/useRedisWorkspaceState";
import type { RedisSlowLogEntry, RedisSlowLogResponse } from "../types";
import { useToast } from "./ToastProvider";
import {
  DATA_TABLE_CELL_CLASS,
  DATA_TABLE_HEADER_CLASS,
  DATA_TABLE_INDEX_CELL_CLASS,
  DATA_TABLE_INDEX_HEADER_CLASS,
  DATA_TABLE_PANEL_CLASS,
  DATA_TABLE_ROW_CLASS,
  DataTable,
  type DataTableColumn,
} from "./DataTable";

const LIMIT_OPTIONS = [32, 64, 128, 256];
const SLOWLOG_HEADER_CLASS = `${DATA_TABLE_HEADER_CLASS} py-3`;
const SLOWLOG_CELL_CLASS = `${DATA_TABLE_CELL_CLASS} py-3`;
const SLOWLOG_INDEX_HEADER_CLASS = `${DATA_TABLE_INDEX_HEADER_CLASS} py-3`;
const SLOWLOG_INDEX_CELL_CLASS = `${DATA_TABLE_INDEX_CELL_CLASS} py-3`;

function formatDuration(durationUs: number) {
  if (durationUs >= 1_000) {
    const durationMs = durationUs / 1_000;

    return `${durationMs.toLocaleString([], {
      minimumFractionDigits: durationMs < 10 ? 2 : durationMs < 100 ? 1 : 0,
      maximumFractionDigits: durationMs < 10 ? 2 : durationMs < 100 ? 1 : 0,
    })} ms`;
  }

  return `${durationUs.toLocaleString()} us`;
}

function formatStartedAt(timestampSeconds: number) {
  return new Date(timestampSeconds * 1000).toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatStartedAtForCopy(timestampSeconds: number) {
  return new Date(timestampSeconds * 1000).toLocaleString();
}

function formatCommandArgument(value: string) {
  return /[\s"'\\\n\r\t]/.test(value) ? JSON.stringify(value) : value;
}

function formatSlowLogCommand(argumentsList: string[]) {
  return argumentsList.map(formatCommandArgument).join(" ");
}

function createEntrySearchText(entry: RedisSlowLogEntry) {
  return [
    formatSlowLogCommand(entry.arguments),
    entry.clientAddress,
    entry.clientName,
    entry.nodeAddress,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function CopyableSlowLogCell({
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
      className={`block w-full cursor-copy truncate text-left font-mono transition-colors duration-150 motion-reduce:transition-none ${
        copied ? "text-success" : ""
      } ${className ?? ""}`}
    >
      {displayValue}
    </button>
  );
}

export const RedisSlowLogPanel = memo(function RedisSlowLogPanel() {
  const { messages } = useI18n();
  const { showToast } = useToast();
  const workspace = useRedisWorkspaceStore(
    useShallow((state) => ({
      activeConnectionId: state.activeConnectionId,
      connections: state.connections,
    }))
  );
  const activeConnection = useMemo(
    () =>
      workspace.connections.find(
        (connection) => connection.id === workspace.activeConnectionId
      ),
    [workspace.activeConnectionId, workspace.connections]
  );
  const [limit, setLimit] = useState(64);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [response, setResponse] = useState<RedisSlowLogResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);

  const refreshSlowLog = useCallback(async () => {
    if (!activeConnection) {
      requestIdRef.current += 1;
      setResponse(null);
      setErrorMessage(null);
      setIsLoading(false);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const nextResponse = await getRedisSlowLog(
        {
          ...activeConnection,
          db: activeConnection.mode === "cluster" ? 0 : activeConnection.db,
        },
        { limit }
      );

      if (requestIdRef.current !== requestId) {
        return;
      }

      setResponse(nextResponse);
    } catch (error) {
      if (requestIdRef.current !== requestId) {
        return;
      }

      setErrorMessage(getRedisErrorMessage(error));
    } finally {
      if (requestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [activeConnection, limit]);

  useEffect(() => {
    void refreshSlowLog();
  }, [refreshSlowLog]);

  const filteredEntries = useMemo(() => {
    const entries = response?.entries ?? [];
    const normalizedQuery = deferredSearchQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return entries;
    }

    return entries.filter((entry) =>
      createEntrySearchText(entry).includes(normalizedQuery)
    );
  }, [deferredSearchQuery, response?.entries]);

  const hasNodeAddress = useMemo(
    () => (response?.entries ?? []).some((entry) => Boolean(entry.nodeAddress)),
    [response?.entries]
  );
  const connectionLabel = activeConnection
    ? `${activeConnection.name} · ${getRedisConnectionEndpointLabel(activeConnection)}`
    : messages.app.status.notConnected;
  const summaryLabel = response
    ? `${messages.slowlog.loaded} ${filteredEntries.length.toLocaleString()} · ${messages.slowlog.total} ${response.totalCount.toLocaleString()}`
    : `${messages.slowlog.loaded} 0`;
  const copyText = useCallback(
    async (text: string) => {
      await navigator.clipboard.writeText(text);
      showToast({
        message: messages.common.copied,
        tone: "success",
      });
    },
    [messages.common.copied, showToast]
  );

  const columns = useMemo<DataTableColumn<RedisSlowLogEntry>[]>(() => {
    const commandColumn: DataTableColumn<RedisSlowLogEntry> = {
      id: "command",
      header: messages.slowlog.command,
      colClassName: "w-auto",
      headerClassName: SLOWLOG_HEADER_CLASS,
      cellClassName: SLOWLOG_CELL_CLASS,
      renderCell: (entry) => {
        const commandText = formatSlowLogCommand(entry.arguments);

        return (
          <CopyableSlowLogCell
            displayValue={commandText}
            className="text-[11px] text-base-content/84"
            onCopy={copyText}
          />
        );
      },
    };
    const nextColumns: DataTableColumn<RedisSlowLogEntry>[] = [
      {
        id: "id",
        header: messages.valueEditor.headers.index,
        colClassName: "w-20",
        headerClassName: SLOWLOG_INDEX_HEADER_CLASS,
        cellClassName: SLOWLOG_INDEX_CELL_CLASS,
        renderCell: (entry) => (
          <CopyableSlowLogCell
            displayValue={entry.id.toLocaleString()}
            className="text-center text-[10px] text-base-content/30"
            onCopy={copyText}
          />
        ),
      },
      {
        id: "startedAt",
        header: messages.slowlog.startedAt,
        colClassName: "w-40",
        headerClassName: SLOWLOG_HEADER_CLASS,
        cellClassName: SLOWLOG_CELL_CLASS,
        renderCell: (entry) => (
          <CopyableSlowLogCell
            displayValue={formatStartedAt(entry.startedAt)}
            copyValue={formatStartedAtForCopy(entry.startedAt)}
            className="text-[11px] text-base-content/62"
            onCopy={copyText}
          />
        ),
      },
      {
        id: "duration",
        header: messages.slowlog.duration,
        colClassName: "w-28",
        headerClassName: SLOWLOG_HEADER_CLASS,
        cellClassName: SLOWLOG_CELL_CLASS,
        renderCell: (entry) => (
          <CopyableSlowLogCell
            displayValue={formatDuration(entry.durationUs)}
            copyValue={entry.durationUs.toString()}
            className="text-[11px] text-base-content/82"
            onCopy={copyText}
          />
        ),
      },
      commandColumn,
      {
        id: "client",
        header: messages.slowlog.client,
        colClassName: "w-52",
        headerClassName: SLOWLOG_HEADER_CLASS,
        cellClassName: SLOWLOG_CELL_CLASS,
        renderCell: (entry) => {
          const clientText = entry.clientName
            ? `${entry.clientAddress ?? "--"} · ${entry.clientName}`
            : entry.clientAddress ?? "--";

          return (
            <CopyableSlowLogCell
              displayValue={clientText}
              className="text-[11px] text-base-content/52"
              onCopy={copyText}
            />
          );
        },
      },
    ];

    if (hasNodeAddress) {
      nextColumns.push({
        id: "node",
        header: messages.slowlog.node,
        colClassName: "w-52",
        headerClassName: SLOWLOG_HEADER_CLASS,
        cellClassName: SLOWLOG_CELL_CLASS,
        renderCell: (entry) => (
          <CopyableSlowLogCell
            displayValue={entry.nodeAddress ?? "--"}
            className="text-[11px] text-base-content/45"
            onCopy={copyText}
          />
        ),
      });
    }

    return nextColumns;
  }, [
    hasNodeAddress,
    messages.slowlog.client,
    messages.slowlog.command,
    messages.slowlog.duration,
    messages.slowlog.node,
    messages.slowlog.startedAt,
    messages.valueEditor.headers.index,
    copyText,
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-base-300">
      <div className="border-b border-base-100/50 px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-mono uppercase tracking-[0.18em] text-base-content/38">
              {messages.app.tabs.slowlog}
            </div>
            <div className="mt-1 text-sm font-mono text-base-content/72">
              {connectionLabel}
            </div>
            <div className="mt-2 text-[11px] font-mono text-base-content/42">
              {summaryLabel}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-9 min-w-[240px] items-center gap-2 rounded-xl border border-base-content/10 bg-base-200/70 px-3 text-xs text-base-content/55">
              <Search size={14} className="shrink-0" />
              <input
                value={searchQuery}
                onChange={(event) => {
                  const nextValue = event.currentTarget.value;
                  startTransition(() => {
                    setSearchQuery(nextValue);
                  });
                }}
                placeholder={messages.slowlog.searchPlaceholder}
                className="w-full border-0 bg-transparent font-mono text-xs text-base-content outline-none placeholder:text-base-content/35"
              />
            </label>

            <label className="flex h-9 items-center gap-2 rounded-xl border border-base-content/10 bg-base-200/70 px-3 text-[11px] font-mono text-base-content/55">
              <span>{messages.slowlog.limit}</span>
              <select
                value={limit}
                onChange={(event) => {
                  const nextLimit = Number.parseInt(event.currentTarget.value, 10);

                  if (Number.isFinite(nextLimit) && nextLimit > 0) {
                    setLimit(nextLimit);
                  }
                }}
                className="bg-transparent text-base-content outline-none"
              >
                {LIMIT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={() => void refreshSlowLog()}
              disabled={isLoading || !activeConnection}
              className="btn btn-ghost btn-sm h-9 rounded-xl border border-base-content/10 px-3 font-mono text-[11px]"
            >
              {isLoading ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              {messages.common.refresh}
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 p-4">
        {errorMessage ? (
          <div className="rounded-2xl border border-error/25 bg-error/10 px-3 py-3 text-xs font-mono text-error">
            {errorMessage}
          </div>
        ) : !activeConnection ? (
          <div className="flex h-full items-center justify-center rounded-2xl border border-base-content/8 bg-base-200/55 px-6 py-10 text-center">
            <div>
              <div className="text-sm font-mono text-base-content/72">
                {messages.app.status.notConnected}
              </div>
              <div className="mt-2 text-xs font-mono text-base-content/38">
                {messages.slowlog.selectEntryHint}
              </div>
            </div>
          </div>
        ) : filteredEntries.length ? (
          <DataTable
            rows={filteredEntries}
            columns={columns}
            getRowKey={(entry) =>
              `${activeConnection.id}:${entry.id}:${entry.startedAt}`
            }
            size="sm"
            rowClassName={DATA_TABLE_ROW_CLASS}
            containerClassName={`${DATA_TABLE_PANEL_CLASS} flex h-full min-h-0 flex-col`}
            scrollAreaClassName="min-h-0 flex-1 overflow-auto"
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded-2xl border border-base-content/8 bg-base-200/55 px-6 py-10 text-center">
            <div>
              <div className="text-sm font-mono text-base-content/72">
                {response?.entries?.length
                  ? messages.commandPalette.noResults
                  : messages.slowlog.empty}
              </div>
              <div className="mt-2 text-xs font-mono text-base-content/38">
                {response?.entries?.length
                  ? messages.slowlog.noResultsHint
                  : messages.slowlog.emptyHint}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
