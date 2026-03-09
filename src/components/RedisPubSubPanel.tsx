import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  Copy,
  LoaderCircle,
  Radio,
  SendHorizontal,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useI18n } from "../i18n";
import {
  getRedisErrorMessage,
  publishRedisPubSubMessage,
  REDIS_PUBSUB_EVENT,
  startRedisPubSubSession,
  stopRedisPubSubSession,
  subscribeRedisPubSubChannels,
  subscribeRedisPubSubPatterns,
  unsubscribeRedisPubSubChannels,
  unsubscribeRedisPubSubPatterns,
  type RedisPubSubEvent,
} from "../lib/redis";
import { getRedisConnectionEndpointLabel } from "../lib/redisConnection";
import { useRedisWorkspaceStore } from "../store/useRedisWorkspaceState";
import type { RedisPubSubMessage } from "../types";
import { useToast } from "./ToastProvider";

const MAX_PUBSUB_MESSAGES = 400;
const LOCAL_ECHO_TTL_MS = 4000;
const DEFAULT_SUBSCRIBE_CHANNEL = "*";

interface ConnectionPubSubSession {
  sessionId: string | null;
  subscribedChannels: string[];
  messagesStream: RedisPubSubMessage[];
  lastError: string | null;
}

const EMPTY_SESSION: ConnectionPubSubSession = {
  sessionId: null,
  subscribedChannels: [],
  messagesStream: [],
  lastError: null,
};

function createPubSubMessageId(prefix: string, timestamp: number) {
  return `${prefix}-${timestamp}-${Math.random().toString(16).slice(2)}`;
}

function sortChannels(channels: string[]) {
  return [...channels].sort((left, right) => left.localeCompare(right));
}

function isPatternSubscription(value: string) {
  return /[*?\[\]]/.test(value);
}

function getDefaultPublishChannel(channels: string[]) {
  return channels.find((channel) => !isPatternSubscription(channel)) ?? "";
}

function escapeRegExp(value: string) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function matchesSubscription(subscription: string, channel: string) {
  if (!isPatternSubscription(subscription)) {
    return subscription === channel;
  }

  const pattern = `^${escapeRegExp(subscription).replace(/\*/g, ".*").replace(/\?/g, ".")}$`;
  return new RegExp(pattern).test(channel);
}

function formatPubSubTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function createLocalEchoKey(
  connectionId: string,
  channel: string,
  payload: string
) {
  return `${connectionId}::${channel}::${payload}`;
}

function isLocalEchoFresh(timestamp: number) {
  return Date.now() - timestamp <= LOCAL_ECHO_TTL_MS;
}

function resolveRedisPubSubSessionId(
  payload: RedisPubSubEvent | (RedisPubSubEvent & { session_id?: string })
) {
  if ("sessionId" in payload && typeof payload.sessionId === "string") {
    return payload.sessionId;
  }

  if ("session_id" in payload && typeof payload.session_id === "string") {
    return payload.session_id;
  }

  return null;
}

export const RedisPubSubPanel = memo(function RedisPubSubPanel() {
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

  const [connectionSessions, setConnectionSessions] = useState<
    Record<string, ConnectionPubSubSession>
  >({});
  const [subscribeChannel, setSubscribeChannel] = useState(
    DEFAULT_SUBSCRIBE_CHANNEL
  );
  const [publishChannel, setPublishChannel] = useState("");
  const [publishPayload, setPublishPayload] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [pendingChannel, setPendingChannel] = useState<string | null>(null);
  const [isStopping, setIsStopping] = useState(false);

  const connectionSessionsRef = useRef<Record<string, ConnectionPubSubSession>>(
    {}
  );
  const publishChannelDraftsRef = useRef<Record<string, string>>({});
  const sessionIdToConnectionIdRef = useRef<Record<string, string>>({});
  const localEchoRef = useRef<Map<string, number>>(new Map());
  const streamContainerRef = useRef<HTMLDivElement | null>(null);
  const stopSessionForConnectionRef = useRef<
    ((connectionId: string, options?: { silent?: boolean }) => Promise<void>) | null
  >(null);

  const activeConnectionId = activeConnection?.id ?? null;
  const activeSession =
    (activeConnectionId && connectionSessions[activeConnectionId]) || EMPTY_SESSION;
  const isSessionActive = Boolean(activeSession.sessionId);

  const setPublishChannelForConnection = useCallback(
    (
      connectionId: string | null,
      nextValue: string | ((current: string) => string)
    ) => {
      setPublishChannel((current) => {
        const currentValue =
          (connectionId && publishChannelDraftsRef.current[connectionId]) ?? current;
        const resolvedValue =
          typeof nextValue === "function"
            ? nextValue(currentValue)
            : nextValue;

        if (connectionId) {
          publishChannelDraftsRef.current[connectionId] = resolvedValue;
        }

        return resolvedValue;
      });
    },
    []
  );

  const updateConnectionSession = useCallback(
    (
      connectionId: string,
      updater: (current: ConnectionPubSubSession) => ConnectionPubSubSession
    ) => {
      setConnectionSessions((current) => {
        const previousSession = current[connectionId] ?? EMPTY_SESSION;
        const nextSession = updater(previousSession);
        const nextState = {
          ...current,
          [connectionId]: nextSession,
        };

        connectionSessionsRef.current = nextState;
        return nextState;
      });
    },
    []
  );

  const appendMessageToConnection = useCallback(
    (connectionId: string, message: RedisPubSubMessage) => {
      updateConnectionSession(connectionId, (current) => ({
        ...current,
        messagesStream: [...current.messagesStream, message].slice(
          -MAX_PUBSUB_MESSAGES
        ),
        lastError: null,
      }));
    },
    [updateConnectionSession]
  );

  const resetSessionForConnection = useCallback(
    (connectionId: string, options?: { reason?: string | null }) => {
      updateConnectionSession(connectionId, (current) => ({
        ...current,
        sessionId: null,
        subscribedChannels: [],
        lastError: options?.reason ?? null,
      }));
    },
    [updateConnectionSession]
  );

  const stopSessionForConnection = useCallback(
    async (connectionId: string, options?: { silent?: boolean }) => {
      const sessionId = connectionSessionsRef.current[connectionId]?.sessionId;

      if (!sessionId) {
        resetSessionForConnection(connectionId);
        return;
      }

      setIsStopping(true);

      try {
        await stopRedisPubSubSession(sessionId);
      } catch (error) {
        if (!options?.silent) {
          showToast({
            message: getRedisErrorMessage(error),
            tone: "error",
            duration: 1800,
          });
        }
      } finally {
        delete sessionIdToConnectionIdRef.current[sessionId];
        resetSessionForConnection(connectionId);
        setIsStopping(false);
      }
    },
    [resetSessionForConnection, showToast]
  );

  useEffect(() => {
    stopSessionForConnectionRef.current = stopSessionForConnection;
  }, [stopSessionForConnection]);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    void listen<RedisPubSubEvent>(REDIS_PUBSUB_EVENT, (event) => {
      if (disposed) {
        return;
      }

      const payload = event.payload;
      const sessionId = resolveRedisPubSubSessionId(
        payload as RedisPubSubEvent & { session_id?: string }
      );

      if (!sessionId) {
        return;
      }

      const sessionScopeKey = sessionIdToConnectionIdRef.current[sessionId];

      if (!sessionScopeKey) {
        return;
      }

      if (payload.kind === "message") {
        const echoKey = createLocalEchoKey(
          sessionScopeKey,
          payload.channel,
          payload.payload
        );
        const localEchoTimestamp = localEchoRef.current.get(echoKey);

        if (localEchoTimestamp && isLocalEchoFresh(localEchoTimestamp)) {
          localEchoRef.current.delete(echoKey);
          return;
        }

        appendMessageToConnection(sessionScopeKey, {
          id: createPubSubMessageId(sessionId, payload.timestamp),
          channel: payload.channel,
          payload: payload.payload,
          pattern: payload.pattern ?? undefined,
          timestamp: payload.timestamp,
        });
        return;
      }

      resetSessionForConnection(sessionScopeKey, {
        reason: payload.reason ?? null,
      });

      delete sessionIdToConnectionIdRef.current[sessionId];
    }).then((cleanup) => {
      unlisten = cleanup;
    });

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [appendMessageToConnection, resetSessionForConnection]);

  useEffect(() => {
    const container = streamContainerRef.current;

    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [activeConnectionId, activeSession.messagesStream]);

  useEffect(() => {
    if (!activeConnectionId) {
      setSubscribeChannel(DEFAULT_SUBSCRIBE_CHANNEL);
      setPublishChannel("");
      setPublishPayload("");
      return;
    }

    const nextSession =
      connectionSessionsRef.current[activeConnectionId] ?? EMPTY_SESSION;
    setSubscribeChannel(DEFAULT_SUBSCRIBE_CHANNEL);
    setPublishChannel(
      publishChannelDraftsRef.current[activeConnectionId] ??
        getDefaultPublishChannel(nextSession.subscribedChannels)
    );
    setPublishPayload("");
  }, [activeConnectionId]);

  useEffect(() => {
    return () => {
      const connectionIds = Array.from(
        new Set(Object.values(sessionIdToConnectionIdRef.current))
      );

      for (const connectionId of connectionIds) {
        void stopSessionForConnectionRef.current?.(connectionId, { silent: true });
      }
    };
  }, []);

  const ensureSession = useCallback(async () => {
    if (!activeConnection || !activeConnectionId) {
      throw new Error(messages.app.status.notConnected);
    }

    const existingSessionId =
      connectionSessionsRef.current[activeConnectionId]?.sessionId;

    if (existingSessionId) {
      return existingSessionId;
    }

    setIsConnecting(true);

    try {
      const nextSessionId = await startRedisPubSubSession({
        ...activeConnection,
        db: activeConnection.mode === "cluster" ? 0 : activeConnection.db,
      });

      sessionIdToConnectionIdRef.current[nextSessionId] = activeConnectionId;
      updateConnectionSession(activeConnectionId, (current) => ({
        ...current,
        sessionId: nextSessionId,
        lastError: null,
      }));

      return nextSessionId;
    } finally {
      setIsConnecting(false);
    }
  }, [
    activeConnection,
    activeConnectionId,
    messages.app.status.notConnected,
    updateConnectionSession,
  ]);

  const handleSubscribe = useCallback(async () => {
    const nextChannel = subscribeChannel.trim();
    const shouldUsePatternSubscription = isPatternSubscription(nextChannel);

    if (!nextChannel.length) {
      showToast({
        message: messages.pubsub.channelRequired,
        tone: "error",
        duration: 1600,
      });
      return;
    }

    if (!activeConnectionId) {
      showToast({
        message: messages.app.status.notConnected,
        tone: "error",
        duration: 1600,
      });
      return;
    }

    setPendingChannel(nextChannel);

    try {
      const currentSessionId = await ensureSession();
      const appliedChannels = shouldUsePatternSubscription
        ? await subscribeRedisPubSubPatterns(currentSessionId, [nextChannel])
        : await subscribeRedisPubSubChannels(currentSessionId, [nextChannel]);

      updateConnectionSession(activeConnectionId, (current) => ({
        ...current,
        subscribedChannels: sortChannels(
          Array.from(new Set([...current.subscribedChannels, ...appliedChannels]))
        ),
        lastError: null,
      }));
      setSubscribeChannel(DEFAULT_SUBSCRIBE_CHANNEL);
      if (!shouldUsePatternSubscription) {
        setPublishChannelForConnection(activeConnectionId, (current) =>
          current || nextChannel
        );
      }
    } catch (error) {
      showToast({
        message: getRedisErrorMessage(error),
        tone: "error",
        duration: 1800,
      });
    } finally {
      setPendingChannel(null);
    }
  }, [
    activeConnectionId,
    ensureSession,
    messages.app.status.notConnected,
    messages.pubsub.channelRequired,
    setPublishChannelForConnection,
    showToast,
    subscribeChannel,
    updateConnectionSession,
  ]);

  const handleUnsubscribe = useCallback(
    async (channel: string) => {
      if (!activeConnectionId) {
        return;
      }

      const currentSession =
        connectionSessionsRef.current[activeConnectionId] ?? EMPTY_SESSION;
      const currentSessionId = currentSession.sessionId;

      if (!currentSessionId) {
        updateConnectionSession(activeConnectionId, (current) => ({
          ...current,
          subscribedChannels: current.subscribedChannels.filter(
            (item) => item !== channel
          ),
        }));
        return;
      }

      setPendingChannel(channel);

      try {
        const removedChannels = isPatternSubscription(channel)
          ? await unsubscribeRedisPubSubPatterns(currentSessionId, [channel])
          : await unsubscribeRedisPubSubChannels(currentSessionId, [channel]);
        const remainingChannels = currentSession.subscribedChannels.filter(
          (item) => !removedChannels.includes(item)
        );

        updateConnectionSession(activeConnectionId, (current) => ({
          ...current,
          subscribedChannels: remainingChannels,
        }));
        setPublishChannelForConnection(activeConnectionId, (current) =>
          removedChannels.includes(current)
            ? getDefaultPublishChannel(remainingChannels)
            : current
        );
      } catch (error) {
        showToast({
          message: getRedisErrorMessage(error),
          tone: "error",
          duration: 1800,
        });
      } finally {
        setPendingChannel(null);
      }
    },
    [
      activeConnectionId,
      setPublishChannelForConnection,
      showToast,
      updateConnectionSession,
    ]
  );

  const handlePublish = useCallback(async () => {
    if (!activeConnection || !activeConnectionId) {
      showToast({
        message: messages.app.status.notConnected,
        tone: "error",
        duration: 1600,
      });
      return;
    }

    const nextChannel = publishChannel.trim();

    if (!nextChannel.length) {
      showToast({
        message: messages.pubsub.channelRequired,
        tone: "error",
        duration: 1600,
      });
      return;
    }

    setIsPublishing(true);

    try {
      const currentSession =
        connectionSessionsRef.current[activeConnectionId] ?? EMPTY_SESSION;
      const receivers = await publishRedisPubSubMessage(
        {
          ...activeConnection,
          db: activeConnection.mode === "cluster" ? 0 : activeConnection.db,
        },
        nextChannel,
        publishPayload
      );

      if (
        currentSession.subscribedChannels.some((subscription) =>
          matchesSubscription(subscription, nextChannel)
        )
      ) {
        const echoKey = createLocalEchoKey(
          activeConnectionId,
          nextChannel,
          publishPayload
        );
        localEchoRef.current.set(echoKey, Date.now());
        appendMessageToConnection(activeConnectionId, {
          id: createPubSubMessageId("local", Date.now()),
          channel: nextChannel,
          payload: publishPayload,
          timestamp: Date.now(),
        });
      }

      showToast({
        message: messages.pubsub.publishResult.replace(
          "{count}",
          String(receivers)
        ),
        tone: "success",
        duration: 1400,
      });

      updateConnectionSession(activeConnectionId, (current) => ({
        ...current,
        lastError: null,
      }));
    } catch (error) {
      showToast({
        message: getRedisErrorMessage(error),
        tone: "error",
        duration: 1800,
      });
    } finally {
      setIsPublishing(false);
    }
  }, [
    activeConnection,
    activeConnectionId,
    appendMessageToConnection,
    messages.app.status.notConnected,
    messages.pubsub.channelRequired,
    messages.pubsub.publishResult,
    publishChannel,
    publishPayload,
    showToast,
    updateConnectionSession,
  ]);

  const handleCopyMessage = useCallback(
    async (message: RedisPubSubMessage) => {
      try {
        await navigator.clipboard.writeText(message.payload);
        showToast({
          message: messages.common.copied,
          tone: "success",
        });
      } catch (error) {
        showToast({
          message: getRedisErrorMessage(error),
          tone: "error",
          duration: 1800,
        });
      }
    },
    [messages.common.copied, showToast]
  );

  const connectionLabel = activeConnection
    ? getRedisConnectionEndpointLabel(activeConnection)
    : messages.app.status.notConnected;
  const statusLabel = isConnecting
    ? messages.pubsub.connecting
    : isSessionActive
    ? messages.pubsub.listening
    : messages.pubsub.idle;
  const subscribeDraft = subscribeChannel.trim();
  const canSubscribe =
    Boolean(activeConnection) &&
    subscribeDraft.length > 0 &&
    pendingChannel !== subscribeDraft;
  const canPublish =
    Boolean(activeConnection) && publishChannel.trim().length > 0 && !isPublishing;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-base-300 p-3">
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col gap-3">
          <section className="rounded-2xl border border-base-content/8 bg-base-200/55 p-3 shadow-[0_14px_34px_-28px_rgba(0,0,0,0.55)]">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/8 text-primary">
                <Radio size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-base-content">
                  {messages.pubsub.title}
                </div>
                <div className="truncate text-[11px] font-mono text-base-content/45">
                  {connectionLabel}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span
                    className={`badge badge-xs font-mono ${
                      isSessionActive ? "badge-primary" : "badge-ghost"
                    }`}
                  >
                    {statusLabel}
                  </span>
                  <span className="badge badge-xs badge-ghost font-mono">
                    {messages.pubsub.subscriptions.replace(
                      "{count}",
                      String(activeSession.subscribedChannels.length)
                    )}
                  </span>
                </div>
              </div>
            </div>

            {activeSession.lastError ? (
              <div
                className="mt-3 rounded-xl border border-error/15 bg-error/8 px-2.5 py-2 text-[10px] font-mono text-error/85"
                title={activeSession.lastError}
              >
                <div className="truncate">{activeSession.lastError}</div>
              </div>
            ) : null}
          </section>

          <section className="rounded-2xl border border-base-content/8 bg-base-200/55 p-3 shadow-[0_14px_34px_-28px_rgba(0,0,0,0.55)]">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-base-content/45">
              {messages.pubsub.subscribe}
            </div>
            <div className="flex gap-2">
              <label className="input input-sm flex h-10 flex-1 items-center gap-2 rounded-xl border-base-200 bg-base-100/80">
                <Radio size={12} className="shrink-0 text-base-content/35" />
                <input
                  type="text"
                  value={subscribeChannel}
                  onChange={(event) => setSubscribeChannel(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleSubscribe();
                    }
                  }}
                  placeholder={messages.pubsub.channelPlaceholder}
                  className="w-full bg-transparent text-xs font-mono outline-none"
                  disabled={!activeConnection}
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  void handleSubscribe();
                }}
                disabled={!canSubscribe}
                className={`btn btn-sm h-10 rounded-xl px-3 ${
                  canSubscribe ? "cursor-pointer" : "cursor-not-allowed opacity-50"
                }`}
              >
                {pendingChannel === subscribeDraft ? (
                  <LoaderCircle size={12} className="animate-spin" />
                ) : (
                  messages.pubsub.subscribe
                )}
              </button>
            </div>

            <div className="mt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-base-content/45">
              {messages.pubsub.subscriptions.replace(
                "{count}",
                String(activeSession.subscribedChannels.length)
              )}
            </div>
            <div className="mt-2 flex max-h-40 min-h-12 flex-wrap content-start gap-1.5 overflow-y-auto pr-1">
              {activeSession.subscribedChannels.length ? (
                activeSession.subscribedChannels.map((channel) => (
                  <span
                    key={channel}
                    className="inline-flex h-7 max-w-full items-center gap-1 rounded-lg border border-base-content/8 bg-base-100/80 pl-2 pr-1 text-[10px] font-mono text-base-content/72"
                  >
                    <span className="max-w-[220px] truncate">{channel}</span>
                    <button
                      type="button"
                      onClick={() => {
                        void handleUnsubscribe(channel);
                      }}
                      disabled={pendingChannel === channel}
                      title={messages.pubsub.unsubscribe}
                      className={`flex h-5 w-5 items-center justify-center rounded-md transition-colors duration-150 ${
                        pendingChannel === channel
                          ? "cursor-not-allowed opacity-45"
                          : "cursor-pointer hover:bg-base-200"
                      }`}
                    >
                      {pendingChannel === channel ? (
                        <LoaderCircle size={10} className="animate-spin" />
                      ) : (
                        <X size={10} />
                      )}
                    </button>
                  </span>
                ))
              ) : (
                <div className="flex items-center text-[10px] font-mono text-base-content/38">
                  {messages.pubsub.noSubscriptions}
                </div>
              )}
            </div>
          </section>

          <section className="flex flex-1 flex-col rounded-2xl border border-base-content/8 bg-base-200/55 p-3 shadow-[0_14px_34px_-28px_rgba(0,0,0,0.55)]">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-base-content/45">
              {messages.pubsub.publish}
            </div>
            <label className="input input-sm flex h-10 items-center gap-2 rounded-xl border-base-200 bg-base-100/80">
              <SendHorizontal
                size={12}
                className="shrink-0 text-base-content/35"
              />
              <input
                type="text"
                value={publishChannel}
                onChange={(event) =>
                  setPublishChannelForConnection(
                    activeConnectionId,
                    event.target.value
                  )
                }
                placeholder={messages.pubsub.publishChannelPlaceholder}
                className="w-full bg-transparent text-xs font-mono outline-none"
                disabled={!activeConnection}
              />
            </label>
            <textarea
              value={publishPayload}
              onChange={(event) => setPublishPayload(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void handlePublish();
                }
              }}
              placeholder={messages.pubsub.payloadPlaceholder}
              className="textarea textarea-sm mt-2 min-h-[120px] flex-1 rounded-xl border-base-200 bg-base-100/80 text-xs font-mono leading-5"
              disabled={!activeConnection}
            />
            <button
              type="button"
              onClick={() => {
                void handlePublish();
              }}
              disabled={!canPublish}
              className={`btn btn-sm mt-2 h-10 rounded-xl gap-1.5 ${
                canPublish ? "cursor-pointer" : "cursor-not-allowed opacity-50"
              }`}
            >
              {isPublishing ? (
                <LoaderCircle size={12} className="animate-spin" />
              ) : (
                <SendHorizontal size={12} />
              )}
              {messages.pubsub.publish}
            </button>
            <div className="mt-2 text-[10px] font-mono text-base-content/38">
              {messages.pubsub.shortcuts}
            </div>
          </section>
        </aside>

        <section className="flex min-h-0 flex-col rounded-2xl border border-base-content/8 bg-base-200/45 shadow-[0_16px_36px_-30px_rgba(0,0,0,0.62)]">
          <div className="flex items-center justify-between gap-3 border-b border-base-content/8 px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-base-content/45">
                {messages.pubsub.stream}
              </div>
              <div className="mt-1 text-[10px] font-mono text-base-content/35">
                {messages.pubsub.shortcuts}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  if (!activeConnectionId) {
                    return;
                  }

                  updateConnectionSession(activeConnectionId, (current) => ({
                    ...current,
                    messagesStream: [],
                  }));
                }}
                disabled={!activeSession.messagesStream.length}
                className={`btn btn-ghost btn-xs gap-1 ${
                  activeSession.messagesStream.length
                    ? "cursor-pointer"
                    : "cursor-not-allowed opacity-45"
                }`}
              >
                <Trash2 size={11} />
                {messages.common.clear}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!activeConnectionId) {
                    return;
                  }

                  void stopSessionForConnection(activeConnectionId);
                }}
                disabled={!isSessionActive || isStopping}
                className={`btn btn-ghost btn-xs gap-1 text-warning ${
                  isSessionActive && !isStopping
                    ? "cursor-pointer"
                    : "cursor-not-allowed opacity-45"
                }`}
              >
                {isStopping ? (
                  <LoaderCircle size={11} className="animate-spin" />
                ) : (
                  <Square size={10} />
                )}
                {messages.common.disconnect}
              </button>
            </div>
          </div>

          <div
            ref={streamContainerRef}
            className="min-h-0 flex-1 overflow-y-auto p-3"
          >
            {activeSession.messagesStream.length ? (
              <div className="flex flex-col gap-2">
                {activeSession.messagesStream.map((message) => (
                  <div
                    key={message.id}
                    className="rounded-xl border border-base-content/8 bg-base-100/88 p-2.5 shadow-[0_10px_24px_-22px_rgba(0,0,0,0.65)]"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="badge badge-xs badge-primary font-mono">
                          {message.channel}
                        </span>
                        {message.pattern ? (
                          <span className="badge badge-xs badge-ghost font-mono">
                            {message.pattern}
                          </span>
                        ) : null}
                        <span className="text-[10px] font-mono text-base-content/40">
                          {formatPubSubTimestamp(message.timestamp)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          void handleCopyMessage(message);
                        }}
                        className="btn btn-ghost btn-xs h-6 w-6 cursor-pointer p-0"
                        title={messages.common.copy}
                      >
                        <Copy size={11} />
                      </button>
                    </div>
                    <pre className="overflow-x-auto whitespace-pre-wrap break-all text-[11px] leading-5 text-base-content/78">
                      {message.payload || '""'}
                    </pre>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-2 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-base-content/8 bg-base-100/70 text-base-content/35">
                  <Radio size={18} />
                </div>
                <div className="text-sm text-base-content/70">
                  {messages.pubsub.noMessages}
                </div>
                <div className="max-w-sm text-[11px] font-mono leading-5 text-base-content/40">
                  {messages.pubsub.noMessagesHint}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
});
