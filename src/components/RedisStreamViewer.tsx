import {
  ArrowRightLeft,
  CheckCheck,
  Copy,
  LoaderCircle,
  Plus,
  RotateCw,
  Trash2,
  Users,
} from "lucide-react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import {
  appendRedisStreamEntry,
  ackRedisStreamEntries,
  claimRedisStreamEntries,
  createRedisStreamConsumerGroup,
  deleteRedisStreamConsumer,
  deleteRedisStreamEntries,
  destroyRedisStreamConsumerGroup,
  getRedisErrorMessage,
  getRedisStreamConsumers,
  getRedisStreamEntries,
  getRedisStreamGroups,
  getRedisStreamPendingEntries,
} from "../lib/redis";
import type {
  RedisConnection,
  RedisStreamConsumer,
  RedisStreamConsumerGroup,
  RedisStreamEntry,
  RedisStreamEntryField,
  RedisStreamPendingEntry,
} from "../types";
import { useToast } from "./ToastProvider";

const STREAM_PENDING_LIMIT = 100;

interface StreamEntryDraftField {
  id: number;
  field: string;
  value: string;
}

function createStreamEntryDraftField(id: number): StreamEntryDraftField {
  return {
    id,
    field: "",
    value: "",
  };
}

function formatMetric(value?: number | null) {
  if (value === undefined || value === null) {
    return "—";
  }

  return value.toLocaleString();
}

function formatDuration(value: number) {
  if (value < 1000) {
    return `${value}ms`;
  }

  const seconds = value / 1000;

  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  }

  const minutes = seconds / 60;

  if (minutes < 60) {
    return `${minutes.toFixed(minutes < 10 ? 1 : 0)}m`;
  }

  const hours = minutes / 60;
  return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
}

function replaceTemplate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : `{${key}}`
  );
}

function compactActionClass(disabled: boolean) {
  return `btn btn-ghost btn-xs h-7 min-h-7 gap-1 ${
    disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
  }`;
}

function smallIconButtonClass(disabled: boolean, tone?: "danger") {
  return `btn btn-ghost btn-xs h-6 min-h-6 w-6 p-0 ${
    tone === "danger" ? "text-error " : ""
  }${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`;
}

function filledActionClass(disabled: boolean) {
  return `btn btn-sm h-8 min-h-8 rounded-xl gap-1.5 px-3 shadow-none ${
    disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
  }`;
}

function StreamCopyableCellValue({
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
      title={displayValue}
    >
      {displayValue}
    </button>
  );
}

function StreamEntryFieldTag({
  field,
  value,
  onCopy,
}: {
  field: string;
  value: string;
  onCopy: (text: string) => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const displayField = field || "—";
  const displayValue = value || "—";
  const displayPair = `${displayField}=${displayValue}`;

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
        void onCopy(displayPair).then(() => {
          setCopied(true);
        });
      }}
      className={`inline-flex h-5 max-w-full items-center gap-1 px-0 font-mono text-[11px] leading-5 transition-colors duration-150 motion-reduce:transition-none ${
        copied ? "text-success" : "text-base-content/78 hover:text-base-content/92"
      }`}
      title={displayPair}
    >
      <span className={`max-w-[8rem] truncate ${copied ? "text-success" : "text-primary/85"}`}>
        {displayField}
      </span>
      <span className={copied ? "text-success/65" : "text-base-content/24"}>=</span>
      <span
        className={`max-w-[12rem] truncate ${
          copied ? "text-success" : "text-base-content/70"
        }`}
      >
        {displayValue}
      </span>
    </button>
  );
}

function StreamEntryFieldsCell({
  fields,
  onCopy,
}: {
  fields: RedisStreamEntryField[];
  onCopy: (text: string) => Promise<void>;
}) {
  if (!fields.length) {
    return <span className="block font-mono text-xs text-base-content/35">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5 py-0.5">
      {fields.map((field, index) => (
        <StreamEntryFieldTag
          key={`${field.field}-${index}`}
          field={field.field}
          value={field.value}
          onCopy={onCopy}
        />
      ))}
    </div>
  );
}

interface RedisStreamViewerProps {
  activeConnection?: RedisConnection;
  selectedDb: number;
  keyName: string;
  rawValue: string;
  onCopy: (text: string) => Promise<void>;
  onRefreshStream: () => Promise<void>;
}

export function RedisStreamViewer({
  activeConnection,
  selectedDb,
  keyName,
  rawValue,
  onCopy,
  onRefreshStream,
}: RedisStreamViewerProps) {
  const { messages } = useI18n();
  const { showToast } = useToast();
  const text = messages.streamViewer;
  const panelClass =
    "min-w-0 overflow-hidden rounded-2xl border border-base-content/8 bg-base-200/55 shadow-[0_14px_34px_-28px_rgba(0,0,0,0.55)]";
  const eyebrowClass =
    "text-[10px] font-semibold uppercase tracking-[0.16em] text-base-content/45";
  const emptyClass =
    "flex min-h-[96px] items-center justify-center rounded-xl border border-dashed border-base-content/10 bg-base-100/45 px-3 py-4 text-center text-sm text-base-content/42";
  const inputClass =
    "input input-sm h-8 min-h-8 rounded-xl border-base-content/10 bg-base-100/80 text-xs font-mono";
  const selectClass =
    "select select-sm h-8 min-h-8 rounded-xl border-base-content/10 bg-base-100/80 text-xs font-mono";

  const connection = useMemo(
    () =>
      activeConnection
        ? {
            ...activeConnection,
            db: activeConnection.mode === "cluster" ? 0 : selectedDb,
          }
        : null,
    [activeConnection, selectedDb]
  );

  const [groups, setGroups] = useState<RedisStreamConsumerGroup[]>([]);
  const [streamEntries, setStreamEntries] = useState<RedisStreamEntry[]>([]);
  const [entryDrafts, setEntryDrafts] = useState<StreamEntryDraftField[]>([
    createStreamEntryDraftField(1),
  ]);
  const [nextEntryDraftId, setNextEntryDraftId] = useState(2);
  const [isEntryFormOpen, setIsEntryFormOpen] = useState(false);
  const [consumers, setConsumers] = useState<RedisStreamConsumer[]>([]);
  const [pendingEntries, setPendingEntries] = useState<RedisStreamPendingEntry[]>([]);
  const [activeTab, setActiveTab] = useState<"entries" | "groups">("entries");
  const [selectedGroupName, setSelectedGroupName] = useState("");
  const [selectedPendingIds, setSelectedPendingIds] = useState<string[]>([]);
  const [groupDraft, setGroupDraft] = useState("");
  const [startIdDraft, setStartIdDraft] = useState("$");
  const [claimConsumer, setClaimConsumer] = useState("");
  const [claimMinIdle, setClaimMinIdle] = useState("0");
  const [pendingConsumerFilter, setPendingConsumerFilter] = useState("");
  const [isLoadingEntries, setIsLoadingEntries] = useState(false);
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [isLoadingGroupDetails, setIsLoadingGroupDetails] = useState(false);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [isAddingEntry, setIsAddingEntry] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [isAcking, setIsAcking] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);
  const [busyGroupName, setBusyGroupName] = useState<string | null>(null);
  const [busyConsumerName, setBusyConsumerName] = useState<string | null>(null);

  const activeGroup = useMemo(
    () => groups.find((group) => group.name === selectedGroupName) ?? null,
    [groups, selectedGroupName]
  );

  const refreshEntries = useCallback(async () => {
    if (!connection) {
      return;
    }

    setIsLoadingEntries(true);

    try {
      const nextEntries = await getRedisStreamEntries(connection, keyName);
      setStreamEntries(nextEntries);
    } catch (error) {
      showToast({
        message: getRedisErrorMessage(error),
        tone: "error",
        duration: 2200,
      });
    } finally {
      setIsLoadingEntries(false);
    }
  }, [connection, keyName, showToast]);

  const refreshGroups = useCallback(async () => {
    if (!connection) {
      return;
    }

    setIsLoadingGroups(true);

    try {
      const nextGroups = await getRedisStreamGroups(connection, keyName);
      setGroups(nextGroups);
    } catch (error) {
      showToast({
        message: getRedisErrorMessage(error),
        tone: "error",
        duration: 2200,
      });
    } finally {
      setIsLoadingGroups(false);
    }
  }, [connection, keyName, showToast]);

  const refreshGroupDetails = useCallback(
    async (groupName: string) => {
      if (!connection || !groupName) {
        setConsumers([]);
        setPendingEntries([]);
        return;
      }

      setIsLoadingGroupDetails(true);

      try {
        const [nextConsumers, nextPendingEntries] = await Promise.all([
          getRedisStreamConsumers(connection, keyName, groupName),
          getRedisStreamPendingEntries(connection, keyName, groupName, {
            count: STREAM_PENDING_LIMIT,
            consumer: pendingConsumerFilter || null,
          }),
        ]);

        setConsumers(nextConsumers);
        setPendingEntries(nextPendingEntries);
        setSelectedPendingIds((current) =>
          current.filter((id) => nextPendingEntries.some((entry) => entry.id === id))
        );
      } catch (error) {
        showToast({
          message: getRedisErrorMessage(error),
          tone: "error",
          duration: 2200,
        });
      } finally {
        setIsLoadingGroupDetails(false);
      }
    },
    [connection, keyName, pendingConsumerFilter, showToast]
  );

  useEffect(() => {
    setGroups([]);
    setStreamEntries([]);
    setEntryDrafts([createStreamEntryDraftField(1)]);
    setNextEntryDraftId(2);
    setIsEntryFormOpen(false);
    setConsumers([]);
    setPendingEntries([]);
    setActiveTab("entries");
    setSelectedPendingIds([]);
    setSelectedGroupName("");
    setGroupDraft("");
    setStartIdDraft("$");
    setClaimConsumer("");
    setClaimMinIdle("0");
    setPendingConsumerFilter("");
    setIsAddingEntry(false);
    setBusyEntryId(null);

    if (!connection) {
      return;
    }

    void refreshEntries();
    void refreshGroups();
  }, [connection?.id, connection?.db, keyName, refreshEntries, refreshGroups]);

  useEffect(() => {
    if (!groups.length) {
      setSelectedGroupName("");
      return;
    }

    setSelectedGroupName((current) =>
      groups.some((group) => group.name === current) ? current : groups[0]?.name ?? ""
    );
  }, [groups]);

  useEffect(() => {
    if (!selectedGroupName) {
      setConsumers([]);
      setPendingEntries([]);
      setSelectedPendingIds([]);
      return;
    }

    void refreshGroupDetails(selectedGroupName);
  }, [refreshGroupDetails, selectedGroupName]);

  useEffect(() => {
    if (!consumers.length) {
      return;
    }

    setClaimConsumer((current) => current || consumers[0]?.name || "");
  }, [consumers]);

  const handleRefreshAll = useCallback(async () => {
    if (!connection) {
      return;
    }

    setIsRefreshingAll(true);

    try {
      await onRefreshStream();
      await refreshEntries();
      await refreshGroups();
      if (selectedGroupName) {
        await refreshGroupDetails(selectedGroupName);
      }
    } catch (error) {
      showToast({
        message: getRedisErrorMessage(error),
        tone: "error",
        duration: 2200,
      });
    } finally {
      setIsRefreshingAll(false);
    }
  }, [
    connection,
    onRefreshStream,
    refreshEntries,
    refreshGroupDetails,
    refreshGroups,
    selectedGroupName,
    showToast,
  ]);

  const handleDeleteEntry = useCallback(
    async (entryId: string) => {
      if (!connection || busyEntryId === entryId) {
        return;
      }

      const confirmed = await confirm(
        replaceTemplate(text.confirmDeleteEntry, { id: entryId }),
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

      setBusyEntryId(entryId);

      try {
        await deleteRedisStreamEntries(connection, keyName, [entryId]);
        showToast({
          message: text.deleteEntrySuccess,
          tone: "success",
          duration: 1700,
        });
        await onRefreshStream();
        await refreshEntries();
        await refreshGroups();
        if (selectedGroupName) {
          await refreshGroupDetails(selectedGroupName);
        }
      } catch (error) {
        showToast({
          message: getRedisErrorMessage(error),
          tone: "error",
          duration: 2200,
        });
      } finally {
        setBusyEntryId((current) => (current === entryId ? null : current));
      }
    },
    [
      busyEntryId,
      connection,
      keyName,
      messages.common.cancel,
      messages.common.delete,
      onRefreshStream,
      refreshEntries,
      refreshGroupDetails,
      refreshGroups,
      selectedGroupName,
      showToast,
      text.confirmDeleteEntry,
      text.deleteEntrySuccess,
    ]
  );

  const handleAppendEntry = useCallback(async () => {
    if (!connection || isAddingEntry) {
      return;
    }

    setIsAddingEntry(true);

    try {
      await appendRedisStreamEntry(
        connection,
        keyName,
        entryDrafts.map((entry) => ({
          field: entry.field,
          value: entry.value,
        }))
      );
      showToast({
        message: text.addEntrySuccess,
        tone: "success",
        duration: 1700,
      });
      setEntryDrafts([createStreamEntryDraftField(1)]);
      setNextEntryDraftId(2);
      setIsEntryFormOpen(false);
      await onRefreshStream();
      await refreshEntries();
      await refreshGroups();
      if (selectedGroupName) {
        await refreshGroupDetails(selectedGroupName);
      }
    } catch (error) {
      showToast({
        message: getRedisErrorMessage(error),
        tone: "error",
        duration: 2200,
      });
    } finally {
      setIsAddingEntry(false);
    }
  }, [
    connection,
    entryDrafts,
    isAddingEntry,
    keyName,
    onRefreshStream,
    refreshEntries,
    refreshGroupDetails,
    refreshGroups,
    selectedGroupName,
    showToast,
    text.addEntrySuccess,
  ]);

  const handleCreateGroup = useCallback(async () => {
    if (!connection) {
      showToast({
        message: messages.app.status.notConnected,
        tone: "error",
        duration: 1800,
      });
      return;
    }

    const nextGroup = groupDraft.trim();
    const nextStartId = startIdDraft.trim();

    if (!nextGroup) {
      showToast({ message: text.groupRequired, tone: "error", duration: 1800 });
      return;
    }

    if (!nextStartId) {
      showToast({ message: text.startIdRequired, tone: "error", duration: 1800 });
      return;
    }

    setIsCreatingGroup(true);

    try {
      await createRedisStreamConsumerGroup(connection, {
        key: keyName,
        group: nextGroup,
        startId: nextStartId,
      });
      showToast({ message: text.createGroupSuccess, tone: "success", duration: 1600 });
      setGroupDraft("");
      await refreshGroups();
      setSelectedGroupName(nextGroup);
    } catch (error) {
      showToast({
        message: getRedisErrorMessage(error),
        tone: "error",
        duration: 2200,
      });
    } finally {
      setIsCreatingGroup(false);
    }
  }, [
    connection,
    groupDraft,
    keyName,
    messages.app.status.notConnected,
    refreshGroups,
    showToast,
    startIdDraft,
    text.createGroupSuccess,
    text.groupRequired,
    text.startIdRequired,
  ]);

  const handleDestroyGroup = useCallback(
    async (groupName: string) => {
      if (!connection) {
        return;
      }

      const confirmed = await confirm(
        replaceTemplate(text.confirmDestroyGroup, { group: groupName }),
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

      setBusyGroupName(groupName);

      try {
        await destroyRedisStreamConsumerGroup(connection, keyName, groupName);
        showToast({ message: text.destroyGroupSuccess, tone: "success", duration: 1600 });
        await refreshGroups();
      } catch (error) {
        showToast({
          message: getRedisErrorMessage(error),
          tone: "error",
          duration: 2200,
        });
      } finally {
        setBusyGroupName(null);
      }
    },
    [
      connection,
      keyName,
      messages.common.cancel,
      messages.common.delete,
      refreshGroups,
      showToast,
      text.confirmDestroyGroup,
      text.destroyGroupSuccess,
    ]
  );

  const handleDeleteConsumer = useCallback(
    async (consumerName: string) => {
      if (!connection || !selectedGroupName) {
        return;
      }

      const confirmed = await confirm(
        replaceTemplate(text.confirmDeleteConsumer, {
          consumer: consumerName,
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

      setBusyConsumerName(consumerName);

      try {
        await deleteRedisStreamConsumer(connection, keyName, selectedGroupName, consumerName);
        showToast({ message: text.deleteConsumerSuccess, tone: "success", duration: 1600 });
        await refreshGroupDetails(selectedGroupName);
        await refreshGroups();
      } catch (error) {
        showToast({
          message: getRedisErrorMessage(error),
          tone: "error",
          duration: 2200,
        });
      } finally {
        setBusyConsumerName(null);
      }
    },
    [
      connection,
      keyName,
      messages.common.cancel,
      messages.common.delete,
      refreshGroupDetails,
      refreshGroups,
      selectedGroupName,
      showToast,
      text.confirmDeleteConsumer,
      text.deleteConsumerSuccess,
    ]
  );

  const handleAck = useCallback(
    async (ids: string[]) => {
      if (!connection || !selectedGroupName || !ids.length || isAcking) {
        return;
      }

      setIsAcking(true);

      try {
        const acked = await ackRedisStreamEntries(connection, keyName, selectedGroupName, ids);
        showToast({
          message: replaceTemplate(text.ackSuccess, { count: acked }),
          tone: "success",
          duration: 1700,
        });
        await refreshGroupDetails(selectedGroupName);
        await refreshGroups();
      } catch (error) {
        showToast({
          message: getRedisErrorMessage(error),
          tone: "error",
          duration: 2200,
        });
      } finally {
        setIsAcking(false);
      }
    },
    [
      connection,
      isAcking,
      keyName,
      refreshGroupDetails,
      refreshGroups,
      selectedGroupName,
      showToast,
      text.ackSuccess,
    ]
  );

  const handleClaim = useCallback(
    async (ids: string[]) => {
      if (!connection || !selectedGroupName || !ids.length || isClaiming) {
        return;
      }

      const nextConsumer = claimConsumer.trim();
      const nextMinIdle = Number.parseInt(claimMinIdle.trim() || "0", 10);

      if (!nextConsumer) {
        showToast({ message: text.consumerRequired, tone: "error", duration: 1800 });
        return;
      }

      if (!Number.isInteger(nextMinIdle) || nextMinIdle < 0) {
        showToast({ message: text.invalidMinIdle, tone: "error", duration: 1800 });
        return;
      }

      setIsClaiming(true);

      try {
        const claimed = await claimRedisStreamEntries(connection, {
          key: keyName,
          group: selectedGroupName,
          consumer: nextConsumer,
          minIdleTime: nextMinIdle,
          ids,
        });
        showToast({
          message: replaceTemplate(text.claimSuccess, { count: claimed.length }),
          tone: "success",
          duration: 1700,
        });
        await refreshGroupDetails(selectedGroupName);
        await refreshGroups();
      } catch (error) {
        showToast({
          message: getRedisErrorMessage(error),
          tone: "error",
          duration: 2200,
        });
      } finally {
        setIsClaiming(false);
      }
    },
    [
      claimConsumer,
      claimMinIdle,
      connection,
      isClaiming,
      keyName,
      refreshGroupDetails,
      refreshGroups,
      selectedGroupName,
      showToast,
      text.claimSuccess,
      text.consumerRequired,
      text.invalidMinIdle,
    ]
  );

  const allPendingSelected =
    pendingEntries.length > 0 && selectedPendingIds.length === pendingEntries.length;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-y-auto overflow-x-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="tabs tabs-box tabs-xs rounded-lg bg-base-200 p-0.5">
          <button
            type="button"
            onClick={() => setActiveTab("entries")}
            className={`tab cursor-pointer rounded-md font-mono text-[11px] transition-colors duration-150 ${
              activeTab === "entries" ? "tab-active" : ""
            }`}
          >
            {text.messagesTab}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("groups")}
            className={`tab cursor-pointer rounded-md font-mono text-[11px] transition-colors duration-150 ${
              activeTab === "groups" ? "tab-active" : ""
            }`}
          >
            {text.groupsTab}
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {activeTab === "entries" ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setIsEntryFormOpen((current) => !current);
                }}
                className="btn btn-ghost btn-xs h-7 min-h-7 gap-1 cursor-pointer"
              >
                <Plus size={11} />
                {text.addEntry}
              </button>
              <button
                type="button"
                onClick={() => {
                  void onCopy(rawValue);
                }}
                className="btn btn-ghost btn-xs h-7 min-h-7 gap-1 cursor-pointer"
              >
                <Copy size={11} />
                {messages.common.copy}
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => {
              void handleRefreshAll();
            }}
            disabled={isRefreshingAll}
            className={compactActionClass(isRefreshingAll)}
          >
            {isRefreshingAll ? (
              <LoaderCircle size={11} className="animate-spin" />
            ) : (
              <RotateCw size={11} />
            )}
            {text.refreshAll}
          </button>
        </div>
      </div>

      {activeTab === "entries" ? (
        <section className={`${panelClass} min-h-0 flex-1 overflow-hidden`}>
          {isEntryFormOpen ? (
            <div className="border-b border-base-content/8 bg-base-100/35 px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-base-content/45">
                  {text.addEntry}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEntryDrafts((current) => [
                      ...current,
                      createStreamEntryDraftField(nextEntryDraftId),
                    ]);
                    setNextEntryDraftId((current) => current + 1);
                  }}
                  className="btn btn-ghost btn-xs h-7 min-h-7 gap-1 px-2"
                >
                  <Plus size={11} />
                  {text.addField}
                </button>
              </div>

              <div className="mt-2 grid gap-1.5">
                {entryDrafts.map((entry, index) => (
                  <div
                    key={entry.id}
                    className="grid grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)_30px] items-center gap-1.5"
                  >
                    <span className="text-center text-[11px] font-mono text-base-content/40">
                      {index + 1}
                    </span>
                    <input
                      type="text"
                      value={entry.field}
                      onChange={(event) =>
                        setEntryDrafts((current) =>
                          current.map((item) =>
                            item.id === entry.id
                              ? { ...item, field: event.target.value }
                              : item
                          )
                        )
                      }
                      placeholder={text.entryFieldPlaceholder}
                      className={`${inputClass} w-full`}
                      spellCheck={false}
                    />
                    <input
                      type="text"
                      value={entry.value}
                      onChange={(event) =>
                        setEntryDrafts((current) =>
                          current.map((item) =>
                            item.id === entry.id
                              ? { ...item, value: event.target.value }
                              : item
                          )
                        )
                      }
                      placeholder={text.entryValuePlaceholder}
                      className={`${inputClass} w-full`}
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setEntryDrafts((current) =>
                          current.length > 1
                            ? current.filter((item) => item.id !== entry.id)
                            : [createStreamEntryDraftField(entry.id)]
                        )
                      }
                      className="btn btn-ghost btn-sm btn-square h-8 min-h-8 text-base-content/45"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsEntryFormOpen(false);
                  }}
                  className="btn btn-ghost btn-xs h-7 min-h-7 px-2 cursor-pointer"
                >
                  {messages.common.cancel}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleAppendEntry();
                  }}
                  disabled={isAddingEntry}
                  className={`btn btn-xs h-7 min-h-7 gap-1 px-2 ${
                    isAddingEntry ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                  }`}
                >
                  {isAddingEntry ? (
                    <LoaderCircle size={11} className="animate-spin" />
                  ) : (
                    <Plus size={11} />
                  )}
                  {text.saveEntry}
                </button>
              </div>
            </div>
          ) : null}
          <div className="min-h-[240px] h-full overflow-auto">
            {isLoadingEntries ? (
              <div className={`${emptyClass} m-3 gap-2`}>
                <LoaderCircle size={16} className="animate-spin" />
                <span>{text.loading}</span>
              </div>
            ) : streamEntries.length ? (
              <div className="min-h-0 h-full overflow-y-auto overflow-x-hidden rounded-xl border border-base-200/50">
                <table
                  className="table table-xs table-pin-rows table-fixed w-full"
                  style={{ tableLayout: "fixed" }}
                >
                  <colgroup>
                    <col className="w-12" />
                    <col className="w-[26%]" />
                    <col />
                    <col className="w-16" />
                  </colgroup>
                  <thead>
                    <tr className="bg-base-200/80">
                      <th className="w-12 text-center font-mono text-base-content/50 whitespace-nowrap">
                        #
                      </th>
                      <th className="font-mono text-base-content/50 whitespace-nowrap">
                        {text.entryId}
                      </th>
                      <th className="font-mono text-base-content/50 whitespace-nowrap">
                        {text.entryContent}
                      </th>
                      <th className="w-16" />
                    </tr>
                  </thead>
                  <tbody>
                    {streamEntries.map((entry, index) => (
                      <tr key={entry.id} className="group hover:bg-base-200/30">
                        <td className="text-center font-mono text-[10px] text-base-content/30 whitespace-nowrap align-top">
                          {index + 1}
                        </td>
                        <td className="max-w-0 align-top">
                          <StreamCopyableCellValue
                            displayValue={entry.id}
                            className="text-primary"
                            onCopy={onCopy}
                          />
                        </td>
                        <td className="max-w-0 align-top">
                          <div className="py-0.5">
                            <StreamEntryFieldsCell fields={entry.fields} onCopy={onCopy} />
                          </div>
                        </td>
                        <td className="w-16 whitespace-nowrap align-top">
                          <div
                            className={`flex justify-end transition-opacity duration-150 motion-reduce:transition-none ${
                              busyEntryId === entry.id
                                ? "opacity-100"
                                : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                void handleDeleteEntry(entry.id);
                              }}
                              disabled={busyEntryId === entry.id}
                              aria-label={text.deleteEntry}
                              title={text.deleteEntry}
                              className={`btn btn-ghost btn-xs h-6 min-h-6 w-6 rounded-md border-0 p-0 transition-colors duration-150 motion-reduce:transition-none ${
                                "text-base-content/50 hover:bg-error/10 hover:text-error"
                              } disabled:cursor-not-allowed disabled:opacity-50`}
                            >
                              {busyEntryId === entry.id ? (
                                <LoaderCircle size={11} className="animate-spin" />
                              ) : (
                                <Trash2 size={11} />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={`${emptyClass} m-3`}>{text.rawPreviewEmpty}</div>
            )}
          </div>
        </section>
      ) : (
        <div className="grid min-h-0 min-w-0 flex-1 gap-3 sm:grid-cols-[260px_minmax(0,1fr)]">
          <section className={`${panelClass} min-h-0 self-start`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-base-content/8 px-3 py-2.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-base-content">
                <Users size={14} className="text-primary" />
                {text.groups}
              </div>
              <button
                type="button"
                onClick={() => {
                  void refreshGroups();
                }}
                disabled={isLoadingGroups}
                className={compactActionClass(isLoadingGroups)}
              >
                {isLoadingGroups ? (
                  <LoaderCircle size={11} className="animate-spin" />
                ) : (
                  <RotateCw size={11} />
                )}
                {text.refreshGroups}
              </button>
            </div>

            <div className="grid gap-2 border-b border-base-content/8 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_88px]">
              <label className="flex flex-col gap-1.5">
                <span className={eyebrowClass}>{text.groupName}</span>
                <input
                  type="text"
                  value={groupDraft}
                  onChange={(event) => setGroupDraft(event.target.value)}
                  placeholder={text.groupNamePlaceholder}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={eyebrowClass}>{text.startId}</span>
                <input
                  type="text"
                  value={startIdDraft}
                  onChange={(event) => setStartIdDraft(event.target.value)}
                  placeholder={text.startIdPlaceholder}
                  className={inputClass}
                />
              </label>
              <div className="flex items-end sm:col-span-2">
                <button
                  type="button"
                  onClick={() => {
                    void handleCreateGroup();
                  }}
                  disabled={isCreatingGroup}
                  className={`${filledActionClass(isCreatingGroup)} w-full justify-center`}
                >
                  {isCreatingGroup ? (
                    <LoaderCircle size={12} className="animate-spin" />
                  ) : (
                    <Plus size={12} />
                  )}
                  {text.createGroup}
                </button>
              </div>
            </div>

            <div className="max-h-[620px] overflow-auto p-3">
              {groups.length ? (
                <div className="flex flex-col gap-2">
                  {groups.map((group) => {
                    const isActive = group.name === selectedGroupName;
                    const isBusy = busyGroupName === group.name;

                    return (
                      <button
                        key={group.name}
                        type="button"
                        onClick={() => setSelectedGroupName(group.name)}
                        className={`w-full rounded-xl border p-2.5 text-left transition-colors duration-150 ${
                          isActive
                            ? "border-primary/35 bg-primary/7"
                            : "border-base-content/8 bg-base-200/28 hover:border-primary/18 hover:bg-base-200/48"
                        } cursor-pointer`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-semibold text-base-content">
                              {group.name}
                            </div>
                            <div className="mt-1 truncate text-[10px] font-mono text-base-content/42">
                              {group.lastDeliveredId}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleDestroyGroup(group.name);
                            }}
                            disabled={isBusy}
                            title={text.destroyGroup}
                            className={smallIconButtonClass(isBusy, "danger")}
                          >
                            {isBusy ? (
                              <LoaderCircle size={10} className="animate-spin" />
                            ) : (
                              <Trash2 size={10} />
                            )}
                          </button>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10px] font-mono text-base-content/62">
                          <span className="rounded-md bg-base-100/70 px-2 py-1">
                            c {formatMetric(group.consumers)}
                          </span>
                          <span className="rounded-md bg-base-100/70 px-2 py-1">
                            p {formatMetric(group.pending)}
                          </span>
                          <span className="rounded-md bg-base-100/70 px-2 py-1">
                            r {formatMetric(group.entriesRead)}
                          </span>
                          <span className="rounded-md bg-base-100/70 px-2 py-1">
                            lag {formatMetric(group.lag)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className={emptyClass}>{text.noGroups}</div>
              )}
            </div>
          </section>

          <div className="grid min-h-0 min-w-0 gap-3 xl:grid-cols-[220px_minmax(0,1fr)]">
            <section className={`${panelClass} min-h-0`}>
              <div className="flex items-center justify-between gap-3 border-b border-base-content/8 px-3 py-2.5">
                <div className="text-sm font-semibold text-base-content">{text.consumers}</div>
                {activeGroup ? (
                  <span className="badge badge-ghost badge-xs font-mono">
                    {activeGroup.name}
                  </span>
                ) : null}
              </div>
              <div className="max-h-[620px] overflow-auto p-3">
                {!activeGroup ? (
                  <div className={emptyClass}>{text.selectGroup}</div>
                ) : consumers.length ? (
                  <div className="flex flex-col gap-2">
                    {consumers.map((consumer) => {
                      const isBusy = busyConsumerName === consumer.name;

                      return (
                        <div
                          key={consumer.name}
                          className="rounded-xl border border-base-content/8 bg-base-200/28 p-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-[13px] font-semibold text-base-content">
                                {consumer.name}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-mono text-base-content/62">
                                <span className="rounded-md bg-base-100/70 px-2 py-1">
                                  p {formatMetric(consumer.pending)}
                                </span>
                                <span className="rounded-md bg-base-100/70 px-2 py-1">
                                  idle {formatDuration(consumer.idle)}
                                </span>
                                {consumer.inactive !== undefined &&
                                consumer.inactive !== null ? (
                                  <span className="rounded-md bg-base-100/70 px-2 py-1">
                                    inact {formatDuration(consumer.inactive)}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                void handleDeleteConsumer(consumer.name);
                              }}
                              disabled={isBusy}
                              title={text.deleteConsumer}
                              className={smallIconButtonClass(isBusy, "danger")}
                            >
                              {isBusy ? (
                                <LoaderCircle size={10} className="animate-spin" />
                              ) : (
                                <Trash2 size={10} />
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className={emptyClass}>{text.noConsumers}</div>
                )}
              </div>
            </section>

            <section className={`${panelClass} min-h-0`}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-base-content/8 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-base-content">{text.pending}</div>
                  <div className="mt-0.5 text-[10px] font-mono text-base-content/38">
                    {activeGroup
                      ? replaceTemplate(text.pendingCount, {
                          count: activeGroup.pending.toLocaleString(),
                        })
                      : text.pendingHint}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (selectedGroupName) {
                      void refreshGroupDetails(selectedGroupName);
                    }
                  }}
                  disabled={!selectedGroupName || isLoadingGroupDetails}
                  className={compactActionClass(
                    !selectedGroupName || isLoadingGroupDetails
                  )}
                >
                  {isLoadingGroupDetails ? (
                    <LoaderCircle size={11} className="animate-spin" />
                  ) : (
                    <RotateCw size={11} />
                  )}
                  {text.refreshPending}
                </button>
              </div>

              <div className="flex flex-wrap items-end gap-2 border-b border-base-content/8 px-3 py-3">
                <label className="flex min-w-[150px] flex-[1_1_150px] flex-col gap-1.5">
                  <span className={eyebrowClass}>{text.consumerFilter}</span>
                  <select
                    value={pendingConsumerFilter}
                    onChange={(event) => setPendingConsumerFilter(event.target.value)}
                    className={selectClass}
                    disabled={!selectedGroupName}
                  >
                    <option value="">{text.allConsumers}</option>
                    {consumers.map((consumer) => (
                      <option key={consumer.name} value={consumer.name}>
                        {consumer.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-[170px] flex-[1.2_1_180px] flex-col gap-1.5">
                  <span className={eyebrowClass}>{text.targetConsumer}</span>
                  <input
                    type="text"
                    value={claimConsumer}
                    onChange={(event) => setClaimConsumer(event.target.value)}
                    placeholder={text.targetConsumerPlaceholder}
                    className={inputClass}
                    disabled={!selectedGroupName}
                  />
                </label>
                <label className="flex w-[112px] flex-none flex-col gap-1.5">
                  <span className={eyebrowClass}>{text.minIdle}</span>
                  <input
                    type="number"
                    min={0}
                    value={claimMinIdle}
                    onChange={(event) => setClaimMinIdle(event.target.value)}
                    className={inputClass}
                    disabled={!selectedGroupName}
                  />
                </label>
                <div className="flex items-end gap-2 sm:ml-auto">
                  <button
                    type="button"
                    onClick={() => {
                      void handleAck(selectedPendingIds);
                    }}
                    disabled={!selectedGroupName || !selectedPendingIds.length || isAcking}
                    className={filledActionClass(
                      !selectedGroupName || !selectedPendingIds.length || isAcking
                    )}
                  >
                    {isAcking ? (
                      <LoaderCircle size={12} className="animate-spin" />
                    ) : (
                      <CheckCheck size={12} />
                    )}
                    {text.ackSelected}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleClaim(selectedPendingIds);
                    }}
                    disabled={!selectedGroupName || !selectedPendingIds.length || isClaiming}
                    className={filledActionClass(
                      !selectedGroupName || !selectedPendingIds.length || isClaiming
                    )}
                  >
                    {isClaiming ? (
                      <LoaderCircle size={12} className="animate-spin" />
                    ) : (
                      <ArrowRightLeft size={12} />
                    )}
                    {text.claimSelected}
                  </button>
                </div>
              </div>

              <div className="max-h-[620px] overflow-auto p-3">
                {!selectedGroupName ? (
                  <div className={emptyClass}>{text.selectGroup}</div>
                ) : pendingEntries.length ? (
                  <div className="overflow-x-auto">
                    <table className="table table-sm table-fixed w-full">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-[0.16em] text-base-content/45">
                          <th className="w-8">
                            <input
                              type="checkbox"
                              checked={allPendingSelected}
                              onChange={(event) =>
                                setSelectedPendingIds(
                                  event.target.checked
                                    ? pendingEntries.map((entry) => entry.id)
                                    : []
                                )
                              }
                              className="checkbox checkbox-xs"
                            />
                          </th>
                          <th className="w-[45%]">ID</th>
                          <th className="w-[24%]">{text.consumers}</th>
                          <th className="w-[14%]">{text.idle}</th>
                          <th className="w-[9%]">{text.deliveries}</th>
                          <th className="w-20 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pendingEntries.map((entry) => {
                          const checked = selectedPendingIds.includes(entry.id);

                          return (
                            <tr key={entry.id} className="hover">
                              <td>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(event) =>
                                    setSelectedPendingIds((current) =>
                                      event.target.checked
                                        ? [...current, entry.id]
                                        : current.filter((id) => id !== entry.id)
                                    )
                                  }
                                  className="checkbox checkbox-xs"
                                />
                              </td>
                              <td className="font-mono text-[11px] text-base-content/78">
                                <div className="truncate" title={entry.id}>
                                  {entry.id}
                                </div>
                              </td>
                              <td className="font-mono text-[11px] text-base-content/62">
                                <div className="truncate" title={entry.consumer}>
                                  {entry.consumer}
                                </div>
                              </td>
                              <td className="font-mono text-[11px] text-base-content/62">
                                {formatDuration(entry.idle)}
                              </td>
                              <td className="font-mono text-[11px] text-base-content/62">
                                {entry.deliveries}
                              </td>
                              <td>
                                <div className="flex justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void handleAck([entry.id]);
                                    }}
                                    title="Ack"
                                    className="btn btn-ghost btn-xs h-6 min-h-6 w-6 p-0 cursor-pointer"
                                  >
                                    <CheckCheck size={11} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void handleClaim([entry.id]);
                                    }}
                                    title="Claim"
                                    className="btn btn-ghost btn-xs h-6 min-h-6 w-6 p-0 cursor-pointer"
                                  >
                                    <ArrowRightLeft size={11} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className={emptyClass}>{text.noPending}</div>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
