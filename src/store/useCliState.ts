import { useCallback, useState } from "react";
import { getRedisErrorMessage, runRedisCommand } from "../lib/redis";
import {
  getBuiltinCliOutput,
  getCliCommandName,
  getCliPromptLabel,
  isBuiltinCliCommand,
  isReadOnlyRedisCommand,
} from "../lib/redisCli";
import {
  recordAuditEvent,
  recordCrashReport,
  recordTelemetryEvent,
} from "../lib/privacyRuntime";
import type { AppSettings } from "../lib/appSettings";
import type { CliEntry, RedisConnection } from "../types";

function createCliEntry(
  type: CliEntry["type"],
  content: string,
  promptLabel?: string
): CliEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    content,
    timestamp: new Date(),
    promptLabel,
  };
}

function parsePositiveInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

interface UseCliStateOptions {
  activeConnection?: RedisConnection;
  cliSettings: AppSettings["cli"];
  notConnectedMessage: string;
  onRefreshKeys: () => Promise<void>;
  onSelectDb: (db: number) => void | Promise<void>;
  onSyncConnectionStatus: (
    connectionId: string,
    status: RedisConnection["status"],
    db?: number
  ) => void;
  selectedDb: number;
}

export function useCliState({
  activeConnection,
  cliSettings,
  notConnectedMessage,
  onRefreshKeys,
  onSelectDb,
  onSyncConnectionStatus,
  selectedDb,
}: UseCliStateOptions) {
  const [cliHistory, setCliHistory] = useState<CliEntry[]>([]);

  const clearCliHistory = useCallback(() => {
    setCliHistory([]);
  }, []);

  const runCliCommand = useCallback(
    async (cmd: string) => {
      const trimmed = cmd.trim();

      if (!trimmed) return;

      const historyLimit = parsePositiveInt(cliSettings.historySize, 500);
      const timeoutMs = parsePositiveInt(cliSettings.timeout, 30) * 1000;
      const pipelineEnabled = cliSettings.pipelineMode;
      const commands =
        pipelineEnabled && trimmed.includes(";")
          ? trimmed
              .split(";")
              .map((part) => part.trim())
              .filter(Boolean)
          : [trimmed];

      const promptLabel = getCliPromptLabel(activeConnection, selectedDb);
      const appendCliEntry = (entry: CliEntry) => {
        setCliHistory((previous) => [...previous, entry].slice(-historyLimit));
      };

      const runWithTimeout = async <T,>(promise: Promise<T>) => {
        if (timeoutMs <= 0) {
          return promise;
        }

        return new Promise<T>((resolve, reject) => {
          const timer = window.setTimeout(() => {
            reject(new Error(`CLI command timed out after ${timeoutMs / 1000}s`));
          }, timeoutMs);

          void promise.then(
            (value) => {
              window.clearTimeout(timer);
              resolve(value);
            },
            (error) => {
              window.clearTimeout(timer);
              reject(error);
            }
          );
        });
      };

      for (const currentCommand of commands) {
        const commandName = getCliCommandName(currentCommand);
        void recordTelemetryEvent("cli.command");
        void recordAuditEvent("cli.command", {
          command: commandName,
          connection: activeConnection?.name ?? null,
          db: selectedDb,
        });

        if (commandName === "CLEAR") {
          clearCliHistory();
          continue;
        }

        appendCliEntry(createCliEntry("command", currentCommand, promptLabel));

        if (isBuiltinCliCommand(commandName)) {
          appendCliEntry(createCliEntry("output", getBuiltinCliOutput(commandName)));
          continue;
        }

        if (!activeConnection) {
          appendCliEntry(createCliEntry("error", notConnectedMessage));
          return;
        }

        try {
          const output = await runWithTimeout(
            runRedisCommand(
              { ...activeConnection, db: selectedDb },
              currentCommand
            )
          );

          appendCliEntry(createCliEntry("output", output));

          if (commandName === "SELECT") {
            const nextDb = Number(currentCommand.trim().split(/\s+/)[1]);

            if (Number.isInteger(nextDb) && nextDb >= 0) {
              void onSelectDb(nextDb);
              continue;
            }
          }

          onSyncConnectionStatus(activeConnection.id, "connected", selectedDb);

          if (!isReadOnlyRedisCommand(commandName)) {
            void onRefreshKeys();
          }
        } catch (error) {
          void recordCrashReport(`cli.${commandName.toLowerCase()}`, error);
          appendCliEntry(createCliEntry("error", getRedisErrorMessage(error)));
          onSyncConnectionStatus(activeConnection.id, "error", selectedDb);
        }
      }
    },
    [
      activeConnection,
      clearCliHistory,
      cliSettings.historySize,
      cliSettings.pipelineMode,
      cliSettings.timeout,
      notConnectedMessage,
      onRefreshKeys,
      onSelectDb,
      onSyncConnectionStatus,
      selectedDb,
    ]
  );

  return {
    clearCliHistory,
    cliHistory,
    runCliCommand,
  };
}
