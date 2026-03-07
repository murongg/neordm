import * as redisCommands from "redis-commands";
import type { RedisConnection } from "../types";

export type CliBuiltinCommand = "CLEAR" | "HELP";

const BUILTIN_COMMANDS: CliBuiltinCommand[] = ["CLEAR", "HELP"];

const MODULE_COMMANDS = ["JSON.GET", "JSON.SET", "JSON.DEL", "JSON.TYPE"];

const EXTRA_READ_ONLY_COMMANDS = new Set(["JSON.GET"]);

const POPULAR_COMMANDS = [
  "PING",
  "INFO",
  "DBSIZE",
  "SCAN",
  "GET",
  "SET",
  "DEL",
  "TTL",
  "TYPE",
  "HGETALL",
  "LRANGE",
  "SMEMBERS",
  "ZRANGE",
  "XRANGE",
  "JSON.GET",
];

function dedupeCommands(commands: string[]) {
  return [...new Set(commands)];
}

export const REDIS_CLI_COMMANDS = dedupeCommands([
  ...POPULAR_COMMANDS,
  ...redisCommands.list.map((command) => command.toUpperCase()),
  ...MODULE_COMMANDS,
]);

const BUILTIN_COMMANDS_SET = new Set<string>(BUILTIN_COMMANDS);

export function getCliCommandName(command: string) {
  return command.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
}

export function isBuiltinCliCommand(commandName: string): commandName is CliBuiltinCommand {
  return BUILTIN_COMMANDS_SET.has(commandName);
}

export function getBuiltinCliOutput(commandName: CliBuiltinCommand) {
  if (commandName !== "HELP") {
    return "";
  }

  return [
    "NeoRDM Redis CLI",
    "",
    "Shortcuts:",
    "  HELP         Show this help",
    "  CLEAR        Clear CLI output",
    "  Tab          Autocomplete command",
    "  Ctrl+L       Clear CLI output",
    "  ↑ / ↓        Browse command history",
    "",
    "Examples:",
    "  PING",
    "  INFO",
    "  SCAN 0 MATCH user:* COUNT 100",
    "  HGETALL session:1",
    "  JSON.GET profile:1 $",
  ].join("\n");
}

export function isReadOnlyRedisCommand(commandName: string) {
  const normalized = commandName.toLowerCase();

  if (redisCommands.exists(normalized)) {
    return redisCommands.hasFlag(normalized, "readonly");
  }

  return EXTRA_READ_ONLY_COMMANDS.has(commandName.toUpperCase());
}

export function getCliAutocompleteSuggestions(
  input: string,
  commandHistory: string[]
) {
  const trimmed = input.trimStart();

  if (!trimmed) {
    return [];
  }

  if (/\s/.test(trimmed)) {
    return [];
  }

  const prefix = getCliCommandName(trimmed);

  if (!prefix) {
    return [];
  }

  const historyCommands = dedupeCommands(
    commandHistory.map(getCliCommandName).filter(Boolean)
  );

  return dedupeCommands([
    ...historyCommands,
    ...BUILTIN_COMMANDS,
    ...REDIS_CLI_COMMANDS,
  ])
    .filter((command) => command.startsWith(prefix) && command !== prefix)
    .slice(0, 8);
}

export function getCliPromptLabel(
  connection?: Pick<RedisConnection, "name" | "host" | "port">,
  selectedDb = 0
) {
  if (!connection) {
    return "redis>";
  }

  const connectionName = connection.name.trim();
  const defaultConnectionName = `${connection.host}:${connection.port}`;
  const baseName =
    connectionName && connectionName !== defaultConnectionName
      ? connectionName
      : connection.host;

  return `${baseName}:db${selectedDb}>`;
}
