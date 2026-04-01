export const MAX_CONTEXT_MESSAGES = 24;
export const MAX_VALUE_PREVIEW_LENGTH = 2000;
export const MAX_TOOL_OUTPUT_LENGTH = 4000;
export const MAX_TOOL_LOOP_ITERATIONS = 24;
export const DEFAULT_SCAN_COUNT = 200;
export const DEFAULT_SCAN_MAX_KEYS = 1000;

export const COMMAND_PREFIX_PATTERN = /^\s*COMMAND:\s*(.+)$/im;

export const DISALLOWED_AI_READ_ONLY_COMMANDS = new Set([
  "KEYS",
  "MONITOR",
  "SUBSCRIBE",
  "PSUBSCRIBE",
  "SSUBSCRIBE",
  "SYNC",
  "PSYNC",
]);

export const DISALLOWED_AI_EXECUTION_COMMANDS = new Set([
  ...DISALLOWED_AI_READ_ONLY_COMMANDS,
  "ASKING",
  "AUTH",
  "DISCARD",
  "EXEC",
  "HELLO",
  "MULTI",
  "QUIT",
  "READONLY",
  "READWRITE",
  "RESET",
  "SELECT",
  "UNWATCH",
  "WATCH",
]);

export const AI_TOOL_NAMES = {
  getClientContext: "getClientContext",
  searchLoadedKeys: "searchLoadedKeys",
  scanKeys: "scanKeys",
  inspectKey: "inspectKey",
  summarizeKey: "summarizeKey",
  getServerInfo: "getServerInfo",
  runRedisCommand: "runRedisCommand",
  runReadOnlyCommand: "runReadOnlyCommand",
  runLuaScript: "runLuaScript",
  suggestRedisCommand: "suggestRedisCommand",
} as const;
