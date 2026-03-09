import type {
  AssistantMessage,
  Message as AiContextMessage,
} from "@mariozechner/pi-ai";
import type {
  AiAssistantEvent,
  AiToolEvent,
  KeyValue,
  RedisConnection,
  RedisKey,
} from "../../types";
import type { AiProviderConfig } from "../aiSettings";
import { getRedisConnectionEndpointLabel } from "../redisConnection";
import {
  COMMAND_PREFIX_PATTERN,
  MAX_CONTEXT_MESSAGES,
  MAX_TOOL_OUTPUT_LENGTH,
  MAX_VALUE_PREVIEW_LENGTH,
} from "./constants";
import type { OpenAIAssistantResponse } from "./types";

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}…`;
}

function isGenericRequestFailureMessage(message: string) {
  const normalizedMessage = message.trim().toLowerCase();

  return (
    normalizedMessage === "failed" ||
    normalizedMessage === "failed to fetch" ||
    normalizedMessage === "fetch failed" ||
    normalizedMessage === "network error" ||
    normalizedMessage === "load failed" ||
    normalizedMessage === "bad gateway" ||
    normalizedMessage === "error code: 502"
  );
}

export function truncateToolOutput(value: string) {
  return truncateText(value, MAX_TOOL_OUTPUT_LENGTH);
}

export function stringifyContextValue(value: KeyValue["value"]) {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return truncateText(value, MAX_VALUE_PREVIEW_LENGTH);
  }

  return truncateText(
    JSON.stringify(value, null, 2),
    MAX_VALUE_PREVIEW_LENGTH
  );
}

export function stringifyToolResult(value: unknown) {
  if (typeof value === "string") {
    return truncateToolOutput(value);
  }

  return truncateToolOutput(JSON.stringify(value, null, 2));
}

export function buildAssistantInstructions(autoSuggest: boolean) {
  const commandGuidance = autoSuggest
    ? [
        "If a Redis command would help, call the `suggestRedisCommand` tool with exactly one safe Redis command.",
        "Do not output a `COMMAND:` line unless the model cannot call tools.",
      ].join(" ")
    : "Do not suggest Redis commands unless the user explicitly asks for one.";

  return [
    "You are NeoRDM, an expert Redis assistant inside a desktop Redis client.",
    "Help the user understand data structures, debug issues, inspect live Redis state, and propose safe next steps.",
    "Be concise, practical, and answer in the same language as the user when possible.",
    "Never claim that a Redis write or dangerous command succeeded unless the tool confirms success.",
    "Prefer tools over guessing whenever the user asks about current Redis state.",
    "Use Redis tools instead of guessing whenever a live command would help.",
    "Use `runReadOnlyCommand` for safe read-only inspection commands.",
    "Use `runRedisCommand` when the task requires executing a Redis command; dangerous commands require explicit user confirmation before they run.",
    "Avoid session-oriented or multi-step commands such as SELECT, MULTI/EXEC, WATCH, AUTH, HELLO, or subscription flows.",
    commandGuidance,
    "Do not wrap a `COMMAND:` line in code fences.",
  ].join("\n");
}

export function normalizeAiRequestError(
  error: unknown,
  config: AiProviderConfig
) {
  const rawMessage =
    error instanceof Error ? error.message : String(error ?? "Unknown error");

  if (!isGenericRequestFailureMessage(rawMessage)) {
    return rawMessage;
  }

  const configuredBaseUrl = config.baseUrl.trim();
  const locationHint = configuredBaseUrl ? ` at ${configuredBaseUrl}` : "";

  return `OpenAI request failed${locationHint}. Check whether the upstream API endpoint is reachable from the Tauri backend.`;
}

export function buildRedisContext({
  activeConnection,
  selectedDb,
  selectedKey,
  keyValue,
  keysCount,
  includeKeyContext,
}: {
  activeConnection?: Pick<
    RedisConnection,
    "name" | "host" | "port" | "mode" | "sentinel"
  >;
  selectedDb: number;
  selectedKey: RedisKey | null;
  keyValue: KeyValue | null;
  keysCount: number;
  includeKeyContext: boolean;
}) {
  const lines = [
    "Redis client context:",
    activeConnection
      ? `- Active connection: ${activeConnection.name} (${getRedisConnectionEndpointLabel(activeConnection)})`
      : "- Active connection: none",
    `- Active database: db${selectedDb}`,
    `- Loaded keys in browser: ${keysCount}`,
  ];

  if (!includeKeyContext) {
    lines.push("- Selected key context: disabled by user settings");
    return lines.join("\n");
  }

  if (!selectedKey) {
    lines.push("- Selected key: none");
    return lines.join("\n");
  }

  lines.push(`- Selected key: ${selectedKey.key}`);
  lines.push(`- Selected key type: ${selectedKey.type}`);
  lines.push(`- Selected key ttl: ${selectedKey.ttl}`);

  if (keyValue && keyValue.key === selectedKey.key) {
    lines.push(
      `- Selected key value preview:\n${stringifyContextValue(keyValue.value)}`
    );
  }

  return lines.join("\n");
}

export function extractAssistantText(message: AssistantMessage) {
  return message.content
    .filter((block): block is Extract<typeof block, { type: "text" }> => {
      return block.type === "text" && block.text.trim().length > 0;
    })
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export function trimContextMessages(messages: AiContextMessage[]) {
  return messages.slice(-MAX_CONTEXT_MESSAGES);
}

export function parseAssistantResponse(
  rawContent: string,
  contextMessages: AiContextMessage[],
  commandFromTool?: string,
  tools?: string[],
  events?: AiAssistantEvent[],
  toolEvents?: AiToolEvent[],
  didMutateRedis = false
): OpenAIAssistantResponse {
  const command =
    commandFromTool ?? rawContent.match(COMMAND_PREFIX_PATTERN)?.[1]?.trim();
  const content = rawContent.replace(/^\s*COMMAND:\s*.+$/gim, "").trim();

  return {
    content: content || "Suggested a Redis command.",
    command: command || undefined,
    tools: tools?.length ? tools : undefined,
    events: events?.length ? events : undefined,
    toolEvents: toolEvents?.length ? toolEvents : undefined,
    didMutateRedis: didMutateRedis || undefined,
    contextMessages: trimContextMessages(contextMessages),
  };
}

export function requireActiveConnection(
  connection: RedisConnection | undefined
): RedisConnection {
  if (!connection) {
    throw new Error("No active Redis connection is available.");
  }

  return connection;
}

export function formatToolName(toolName: string) {
  return toolName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
}

export function createAbortError() {
  return new DOMException("The operation was aborted.", "AbortError");
}
