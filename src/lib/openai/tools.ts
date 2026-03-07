import {
  StringEnum,
  Type,
  validateToolCall,
  type Static,
  type Tool,
  type ToolCall,
  type ToolResultMessage,
} from "@mariozechner/pi-ai";
import { getRedisKeyValue, listRedisKeys, runRedisCommand } from "../redis";
import { getCliCommandName, isReadOnlyRedisCommand } from "../redisCli";
import {
  AI_TOOL_NAMES,
  DEFAULT_SCAN_COUNT,
  DEFAULT_SCAN_MAX_KEYS,
  DISALLOWED_AI_READ_ONLY_COMMANDS,
} from "./constants";
import {
  requireActiveConnection,
  stringifyContextValue,
  stringifyToolResult,
} from "./helpers";
import type { OpenAIAssistantRequest } from "./types";

const KEY_TYPES = [
  "any",
  "string",
  "hash",
  "list",
  "set",
  "zset",
  "stream",
  "json",
] as const;
const SERVER_INFO_SECTIONS = [
  "summary",
  "server",
  "memory",
  "stats",
  "clients",
  "keyspace",
] as const;

const GET_CLIENT_CONTEXT_PARAMETERS = Type.Object(
  {},
  { additionalProperties: false }
);

const SEARCH_LOADED_KEYS_PARAMETERS = Type.Object(
  {
    query: Type.Optional(
      Type.String({
        description: "Substring to match against loaded key names.",
      })
    ),
    type: Type.Optional(
      StringEnum(KEY_TYPES, {
        description: "Optional Redis key type filter.",
        default: "any",
      })
    ),
    limit: Type.Optional(
      Type.Integer({
        description: "Maximum number of keys to return.",
        minimum: 1,
        maximum: 50,
      })
    ),
  },
  { additionalProperties: false }
);

const SCAN_KEYS_PARAMETERS = Type.Object(
  {
    pattern: Type.Optional(
      Type.String({
        description:
          "Optional Redis glob pattern, for example `user:*` or `session:?`.",
      })
    ),
    type: Type.Optional(
      StringEnum(KEY_TYPES, {
        description: "Optional Redis key type filter.",
        default: "any",
      })
    ),
    limit: Type.Optional(
      Type.Integer({
        description: "Maximum number of keys to return.",
        minimum: 1,
        maximum: 100,
      })
    ),
  },
  { additionalProperties: false }
);

const KEY_PARAMETERS = Type.Object(
  {
    key: Type.String({
      description: "Exact Redis key name.",
      minLength: 1,
    }),
  },
  { additionalProperties: false }
);

const READ_ONLY_COMMAND_PARAMETERS = Type.Object(
  {
    command: Type.String({
      description:
        "One read-only Redis command, for example `SCAN 0 MATCH user:* COUNT 20` or `INFO memory`.",
      minLength: 1,
    }),
  },
  { additionalProperties: false }
);

const SUGGEST_COMMAND_PARAMETERS = Type.Object(
  {
    command: Type.String({
      description: "Exactly one Redis command, without fences or separators.",
      minLength: 1,
    }),
    reason: Type.Optional(
      Type.String({
        description: "Optional short reason for the command suggestion.",
      })
    ),
  },
  { additionalProperties: false }
);

const SERVER_INFO_PARAMETERS = Type.Object(
  {
    section: Type.Optional(
      StringEnum(SERVER_INFO_SECTIONS, {
        description: "Which Redis INFO section to inspect.",
        default: "summary",
      })
    ),
  },
  { additionalProperties: false }
);

type GetClientContextArgs = Static<typeof GET_CLIENT_CONTEXT_PARAMETERS>;
type SearchLoadedKeysArgs = Static<typeof SEARCH_LOADED_KEYS_PARAMETERS>;
type ScanKeysArgs = Static<typeof SCAN_KEYS_PARAMETERS>;
type KeyArgs = Static<typeof KEY_PARAMETERS>;
type ReadOnlyCommandArgs = Static<typeof READ_ONLY_COMMAND_PARAMETERS>;
type SuggestCommandArgs = Static<typeof SUGGEST_COMMAND_PARAMETERS>;
type ServerInfoArgs = Static<typeof SERVER_INFO_PARAMETERS>;

function isSingleRedisCommand(command: string) {
  return !/[;\r\n]/.test(command);
}

function clampLimit(limit: number | undefined, fallback: number, max: number) {
  const normalizedLimit = Number.isFinite(limit) ? Math.round(limit as number) : fallback;
  return Math.min(Math.max(normalizedLimit, 1), max);
}

function createToolResultMessage(
  toolCall: ToolCall,
  value: unknown,
  isError = false
): ToolResultMessage {
  const text = isError
    ? String(value ?? "Unknown tool error")
    : stringifyToolResult(value);

  return {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [{ type: "text", text }],
    isError,
    timestamp: Date.now(),
  };
}

function createGlobMatcher(pattern: string) {
  const trimmedPattern = pattern.trim();

  if (!trimmedPattern) {
    return () => true;
  }

  const hasRedisGlob = /[*?\[\]]/.test(trimmedPattern);

  if (!hasRedisGlob) {
    const lowerPattern = trimmedPattern.toLowerCase();
    return (value: string) => value.toLowerCase().includes(lowerPattern);
  }

  const escapedPattern = trimmedPattern.replace(/[.+^${}()|\\]/g, "\\$&");
  const regexPattern = escapedPattern
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
    .replace(/\[/g, "[")
    .replace(/\]/g, "]");
  const matcher = new RegExp(`^${regexPattern}$`, "i");

  return (value: string) => matcher.test(value);
}

function getValueSummary(value: Awaited<ReturnType<typeof getRedisKeyValue>>["value"]) {
  if (value === null) {
    return {
      summary: "Null value.",
      itemCount: 0,
      valueKind: "null",
    };
  }

  if (typeof value === "string") {
    return {
      summary: `String with ${value.length} characters.`,
      itemCount: value.length,
      valueKind: "string",
    };
  }

  if (Array.isArray(value)) {
    const isZsetLike = value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "member" in item &&
        "score" in item
    );

    return {
      summary: `${isZsetLike ? "Sorted set" : "Collection"} with ${value.length} items.`,
      itemCount: value.length,
      valueKind: isZsetLike ? "zset" : "array",
    };
  }

  const fieldCount = Object.keys(value).length;

  return {
    summary: `Map-like value with ${fieldCount} fields.`,
    itemCount: fieldCount,
    valueKind: "object",
  };
}

function parseRedisInfoSection(output: string) {
  const result: Record<string, string> = {};

  output.split(/\r?\n/).forEach((line) => {
    if (!line || line.startsWith("#")) {
      return;
    }

    const separatorIndex = line.indexOf(":");

    if (separatorIndex === -1) {
      return;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (key) {
      result[key] = value;
    }
  });

  return result;
}

function toNumberOrNull(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function parseKeyspaceInfo(output: string) {
  const info = parseRedisInfoSection(output);

  return Object.entries(info).reduce<Record<string, Record<string, number | string>>>(
    (accumulator, [db, rawValue]) => {
      accumulator[db] = rawValue.split(",").reduce<Record<string, number | string>>(
        (dbAccumulator, part) => {
          const [key, value] = part.split("=");

          if (!key || value === undefined) {
            return dbAccumulator;
          }

          const numericValue = Number(value);
          dbAccumulator[key] = Number.isFinite(numericValue) ? numericValue : value;
          return dbAccumulator;
        },
        {}
      );
      return accumulator;
    },
    {}
  );
}

async function executeGetClientContextTool(
  request: OpenAIAssistantRequest,
  _args: GetClientContextArgs
) {
  return {
    activeConnection: request.activeConnection
      ? {
          name: request.activeConnection.name,
          host: request.activeConnection.host,
          port: request.activeConnection.port,
        }
      : null,
    selectedDb: request.selectedDb,
    selectedKey: request.selectedKey
      ? {
          key: request.selectedKey.key,
          type: request.selectedKey.type,
          ttl: request.selectedKey.ttl,
        }
      : null,
    loadedKeysCount: request.keysCount,
  };
}

async function executeSearchLoadedKeysTool(
  request: OpenAIAssistantRequest,
  args: SearchLoadedKeysArgs
) {
  const query = args.query?.trim() ?? "";
  const type = args.type ?? "any";
  const limit = clampLimit(args.limit, 20, 50);
  const normalizedQuery = query.toLowerCase();

  const matches = request.loadedKeys
    .filter((item) => {
      const matchesQuery =
        !normalizedQuery || item.key.toLowerCase().includes(normalizedQuery);
      const matchesType = type === "any" || item.type === type;

      return matchesQuery && matchesType;
    })
    .slice(0, limit)
    .map((item) => ({
      key: item.key,
      type: item.type,
      ttl: item.ttl,
    }));

  return {
    query: query || null,
    type,
    totalLoadedKeys: request.loadedKeys.length,
    matches,
  };
}

async function executeScanKeysTool(
  request: OpenAIAssistantRequest,
  args: ScanKeysArgs
) {
  const connection = requireActiveConnection(request.activeConnection);
  const pattern = args.pattern?.trim() ?? "";
  const type = args.type ?? "any";
  const limit = clampLimit(args.limit, 25, 100);
  const matcher = createGlobMatcher(pattern);
  const scanMaxKeys = Math.min(
    Math.max(limit * 8, DEFAULT_SCAN_COUNT),
    DEFAULT_SCAN_MAX_KEYS
  );

  const scannedKeys = await listRedisKeys(
    { ...connection, db: request.selectedDb },
    {
      scanCount: DEFAULT_SCAN_COUNT,
      maxKeys: scanMaxKeys,
    }
  );

  const filteredMatches = scannedKeys.filter((item) => {
    const matchesPattern = matcher(item.key);
    const matchesType = type === "any" || item.type === type;

    return matchesPattern && matchesType;
  });

  return {
    pattern: pattern || "*",
    type,
    scannedKeys: scannedKeys.length,
    returnedKeys: Math.min(filteredMatches.length, limit),
    truncated: filteredMatches.length > limit,
    matches: filteredMatches.slice(0, limit).map((item) => ({
      key: item.key,
      type: item.type,
      ttl: item.ttl,
    })),
  };
}

async function executeInspectKeyTool(
  request: OpenAIAssistantRequest,
  args: KeyArgs
) {
  const connection = requireActiveConnection(request.activeConnection);
  const value = await getRedisKeyValue(
    { ...connection, db: request.selectedDb },
    args.key.trim()
  );

  return {
    key: value.key,
    type: value.type,
    ttl: value.ttl,
    valuePreview: stringifyContextValue(value.value),
  };
}

async function executeSummarizeKeyTool(
  request: OpenAIAssistantRequest,
  args: KeyArgs
) {
  const connection = requireActiveConnection(request.activeConnection);
  const value = await getRedisKeyValue(
    { ...connection, db: request.selectedDb },
    args.key.trim()
  );
  const summary = getValueSummary(value.value);

  return {
    key: value.key,
    type: value.type,
    ttl: value.ttl,
    valueKind: summary.valueKind,
    itemCount: summary.itemCount,
    summary: summary.summary,
    preview: stringifyContextValue(value.value),
  };
}

async function executeGetServerInfoTool(
  request: OpenAIAssistantRequest,
  args: ServerInfoArgs
) {
  const connection = requireActiveConnection(request.activeConnection);
  const section = args.section ?? "summary";
  const connectionInput = { ...connection, db: request.selectedDb };

  if (section !== "summary") {
    const output = await runRedisCommand(connectionInput, `INFO ${section}`);
    const parsedSection =
      section === "keyspace"
        ? parseKeyspaceInfo(output)
        : parseRedisInfoSection(output);

    return {
      section,
      data: parsedSection,
    };
  }

  const [serverOutput, memoryOutput, statsOutput, clientsOutput, keyspaceOutput, dbsizeOutput] =
    await Promise.all([
      runRedisCommand(connectionInput, "INFO server"),
      runRedisCommand(connectionInput, "INFO memory"),
      runRedisCommand(connectionInput, "INFO stats"),
      runRedisCommand(connectionInput, "INFO clients"),
      runRedisCommand(connectionInput, "INFO keyspace"),
      runRedisCommand(connectionInput, "DBSIZE"),
    ]);

  const serverInfo = parseRedisInfoSection(serverOutput);
  const memoryInfo = parseRedisInfoSection(memoryOutput);
  const statsInfo = parseRedisInfoSection(statsOutput);
  const clientsInfo = parseRedisInfoSection(clientsOutput);
  const keyspaceInfo = parseKeyspaceInfo(keyspaceOutput);
  const keyspaceHits = toNumberOrNull(statsInfo.keyspace_hits) ?? 0;
  const keyspaceMisses = toNumberOrNull(statsInfo.keyspace_misses) ?? 0;
  const totalLookups = keyspaceHits + keyspaceMisses;

  return {
    section,
    data: {
      version: serverInfo.redis_version ?? null,
      mode: serverInfo.redis_mode ?? null,
      os: serverInfo.os ?? null,
      processId: toNumberOrNull(serverInfo.process_id),
      uptimeDays: toNumberOrNull(serverInfo.uptime_in_days),
      connectedClients: toNumberOrNull(clientsInfo.connected_clients),
      blockedClients: toNumberOrNull(clientsInfo.blocked_clients),
      usedMemory: memoryInfo.used_memory_human ?? memoryInfo.used_memory ?? null,
      peakMemory:
        memoryInfo.used_memory_peak_human ?? memoryInfo.used_memory_peak ?? null,
      maxmemory: memoryInfo.maxmemory_human ?? memoryInfo.maxmemory ?? null,
      operationsPerSecond: toNumberOrNull(statsInfo.instantaneous_ops_per_sec),
      totalConnectionsReceived: toNumberOrNull(
        statsInfo.total_connections_received
      ),
      totalCommandsProcessed: toNumberOrNull(
        statsInfo.total_commands_processed
      ),
      keyspaceHitRate:
        totalLookups > 0 ? Number((keyspaceHits / totalLookups).toFixed(4)) : null,
      dbSize: toNumberOrNull(dbsizeOutput.trim()),
      keyspace: keyspaceInfo,
    },
  };
}

async function executeRunReadOnlyCommandTool(
  request: OpenAIAssistantRequest,
  args: ReadOnlyCommandArgs
) {
  const trimmedCommand = args.command.trim();
  const commandName = getCliCommandName(trimmedCommand);
  const connection = requireActiveConnection(request.activeConnection);

  if (!trimmedCommand) {
    throw new Error("Command cannot be empty.");
  }

  if (!isSingleRedisCommand(trimmedCommand)) {
    throw new Error("Only one Redis command is allowed.");
  }

  if (!isReadOnlyRedisCommand(commandName)) {
    throw new Error(`\`${commandName}\` is not a read-only Redis command.`);
  }

  if (DISALLOWED_AI_READ_ONLY_COMMANDS.has(commandName)) {
    throw new Error(`\`${commandName}\` is disabled for AI tool execution.`);
  }

  const output = await runRedisCommand(
    { ...connection, db: request.selectedDb },
    trimmedCommand
  );

  return {
    command: trimmedCommand,
    output,
  };
}

async function executeSuggestRedisCommandTool(
  _request: OpenAIAssistantRequest,
  args: SuggestCommandArgs,
  onSuggestedCommand: (command: string) => void
) {
  const trimmedCommand = args.command.trim();

  if (!trimmedCommand) {
    throw new Error("Suggested command cannot be empty.");
  }

  if (!isSingleRedisCommand(trimmedCommand)) {
    throw new Error("Suggest exactly one Redis command.");
  }

  onSuggestedCommand(trimmedCommand);

  return {
    stored: true,
    reason: args.reason?.trim() || null,
  };
}

export function createAssistantTools(autoSuggest: boolean): Tool[] {
  const tools: Tool[] = [
    {
      name: AI_TOOL_NAMES.getClientContext,
      description:
        "Get the current NeoRDM client context including active connection, selected database, selected key, and key browser counts.",
      parameters: GET_CLIENT_CONTEXT_PARAMETERS,
    },
    {
      name: AI_TOOL_NAMES.searchLoadedKeys,
      description:
        "Search only the keys already loaded in the NeoRDM key browser by substring and optional Redis type.",
      parameters: SEARCH_LOADED_KEYS_PARAMETERS,
    },
    {
      name: AI_TOOL_NAMES.scanKeys,
      description:
        "Scan the active Redis database for live keys using an optional glob pattern and optional Redis type filter.",
      parameters: SCAN_KEYS_PARAMETERS,
    },
    {
      name: AI_TOOL_NAMES.inspectKey,
      description:
        "Fetch the latest Redis type, TTL, and a value preview for a specific key from the active database.",
      parameters: KEY_PARAMETERS,
    },
    {
      name: AI_TOOL_NAMES.summarizeKey,
      description:
        "Fetch a specific key and return a compact structural summary, TTL, and value preview.",
      parameters: KEY_PARAMETERS,
    },
    {
      name: AI_TOOL_NAMES.getServerInfo,
      description:
        "Inspect Redis server information such as version, memory, stats, clients, keyspace, and database size.",
      parameters: SERVER_INFO_PARAMETERS,
    },
    {
      name: AI_TOOL_NAMES.runReadOnlyCommand,
      description:
        "Run one read-only Redis command on the active database and return the textual result.",
      parameters: READ_ONLY_COMMAND_PARAMETERS,
    },
  ];

  if (autoSuggest) {
    tools.push({
      name: AI_TOOL_NAMES.suggestRedisCommand,
      description:
        "Store exactly one Redis command suggestion so the UI can show it without executing it.",
      parameters: SUGGEST_COMMAND_PARAMETERS,
    });
  }

  return tools;
}

export async function executeAssistantToolCall({
  request,
  tools,
  toolCall,
  onSuggestedCommand,
}: {
  request: OpenAIAssistantRequest;
  tools: Tool[];
  toolCall: ToolCall;
  onSuggestedCommand: (command: string) => void;
}): Promise<ToolResultMessage> {
  try {
    const validatedArgs = validateToolCall(tools, toolCall);
    let result: unknown;

    switch (toolCall.name) {
      case AI_TOOL_NAMES.getClientContext:
        result = await executeGetClientContextTool(
          request,
          validatedArgs as GetClientContextArgs
        );
        break;
      case AI_TOOL_NAMES.searchLoadedKeys:
        result = await executeSearchLoadedKeysTool(
          request,
          validatedArgs as SearchLoadedKeysArgs
        );
        break;
      case AI_TOOL_NAMES.scanKeys:
        result = await executeScanKeysTool(request, validatedArgs as ScanKeysArgs);
        break;
      case AI_TOOL_NAMES.inspectKey:
        result = await executeInspectKeyTool(request, validatedArgs as KeyArgs);
        break;
      case AI_TOOL_NAMES.summarizeKey:
        result = await executeSummarizeKeyTool(request, validatedArgs as KeyArgs);
        break;
      case AI_TOOL_NAMES.getServerInfo:
        result = await executeGetServerInfoTool(
          request,
          validatedArgs as ServerInfoArgs
        );
        break;
      case AI_TOOL_NAMES.runReadOnlyCommand:
        result = await executeRunReadOnlyCommandTool(
          request,
          validatedArgs as ReadOnlyCommandArgs
        );
        break;
      case AI_TOOL_NAMES.suggestRedisCommand:
        result = await executeSuggestRedisCommandTool(
          request,
          validatedArgs as SuggestCommandArgs,
          onSuggestedCommand
        );
        break;
      default:
        throw new Error(`Unknown AI tool: ${toolCall.name}`);
    }

    return createToolResultMessage(toolCall, result);
  } catch (error) {
    return createToolResultMessage(
      toolCall,
      error instanceof Error ? error.message : String(error ?? "Unknown tool error"),
      true
    );
  }
}
