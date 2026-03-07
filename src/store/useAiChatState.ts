import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import type { Message as AiContextMessage } from "@mariozechner/pi-ai";
import { loadAiSettings } from "../lib/aiSettings";
import {
  requestOpenAIAssistantResponse,
  warmOpenAIAssistantRuntime,
} from "../lib/openai";
import { getRedisErrorMessage } from "../lib/redis";
import { recordCrashReport } from "../lib/privacyRuntime";
import type {
  AiAssistantEvent,
  AiToolEvent,
  ChatMessage,
  KeyValue,
  PendingAiCommandConfirmation,
  RedisConnection,
  RedisKey,
} from "../types";

function createChatMessage(
  role: ChatMessage["role"],
  content: string,
  command?: string,
  tools?: string[],
  events?: AiAssistantEvent[],
  toolEvents?: AiToolEvent[]
): ChatMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    command,
    tools,
    events,
    toolEvents,
    timestamp: new Date(),
  };
}

function mergeItemsById<T extends { id: string }>(previous: T[], incoming: T[]) {
  if (incoming.length === 0) {
    return previous;
  }

  const nextItems = [...previous];
  const indicesById = new Map(
    nextItems.map((item, index) => [item.id, index] as const)
  );

  for (const item of incoming) {
    const existingIndex = indicesById.get(item.id);

    if (existingIndex === undefined) {
      indicesById.set(item.id, nextItems.length);
      nextItems.push(item);
      continue;
    }

    nextItems[existingIndex] = item;
  }

  return nextItems;
}

function waitForNextPaint() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.setTimeout(() => resolve(), 0);
    });
  });
}

interface UseAiChatStateOptions {
  initialGreeting: string;
  getRuntimeContext: () => {
    activeConnection?: RedisConnection;
    selectedDb: number;
    selectedKey: RedisKey | null;
    keyValue: KeyValue | null;
    keys: RedisKey[];
    onRefreshKeys?: () => Promise<void>;
    onRefreshKeyValue?: () => Promise<void>;
  };
}

export function useAiChatState({
  initialGreeting,
  getRuntimeContext,
}: UseAiChatStateOptions) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => [
    createChatMessage("assistant", initialGreeting),
  ]);
  const [contextMessages, setContextMessages] = useState<AiContextMessage[]>([]);
  const [isAiResponding, setIsAiResponding] = useState(false);
  const [activeAiToolName, setActiveAiToolName] = useState<string | null>(null);
  const [activeAiToolEvents, setActiveAiToolEvents] = useState<AiToolEvent[]>([]);
  const [activeAiAssistantEvents, setActiveAiAssistantEvents] = useState<
    AiAssistantEvent[]
  >([]);
  const [pendingAiCommandConfirmation, setPendingAiCommandConfirmation] =
    useState<PendingAiCommandConfirmation | null>(null);
  const aiAbortControllerRef = useRef<AbortController | null>(null);
  const toolEventQueueRef = useRef<AiToolEvent[]>([]);
  const assistantEventQueueRef = useRef<AiAssistantEvent[]>([]);
  const toolEventFlushTimeoutRef = useRef<number | null>(null);
  const assistantEventFlushTimeoutRef = useRef<number | null>(null);
  const pendingConfirmationResolverRef = useRef<((approved: boolean) => void) | null>(
    null
  );

  const flushToolEventQueue = useCallback(() => {
    toolEventFlushTimeoutRef.current = null;

    if (toolEventQueueRef.current.length === 0) {
      return;
    }

    const queuedEvents = toolEventQueueRef.current;
    toolEventQueueRef.current = [];

    startTransition(() => {
      setActiveAiToolEvents((previous) => mergeItemsById(previous, queuedEvents));
    });
  }, []);

  const flushAssistantEventQueue = useCallback(() => {
    assistantEventFlushTimeoutRef.current = null;

    if (assistantEventQueueRef.current.length === 0) {
      return;
    }

    const queuedEvents = assistantEventQueueRef.current;
    assistantEventQueueRef.current = [];

    startTransition(() => {
      setActiveAiAssistantEvents((previous) =>
        mergeItemsById(previous, queuedEvents)
      );
    });
  }, []);

  const queueToolEvent = useCallback(
    (event: AiToolEvent) => {
      toolEventQueueRef.current.push(event);

      if (toolEventFlushTimeoutRef.current !== null) {
        return;
      }

      toolEventFlushTimeoutRef.current = window.setTimeout(flushToolEventQueue, 80);
    },
    [flushToolEventQueue]
  );

  const queueAssistantEvent = useCallback(
    (event: AiAssistantEvent) => {
      assistantEventQueueRef.current.push(event);

      if (assistantEventFlushTimeoutRef.current !== null) {
        return;
      }

      assistantEventFlushTimeoutRef.current = window.setTimeout(
        flushAssistantEventQueue,
        80
      );
    },
    [flushAssistantEventQueue]
  );

  const resetStreamingQueues = useCallback(() => {
    if (toolEventFlushTimeoutRef.current !== null) {
      window.clearTimeout(toolEventFlushTimeoutRef.current);
      toolEventFlushTimeoutRef.current = null;
    }

    if (assistantEventFlushTimeoutRef.current !== null) {
      window.clearTimeout(assistantEventFlushTimeoutRef.current);
      assistantEventFlushTimeoutRef.current = null;
    }

    toolEventQueueRef.current = [];
    assistantEventQueueRef.current = [];
  }, []);

  const resolvePendingAiCommandConfirmation = useCallback((approved: boolean) => {
    pendingConfirmationResolverRef.current?.(approved);
    pendingConfirmationResolverRef.current = null;
    setPendingAiCommandConfirmation(null);
  }, []);

  const resetStreamingUiState = useCallback(() => {
    resolvePendingAiCommandConfirmation(false);
    resetStreamingQueues();
    setActiveAiToolName(null);
    setActiveAiToolEvents([]);
    setActiveAiAssistantEvents([]);
  }, [resetStreamingQueues, resolvePendingAiCommandConfirmation]);

  useEffect(() => {
    return () => {
      aiAbortControllerRef.current?.abort();
      resolvePendingAiCommandConfirmation(false);
      resetStreamingQueues();
    };
  }, [resetStreamingQueues, resolvePendingAiCommandConfirmation]);

  const confirmDangerousCommand = useCallback(
    (confirmation: PendingAiCommandConfirmation) => {
      if (pendingConfirmationResolverRef.current) {
        resolvePendingAiCommandConfirmation(false);
      }

      queueToolEvent({
        id: confirmation.toolCallId,
        toolName: confirmation.toolName,
        status: "running",
        detail: `Awaiting confirmation · ${confirmation.command}`,
        timestamp: new Date(),
      });
      setPendingAiCommandConfirmation(confirmation);

      return new Promise<boolean>((resolve) => {
        pendingConfirmationResolverRef.current = resolve;
      });
    },
    [queueToolEvent, resolvePendingAiCommandConfirmation]
  );

  const approveAiCommandConfirmation = useCallback(() => {
    if (!pendingAiCommandConfirmation) {
      return;
    }

    queueToolEvent({
      id: pendingAiCommandConfirmation.toolCallId,
      toolName: pendingAiCommandConfirmation.toolName,
      status: "running",
      detail: `Confirmed · ${pendingAiCommandConfirmation.command}`,
      timestamp: new Date(),
    });
    resolvePendingAiCommandConfirmation(true);
  }, [
    pendingAiCommandConfirmation,
    queueToolEvent,
    resolvePendingAiCommandConfirmation,
  ]);

  const rejectAiCommandConfirmation = useCallback(() => {
    resolvePendingAiCommandConfirmation(false);
  }, [resolvePendingAiCommandConfirmation]);

  const sendChatMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();

      if (!trimmed || isAiResponding) {
        return;
      }

      const userMessage = createChatMessage("user", trimmed);
      const conversationMessages = [...chatMessages, userMessage];
      const nextContextMessages: AiContextMessage[] = [
        ...contextMessages,
        {
          role: "user",
          content: trimmed,
          timestamp: Date.now(),
        },
      ];
      const abortController = new AbortController();

      aiAbortControllerRef.current = abortController;
      setChatMessages(conversationMessages);
      setContextMessages(nextContextMessages);
      setIsAiResponding(true);
      resetStreamingUiState();
      await waitForNextPaint();

      try {
        await warmOpenAIAssistantRuntime();
        const settings = await loadAiSettings();
        const runtimeContext = getRuntimeContext();
        const assistantRequest = {
          settings,
          contextMessages: nextContextMessages,
          userInput: trimmed,
          activeConnection: runtimeContext.activeConnection,
          selectedDb: runtimeContext.selectedDb,
          selectedKey: runtimeContext.selectedKey,
          keyValue: runtimeContext.keyValue,
          loadedKeys: runtimeContext.keys,
          keysCount: runtimeContext.keys.length,
          signal: abortController.signal,
          onToolActivity: setActiveAiToolName,
          onToolEvent: queueToolEvent,
          onAssistantEvent: queueAssistantEvent,
          confirmDangerousCommand,
        };
        const assistantResponse = await requestOpenAIAssistantResponse(
          assistantRequest
        );

        setContextMessages(assistantResponse.contextMessages);

        setChatMessages((previous) => [
          ...previous,
          createChatMessage(
            "assistant",
            assistantResponse.content,
            assistantResponse.command,
            assistantResponse.tools,
            assistantResponse.events,
            assistantResponse.toolEvents
          ),
        ]);

        if (assistantResponse.didMutateRedis) {
          void runtimeContext.onRefreshKeys?.();
          void runtimeContext.onRefreshKeyValue?.();
        }
      } catch (error) {
        const isAbortError =
          error instanceof Error &&
          (error.name === "AbortError" ||
            error.message.toLowerCase().includes("aborted"));

        void recordCrashReport("ai.sendChatMessage", error);

        if (!isAbortError) {
          setChatMessages((previous) => [
            ...previous,
            createChatMessage("assistant", getRedisErrorMessage(error)),
          ]);
        }
      } finally {
        if (aiAbortControllerRef.current === abortController) {
          aiAbortControllerRef.current = null;
        }

        resetStreamingUiState();
        setIsAiResponding(false);
      }
    },
    [
      chatMessages,
      contextMessages,
      getRuntimeContext,
      isAiResponding,
      confirmDangerousCommand,
      queueAssistantEvent,
      queueToolEvent,
      resetStreamingUiState,
    ]
  );

  const stopChatResponse = useCallback(() => {
    resolvePendingAiCommandConfirmation(false);
    aiAbortControllerRef.current?.abort();
  }, [resolvePendingAiCommandConfirmation]);

  return {
    activeAiToolName,
    activeAiToolEvents,
    activeAiAssistantEvents,
    approveAiCommandConfirmation,
    chatMessages,
    isAiResponding,
    pendingAiCommandConfirmation,
    rejectAiCommandConfirmation,
    sendChatMessage,
    stopChatResponse,
  };
}
