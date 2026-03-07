import { useCallback, useEffect, useRef, useState } from "react";
import type { Message as AiContextMessage } from "@mariozechner/pi-ai";
import { loadAiSettings } from "../lib/aiSettings";
import { requestOpenAIAssistantResponse } from "../lib/openai";
import { getRedisErrorMessage } from "../lib/redis";
import { recordCrashReport } from "../lib/privacyRuntime";
import type { ChatMessage, KeyValue, RedisConnection, RedisKey } from "../types";

function createChatMessage(
  role: ChatMessage["role"],
  content: string,
  command?: string
): ChatMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    command,
    timestamp: new Date(),
  };
}

interface UseAiChatStateOptions {
  initialGreeting: string;
  activeConnection?: RedisConnection;
  selectedDb: number;
  selectedKey: RedisKey | null;
  keyValue: KeyValue | null;
  keys: RedisKey[];
}

export function useAiChatState({
  initialGreeting,
  activeConnection,
  selectedDb,
  selectedKey,
  keyValue,
  keys,
}: UseAiChatStateOptions) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => [
    createChatMessage("assistant", initialGreeting),
  ]);
  const [contextMessages, setContextMessages] = useState<AiContextMessage[]>([]);
  const [isAiResponding, setIsAiResponding] = useState(false);
  const [activeAiToolName, setActiveAiToolName] = useState<string | null>(null);
  const aiAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      aiAbortControllerRef.current?.abort();
    };
  }, []);

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
      setActiveAiToolName(null);

      try {
        const settings = await loadAiSettings();
        const assistantRequest = {
          settings,
          contextMessages: nextContextMessages,
          userInput: trimmed,
          activeConnection,
          selectedDb,
          selectedKey,
          keyValue,
          loadedKeys: keys,
          keysCount: keys.length,
          signal: abortController.signal,
          onToolActivity: setActiveAiToolName,
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
            assistantResponse.command
          ),
        ]);
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

        setActiveAiToolName(null);
        setIsAiResponding(false);
      }
    },
    [
      activeConnection,
      chatMessages,
      contextMessages,
      isAiResponding,
      keyValue,
      keys,
      keys.length,
      selectedDb,
      selectedKey,
    ]
  );

  const stopChatResponse = useCallback(() => {
    aiAbortControllerRef.current?.abort();
  }, []);

  return {
    activeAiToolName,
    chatMessages,
    isAiResponding,
    sendChatMessage,
    stopChatResponse,
  };
}
