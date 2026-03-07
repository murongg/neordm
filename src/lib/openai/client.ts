import {
  complete,
  type Context,
  type Message as AiContextMessage,
} from "@mariozechner/pi-ai";
import { getActiveAiProviderConfig, type AiProviderConfig } from "../aiSettings";
import { withTauriProxyFetch } from "../tauriHttpProxy";
import { MAX_TOOL_LOOP_ITERATIONS } from "./constants";
import {
  buildAssistantInstructions,
  buildRedisContext,
  createAbortError,
  extractAssistantText,
  formatToolName,
  normalizeAiRequestError,
  parseAssistantResponse,
  trimContextMessages,
} from "./helpers";
import { createConfiguredOpenAIModel, getValidatedOpenAIConfig } from "./provider";
import { createAssistantTools, executeAssistantToolCall } from "./tools";
import type { OpenAIAssistantRequest, OpenAIAssistantResponse } from "./types";

async function completeWithConfiguredModel({
  config,
  context,
  maxTokens,
  signal,
}: {
  config: AiProviderConfig;
  context: Context;
  maxTokens: number;
  signal?: AbortSignal;
}) {
  const validatedConfig = getValidatedOpenAIConfig(config);
  const model = createConfiguredOpenAIModel(config);

  return withTauriProxyFetch(() =>
    complete(model, context, {
      apiKey: validatedConfig.apiKey,
      maxTokens,
      signal,
    })
  );
}

function isAbortSignalTriggered(signal?: AbortSignal) {
  return Boolean(signal?.aborted);
}

function createConversationContext(
  request: OpenAIAssistantRequest,
  tools = createAssistantTools(request.settings.autoSuggest)
): {
  context: Context;
  tools: ReturnType<typeof createAssistantTools>;
} {
  const nextMessages: AiContextMessage[] = trimContextMessages([
    ...request.contextMessages,
    {
      role: "user",
      content: request.userInput,
      timestamp: Date.now(),
    },
  ]);

  return {
    context: {
      systemPrompt: [
        buildAssistantInstructions(request.settings.autoSuggest),
        buildRedisContext({
          activeConnection: request.activeConnection,
          selectedDb: request.selectedDb,
          selectedKey: request.selectedKey,
          keyValue: request.keyValue,
          keysCount: request.keysCount,
          includeKeyContext: request.settings.includeKeyContext,
        }),
      ].join("\n\n"),
      messages: nextMessages,
      tools,
    },
    tools,
  };
}

export async function requestOpenAIAssistantResponse(
  request: OpenAIAssistantRequest
): Promise<OpenAIAssistantResponse> {
  const activeProvider = getActiveAiProviderConfig(request.settings);
  const { context, tools } = createConversationContext(request);
  let suggestedCommandFromTool: string | undefined;

  try {
    for (
      let toolLoopIterations = 0;
      toolLoopIterations < MAX_TOOL_LOOP_ITERATIONS;
      toolLoopIterations += 1
    ) {
      if (isAbortSignalTriggered(request.signal)) {
        throw createAbortError();
      }

      const assistantMessage = await completeWithConfiguredModel({
        config: activeProvider,
        context,
        maxTokens: request.settings.maxTokens,
        signal: request.signal,
      });

      if (assistantMessage.stopReason === "aborted" || isAbortSignalTriggered(request.signal)) {
        throw createAbortError();
      }

      if (assistantMessage.stopReason === "error") {
        throw new Error(
          assistantMessage.errorMessage || "The AI provider returned an error."
        );
      }

      context.messages.push(assistantMessage);

      const toolCalls = assistantMessage.content.filter(
        (block): block is Extract<typeof block, { type: "toolCall" }> =>
          block.type === "toolCall"
      );

      if (toolCalls.length === 0) {
        const normalizedContent = extractAssistantText(assistantMessage);

        if (!normalizedContent && !suggestedCommandFromTool) {
          throw new Error("The AI provider returned an empty assistant response.");
        }

        return parseAssistantResponse(
          normalizedContent,
          trimContextMessages(context.messages),
          suggestedCommandFromTool
        );
      }

      for (const toolCall of toolCalls) {
        request.onToolActivity?.(formatToolName(toolCall.name));

        const toolResult = await executeAssistantToolCall({
          request,
          tools,
          toolCall,
          onSuggestedCommand: (command) => {
            suggestedCommandFromTool = command;
          },
        });

        context.messages.push(toolResult);
      }

      request.onToolActivity?.(null);
    }

    throw new Error("The AI provider reached the maximum tool-call steps.");
  } catch (error) {
    request.onToolActivity?.(null);

    if (
      error instanceof DOMException &&
      error.name === "AbortError"
    ) {
      throw error;
    }

    throw new Error(normalizeAiRequestError(error, activeProvider));
  }
}

export async function testAiProviderConnection(config: AiProviderConfig) {
  try {
    const assistantMessage = await completeWithConfiguredModel({
      config,
      context: {
        messages: [
          {
            role: "user",
            content: 'Reply with "OK" only.',
            timestamp: Date.now(),
          },
        ],
      },
      maxTokens: 16,
    });

    if (assistantMessage.stopReason === "error") {
      throw new Error(assistantMessage.errorMessage || "Unknown OpenAI error");
    }

    return extractAssistantText(assistantMessage) || "OK";
  } catch (error) {
    throw new Error(normalizeAiRequestError(error, config));
  }
}
