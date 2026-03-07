import {
  stream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type Message as AiContextMessage,
} from "@mariozechner/pi-ai";
import {
  getActiveAiProviderConfig,
  type AiProviderCapabilities,
  type AiProviderConfig,
  type OpenAiApiStyle,
} from "../aiSettings";
import type { AiAssistantEvent, AiToolEvent } from "../../types";
import { tauriProxyFetch, withTauriProxyFetch } from "../tauriHttpProxy";
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
import type {
  AssistantToolResultDetails,
  OpenAIAssistantRequest,
  OpenAIAssistantResponse,
} from "./types";

export type AiProviderConnectionTestCheckStatus =
  | "pending"
  | "running"
  | "success"
  | "info"
  | "error";

export interface AiProviderConnectionTestCheck {
  id: "config" | "models" | "responses" | "chat";
  label: string;
  status: AiProviderConnectionTestCheckStatus;
  detail: string;
}

export interface AiProviderConnectionTestResult {
  ok: boolean;
  summary: string;
  normalizedBaseUrl: string;
  model: string;
  preferredApiStyle: OpenAiApiStyle | null;
  capabilities: AiProviderCapabilities;
  checks: AiProviderConnectionTestCheck[];
}

interface AiProviderConnectionTestOptions {
  onUpdate?: (checks: AiProviderConnectionTestCheck[]) => void;
}

function cloneConnectionTestChecks(checks: AiProviderConnectionTestCheck[]) {
  return checks.map((check) => ({ ...check }));
}

function emitConnectionTestUpdate(
  checks: AiProviderConnectionTestCheck[],
  onUpdate?: (checks: AiProviderConnectionTestCheck[]) => void
) {
  onUpdate?.(cloneConnectionTestChecks(checks));
}

function updateConnectionTestCheck(
  checks: AiProviderConnectionTestCheck[],
  checkId: AiProviderConnectionTestCheck["id"],
  patch: Partial<AiProviderConnectionTestCheck>
) {
  const checkIndex = checks.findIndex((check) => check.id === checkId);

  if (checkIndex === -1) {
    return;
  }

  checks[checkIndex] = {
    ...checks[checkIndex],
    ...patch,
  };
}

function truncateDiagnosticMessage(value: string, maxLength = 240) {
  const normalizedValue = value.replace(/\s+/g, " ").trim();

  if (normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, maxLength)}…`;
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractApiErrorMessage(bodyText: string) {
  const parsedBody = safeParseJson(bodyText);

  if (
    parsedBody &&
    typeof parsedBody === "object" &&
    "error" in parsedBody &&
    parsedBody.error &&
    typeof parsedBody.error === "object" &&
    "message" in parsedBody.error &&
    typeof parsedBody.error.message === "string"
  ) {
    return truncateDiagnosticMessage(parsedBody.error.message);
  }

  if (
    parsedBody &&
    typeof parsedBody === "object" &&
    "message" in parsedBody &&
    typeof parsedBody.message === "string"
  ) {
    return truncateDiagnosticMessage(parsedBody.message);
  }

  return truncateDiagnosticMessage(bodyText);
}

function formatHttpFailure(
  response: Response,
  bodyText: string,
  fallbackDetail: string
) {
  const statusLine = `HTTP ${response.status} ${response.statusText}`.trim();
  const bodyDetail = extractApiErrorMessage(bodyText);

  if (!bodyDetail) {
    return `${statusLine} · ${fallbackDetail}`;
  }

  return `${statusLine} · ${bodyDetail}`;
}

function extractModelAvailabilityDetail(bodyText: string, currentModel: string) {
  const parsedBody = safeParseJson(bodyText);

  if (
    parsedBody &&
    typeof parsedBody === "object" &&
    "data" in parsedBody &&
    Array.isArray(parsedBody.data)
  ) {
    const modelIds = parsedBody.data
      .map((entry) => {
        if (
          entry &&
          typeof entry === "object" &&
          "id" in entry &&
          typeof entry.id === "string"
        ) {
          return entry.id;
        }

        return null;
      })
      .filter((modelId): modelId is string => Boolean(modelId));
    const hasCurrentModel = modelIds.includes(currentModel);

    return {
      status: hasCurrentModel ? ("success" as const) : ("info" as const),
      detail: hasCurrentModel
        ? `Gateway reachable. Model \`${currentModel}\` is listed in \`GET /models\`.`
        : `Gateway reachable. \`GET /models\` returned ${modelIds.length} models, but \`${currentModel}\` was not listed.`,
    };
  }

  return {
    status: "success" as const,
    detail: "Gateway reachable. `GET /models` responded successfully.",
  };
}

function extractResponseOutputPreview(bodyText: string) {
  const parsedBody = safeParseJson(bodyText);

  if (
    parsedBody &&
    typeof parsedBody === "object" &&
    "output_text" in parsedBody &&
    typeof parsedBody.output_text === "string" &&
    parsedBody.output_text.trim().length > 0
  ) {
    return truncateDiagnosticMessage(parsedBody.output_text);
  }

  if (
    parsedBody &&
    typeof parsedBody === "object" &&
    "output" in parsedBody &&
    Array.isArray(parsedBody.output)
  ) {
    const textBlocks = parsedBody.output.flatMap((item) => {
      if (
        !item ||
        typeof item !== "object" ||
        !("content" in item) ||
        !Array.isArray(item.content)
      ) {
        return [];
      }

      return item.content.flatMap((contentItem: unknown) => {
        if (
          contentItem &&
          typeof contentItem === "object" &&
          "text" in contentItem &&
          typeof contentItem.text === "string"
        ) {
          return [contentItem.text];
        }

        return [];
      });
    });
    const joinedText = textBlocks.join("\n").trim();

    return joinedText ? truncateDiagnosticMessage(joinedText) : "";
  }

  return "";
}

function extractChatCompletionPreview(bodyText: string) {
  const parsedBody = safeParseJson(bodyText);

  if (
    parsedBody &&
    typeof parsedBody === "object" &&
    "choices" in parsedBody &&
    Array.isArray(parsedBody.choices)
  ) {
    const firstChoice = parsedBody.choices[0];

    if (
      firstChoice &&
      typeof firstChoice === "object" &&
      "message" in firstChoice &&
      firstChoice.message &&
      typeof firstChoice.message === "object" &&
      "content" in firstChoice.message &&
      typeof firstChoice.message.content === "string"
    ) {
      return truncateDiagnosticMessage(firstChoice.message.content);
    }
  }

  return "";
}

function buildConnectionTestSummary(checks: AiProviderConnectionTestCheck[]) {
  const modelsCheck = checks.find((check) => check.id === "models");
  const responsesCheck = checks.find((check) => check.id === "responses");
  const chatCheck = checks.find((check) => check.id === "chat");

  if (responsesCheck?.status === "success") {
    if (chatCheck?.status === "success") {
      return "Responses API and Chat Completions API both work.";
    }

    if (modelsCheck?.status === "error") {
      return "Runtime request succeeded, but `GET /models` is unavailable on this gateway.";
    }

    return "OpenAI runtime connection verified.";
  }

  if (responsesCheck?.status === "error" && chatCheck?.status === "success") {
    return "Gateway supports `chat/completions`, while `responses` is unavailable.";
  }

  if (responsesCheck?.status === "error" && modelsCheck?.status === "success") {
    return "Gateway is reachable, but `POST /responses` failed.";
  }

  if (responsesCheck?.status === "error") {
    return "OpenAI connection test failed.";
  }

  return "OpenAI connection test completed.";
}

function resolvePreferredApiStyle(
  capabilities: Pick<AiProviderCapabilities, "responses" | "chatCompletions">
): OpenAiApiStyle | null {
  if (capabilities.responses) {
    return "responses";
  }

  if (capabilities.chatCompletions) {
    return "chat-completions";
  }

  return null;
}

function formatApiStyleLabel(apiStyle: OpenAiApiStyle | null) {
  if (apiStyle === "chat-completions") {
    return "POST /chat/completions";
  }

  if (apiStyle === "responses") {
    return "POST /responses";
  }

  return "Unknown";
}

function isAbortSignalTriggered(signal?: AbortSignal) {
  return Boolean(signal?.aborted);
}

function buildToolEventDetail(toolResult: {
  isError: boolean;
  toolName: string;
  content: Array<{ type: string; text?: string }>;
  details?: AssistantToolResultDetails;
}) {
  if (!toolResult.isError) {
    if (toolResult.details?.executedCommand) {
      return `Executed · ${toolResult.details.executedCommand}`;
    }

    return "Completed";
  }

  const errorText = toolResult.content
    .filter((block): block is { type: string; text: string } => {
      return block.type === "text" && typeof block.text === "string";
    })
    .map((block) => block.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!errorText) {
    return `${toolResult.toolName} failed`;
  }

  return errorText.length > 140 ? `${errorText.slice(0, 140)}…` : errorText;
}

function normalizeAssistantEventDetail(value: string) {
  if (!value) {
    return "";
  }

  const normalizedValue =
    value.trim().length === 0 ? JSON.stringify(value) : value.trimEnd();
  return normalizedValue;
}

function getPartialContentBlock(event: AssistantMessageEvent) {
  if (!("contentIndex" in event)) {
    return null;
  }

  return event.partial.content[event.contentIndex] ?? null;
}

function formatAssistantStreamEventDetail(event: AssistantMessageEvent) {
  switch (event.type) {
    case "start":
      return `${event.partial.provider} · ${event.partial.model}`;
    case "text_start":
    case "thinking_start":
      return "";
    case "text_delta": {
      const partialBlock = getPartialContentBlock(event);

      if (partialBlock?.type === "text") {
        return normalizeAssistantEventDetail(partialBlock.text);
      }

      return normalizeAssistantEventDetail(event.delta);
    }
    case "thinking_delta": {
      const partialBlock = getPartialContentBlock(event);

      if (partialBlock?.type === "thinking") {
        return normalizeAssistantEventDetail(partialBlock.thinking);
      }

      return normalizeAssistantEventDetail(event.delta);
    }
    case "text_end":
      return "completed";
    case "thinking_end":
      return "completed";
    case "toolcall_start": {
      const partialBlock = getPartialContentBlock(event);

      if (partialBlock?.type === "toolCall") {
        return partialBlock.name || `contentIndex=${event.contentIndex}`;
      }

      return `contentIndex=${event.contentIndex}`;
    }
    case "toolcall_delta": {
      const partialBlock = getPartialContentBlock(event);

      if (partialBlock?.type === "toolCall") {
        return `${partialBlock.name} ${normalizeAssistantEventDetail(
          JSON.stringify(partialBlock.arguments)
        )}`;
      }

      return normalizeAssistantEventDetail(event.delta);
    }
    case "toolcall_end":
      return `${event.toolCall.name} ${normalizeAssistantEventDetail(
        JSON.stringify(event.toolCall.arguments)
      )}`;
    case "done":
      return `reason=${event.reason}`;
    case "error":
      return event.error.errorMessage || `reason=${event.reason}`;
    default:
      return "";
  }
}

function getAssistantStreamEventId(
  toolLoopIteration: number,
  event: AssistantMessageEvent
) {
  switch (event.type) {
    case "start":
    case "done":
    case "error":
      return `loop-${toolLoopIteration}-${event.type}`;
    default:
      return `loop-${toolLoopIteration}-${event.type}-${event.contentIndex}`;
  }
}

function emitToolEvent(
  request: OpenAIAssistantRequest,
  events: AiToolEvent[],
  event: Omit<AiToolEvent, "timestamp">
) {
  const nextEvent: AiToolEvent = {
    ...event,
    timestamp: new Date(),
  };

  const existingEventIndex = events.findIndex((item) => item.id === nextEvent.id);

  if (existingEventIndex === -1) {
    events.push(nextEvent);
  } else {
    events[existingEventIndex] = nextEvent;
  }

  request.onToolEvent?.(nextEvent);
}

function emitAssistantEvent(
  request: OpenAIAssistantRequest,
  events: AiAssistantEvent[],
  event: Omit<AiAssistantEvent, "timestamp">
) {
  const nextEvent: AiAssistantEvent = {
    ...event,
    timestamp: new Date(),
  };

  const existingEventIndex = events.findIndex((item) => item.id === nextEvent.id);

  if (existingEventIndex === -1) {
    events.push(nextEvent);
  } else {
    events[existingEventIndex] = nextEvent;
  }

  request.onAssistantEvent?.(nextEvent);
}

async function streamWithConfiguredModel({
  config,
  context,
  maxTokens,
  signal,
  onEvent,
}: {
  config: AiProviderConfig;
  context: Context;
  maxTokens: number;
  signal?: AbortSignal;
  onEvent?: (event: AssistantMessageEvent) => void;
}): Promise<AssistantMessage> {
  const validatedConfig = getValidatedOpenAIConfig(config);
  const model = createConfiguredOpenAIModel(config);

  return withTauriProxyFetch(async () => {
    const assistantEventStream = stream(model, context, {
      apiKey: validatedConfig.apiKey,
      maxTokens,
      signal,
    });

    for await (const event of assistantEventStream) {
      onEvent?.(event);
    }

    return assistantEventStream.result();
  });
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
  const usedTools: string[] = [];
  const assistantEvents: AiAssistantEvent[] = [];
  const toolEvents: AiToolEvent[] = [];
  let didMutateRedis = false;

  try {
    for (
      let toolLoopIterations = 0;
      toolLoopIterations < MAX_TOOL_LOOP_ITERATIONS;
      toolLoopIterations += 1
    ) {
      if (isAbortSignalTriggered(request.signal)) {
        throw createAbortError();
      }

      const assistantMessage = await streamWithConfiguredModel({
        config: activeProvider,
        context,
        maxTokens: request.settings.maxTokens,
        signal: request.signal,
        onEvent: (event) => {
          emitAssistantEvent(request, assistantEvents, {
            id: getAssistantStreamEventId(toolLoopIterations, event),
            type: event.type,
            detail: formatAssistantStreamEventDetail(event),
          });
        },
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
        const fallbackContent =
          didMutateRedis
            ? "Executed the requested Redis command."
            : usedTools.length > 0
            ? "Completed the requested Redis inspection."
            : "";

        if (!normalizedContent && !suggestedCommandFromTool && !fallbackContent) {
          throw new Error("The AI provider returned an empty assistant response.");
        }

        return parseAssistantResponse(
          normalizedContent || fallbackContent,
          trimContextMessages(context.messages),
          suggestedCommandFromTool,
          usedTools,
          assistantEvents,
          toolEvents,
          didMutateRedis
        );
      }

      for (const toolCall of toolCalls) {
        const formattedToolName = formatToolName(toolCall.name);
        request.onToolActivity?.(formattedToolName);
        usedTools.push(formattedToolName);
        emitToolEvent(request, toolEvents, {
          id: toolCall.id,
          toolName: formattedToolName,
          status: "running",
          detail: "Running…",
        });

        const toolResult = await executeAssistantToolCall({
          request,
          tools,
          toolCall,
          onSuggestedCommand: (command) => {
            suggestedCommandFromTool = command;
          },
        });

        context.messages.push(toolResult);
        didMutateRedis =
          didMutateRedis || Boolean(toolResult.details?.didMutateRedis);
        emitToolEvent(request, toolEvents, {
          id: toolCall.id,
          toolName: formattedToolName,
          status: toolResult.isError ? "error" : "success",
          detail: buildToolEventDetail(toolResult),
        });
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

export async function testAiProviderConnection(
  config: AiProviderConfig,
  options: AiProviderConnectionTestOptions = {}
): Promise<AiProviderConnectionTestResult> {
  const checks: AiProviderConnectionTestCheck[] = [
    {
      id: "config",
      label: "Config",
      status: "running",
      detail: "Validating API key, base URL, and model.",
    },
    {
      id: "models",
      label: "GET /models",
      status: "pending",
      detail: "Checks whether the gateway is reachable through the backend proxy.",
    },
    {
      id: "responses",
      label: "POST /responses",
      status: "pending",
      detail: "Runs the same endpoint the AI agent uses at runtime.",
    },
    {
      id: "chat",
      label: "POST /chat/completions",
      status: "pending",
      detail: "Checks legacy OpenAI chat compatibility on the same gateway.",
    },
  ];
  emitConnectionTestUpdate(checks, options.onUpdate);

  let validatedConfig: ReturnType<typeof getValidatedOpenAIConfig>;

  try {
    validatedConfig = getValidatedOpenAIConfig(config);
    updateConnectionTestCheck(checks, "config", {
      status: "success",
      detail: `Using model \`${validatedConfig.model}\` at \`${validatedConfig.baseUrl}\`.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateConnectionTestCheck(checks, "config", {
      status: "error",
      detail: message,
    });
    emitConnectionTestUpdate(checks, options.onUpdate);

    return {
      ok: false,
      summary: "AI settings are incomplete.",
      normalizedBaseUrl: config.baseUrl.trim(),
      model: config.model.trim(),
      preferredApiStyle: null,
      capabilities: {
        responses: null,
        chatCompletions: null,
        testedAt: null,
      },
      checks: cloneConnectionTestChecks(checks),
    };
  }

  emitConnectionTestUpdate(checks, options.onUpdate);

  updateConnectionTestCheck(checks, "models", {
    status: "running",
    detail: "Checking `GET /models`…",
  });
  emitConnectionTestUpdate(checks, options.onUpdate);

  const capabilities: AiProviderCapabilities = {
    responses: false,
    chatCompletions: false,
    testedAt: Date.now(),
  };

  try {
    const modelsResponse = await tauriProxyFetch(
      `${validatedConfig.baseUrl}/models`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${validatedConfig.apiKey}`,
        },
      }
    );
    const modelsBodyText = await modelsResponse.text();

    if (!modelsResponse.ok) {
      updateConnectionTestCheck(checks, "models", {
        status: "error",
        detail: formatHttpFailure(
          modelsResponse,
          modelsBodyText,
          "`GET /models` did not return a success status."
        ),
      });
    } else {
      const modelAvailability = extractModelAvailabilityDetail(
        modelsBodyText,
        validatedConfig.model
      );
      updateConnectionTestCheck(checks, "models", modelAvailability);
    }
  } catch (error) {
    updateConnectionTestCheck(checks, "models", {
      status: "error",
      detail: normalizeAiRequestError(error, config),
    });
  }

  emitConnectionTestUpdate(checks, options.onUpdate);

  updateConnectionTestCheck(checks, "responses", {
    status: "running",
    detail: "Checking `POST /responses`…",
  });
  emitConnectionTestUpdate(checks, options.onUpdate);

  try {
    const runtimeResponse = await tauriProxyFetch(
      `${validatedConfig.baseUrl}/responses`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${validatedConfig.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: validatedConfig.model,
          input: "Reply with OK only.",
          max_output_tokens: 16,
          store: false,
        }),
      }
    );
    const runtimeBodyText = await runtimeResponse.text();

    if (!runtimeResponse.ok) {
      updateConnectionTestCheck(checks, "responses", {
        status: "error",
        detail: formatHttpFailure(
          runtimeResponse,
          runtimeBodyText,
          "`POST /responses` did not return a success status."
        ),
      });
    } else {
      capabilities.responses = true;
      const outputPreview = extractResponseOutputPreview(runtimeBodyText);
      updateConnectionTestCheck(checks, "responses", {
        status: "success",
        detail: outputPreview
          ? `Runtime endpoint succeeded. Model reply: ${outputPreview}`
          : "Runtime endpoint succeeded and returned a valid response.",
      });
    }
  } catch (error) {
    updateConnectionTestCheck(checks, "responses", {
      status: "error",
      detail: normalizeAiRequestError(error, config),
    });
  }

  emitConnectionTestUpdate(checks, options.onUpdate);

  updateConnectionTestCheck(checks, "chat", {
    status: "running",
    detail: "Checking `POST /chat/completions`…",
  });
  emitConnectionTestUpdate(checks, options.onUpdate);

  try {
    const chatResponse = await tauriProxyFetch(
      `${validatedConfig.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${validatedConfig.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: validatedConfig.model,
          messages: [
            {
              role: "user",
              content: "Reply with OK only.",
            },
          ],
          max_tokens: 16,
          temperature: 0,
        }),
      }
    );
    const chatBodyText = await chatResponse.text();

    if (!chatResponse.ok) {
      updateConnectionTestCheck(checks, "chat", {
        status: "error",
        detail: formatHttpFailure(
          chatResponse,
          chatBodyText,
          "`POST /chat/completions` did not return a success status."
        ),
      });
    } else {
      capabilities.chatCompletions = true;
      const outputPreview = extractChatCompletionPreview(chatBodyText);
      updateConnectionTestCheck(checks, "chat", {
        status: "success",
        detail: outputPreview
          ? `Chat Completions succeeded. Model reply: ${outputPreview}`
          : "Chat Completions succeeded and returned a valid response.",
      });
    }
  } catch (error) {
    updateConnectionTestCheck(checks, "chat", {
      status: "error",
      detail: normalizeAiRequestError(error, config),
    });
  }

  emitConnectionTestUpdate(checks, options.onUpdate);

  const preferredApiStyle = resolvePreferredApiStyle(capabilities);
  const summary = buildConnectionTestSummary(checks);

  const result: AiProviderConnectionTestResult = {
    ok: preferredApiStyle !== null,
    summary: preferredApiStyle
      ? `${summary} Runtime will use ${formatApiStyleLabel(preferredApiStyle)}.`
      : summary,
    normalizedBaseUrl: validatedConfig.baseUrl,
    model: validatedConfig.model,
    preferredApiStyle,
    capabilities,
    checks: cloneConnectionTestChecks(checks),
  };

  return result;
}
