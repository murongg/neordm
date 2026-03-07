import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Copy, Terminal, Trash2 } from "lucide-react";
import type { CliEntry } from "../types";
import { useI18n } from "../i18n";
import { useAppSettings } from "../hooks/useAppSettings";
import {
  getCliAutocompleteSuggestions,
  getCliCommandName,
  isDangerousRedisCommand,
} from "../lib/redisCli";

interface RedisCLIProps {
  history: CliEntry[];
  onRun: (cmd: string) => void;
  onClear: () => void;
  connectionName: string;
  promptLabel: string;
}

const CLI_EXAMPLES = [
  "PING",
  "INFO",
  "SCAN 0 MATCH * COUNT 100",
  "GET my:key",
  "HGETALL session:1",
  "JSON.GET profile:1 $",
];

function formatTimestamp(timestamp: Date) {
  return timestamp.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatHistoryLine(entry: CliEntry, showTimestamps: boolean) {
  const prefix = showTimestamps ? `[${formatTimestamp(entry.timestamp)}] ` : "";

  switch (entry.type) {
    case "command":
      return `${prefix}${entry.promptLabel ?? "redis>"} ${entry.content}`;
    case "error":
      return `${prefix}(error) ${entry.content}`;
    default:
      return `${prefix}${entry.content}`;
  }
}

export function RedisCLI({
  history,
  onRun,
  onClear,
  connectionName,
  promptLabel,
}: RedisCLIProps) {
  const { messages } = useI18n();
  const appSettings = useAppSettings();
  const [input, setInput] = useState("");
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [pendingDangerousCommand, setPendingDangerousCommand] = useState<{
    rawCommand: string;
    dangerousCommands: string[];
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const draftInputRef = useRef("");

  const cliSettings = appSettings.cli;
  const commandHistoryLimit = useMemo(() => {
    const parsed = Number.parseInt(cliSettings.historySize, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 500;
  }, [cliSettings.historySize]);
  const suggestions = useMemo(
    () => getCliAutocompleteSuggestions(input, cmdHistory),
    [cmdHistory, input]
  );
  const transcript = useMemo(
    () =>
      history
        .map((entry) => formatHistoryLine(entry, cliSettings.showTimestamps))
        .join("\n"),
    [cliSettings.showTimestamps, history]
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  const executeCommand = (cmd: string) => {
    onRun(cmd);
    setCmdHistory((prev) => [cmd, ...prev.slice(0, commandHistoryLimit - 1)]);
    setHistoryIndex(-1);
    draftInputRef.current = "";
    setInput("");
    setPendingDangerousCommand(null);
    inputRef.current?.focus();
  };

  const handleRun = () => {
    const cmd = input.trim();
    if (!cmd) return;

    if (pendingDangerousCommand?.rawCommand === cmd) {
      return;
    }

    const commands =
      cliSettings.pipelineMode && cmd.includes(";")
        ? cmd
            .split(";")
            .map((part) => part.trim())
            .filter(Boolean)
        : [cmd];
    const dangerousCommands = commands.filter((command) =>
      isDangerousRedisCommand(getCliCommandName(command))
    );

    if (dangerousCommands.length > 0) {
      setPendingDangerousCommand({
        rawCommand: cmd,
        dangerousCommands,
      });
      return;
    }

    executeCommand(cmd);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleRun();
    } else if (e.key === "Tab") {
      if (!suggestions.length) return;
      e.preventDefault();
      setInput(`${suggestions[0]} `);
      setHistoryIndex(-1);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
      e.preventDefault();
      onClear();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();

      if (!cmdHistory.length) {
        return;
      }

      if (historyIndex === -1) {
        draftInputRef.current = input;
      }

      const next = Math.min(historyIndex + 1, cmdHistory.length - 1);
      setHistoryIndex(next);
      if (cmdHistory[next]) setInput(cmdHistory[next]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();

      if (!cmdHistory.length) {
        return;
      }

      const next = Math.max(historyIndex - 1, -1);
      setHistoryIndex(next);
      setInput(next === -1 ? draftInputRef.current : cmdHistory[next]);
    }
  };

  return (
    <div
      className="flex flex-col flex-1 min-h-0 cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-base-200/50 shrink-0 flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-base-200 flex items-center justify-center">
          <Terminal size={14} className="text-base-content/60" />
        </div>
        <div>
          <h3 className="text-xs font-semibold font-mono">
            {messages.cli.title}
          </h3>
          <p className="text-[10px] text-base-content/40 font-mono">
            {connectionName}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(transcript)}
            className="btn btn-ghost btn-xs cursor-pointer"
            aria-label={messages.cli.copyHistory}
            disabled={!history.length}
          >
            <Copy size={11} />
          </button>
          <button
            type="button"
            onClick={onClear}
            className="btn btn-ghost btn-xs cursor-pointer text-base-content/40 hover:text-error"
            aria-label={messages.cli.clear}
            disabled={!history.length}
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {/* Output */}
      <div className="flex-1 overflow-y-auto px-4 py-3 font-mono text-xs flex flex-col gap-0.5">
        {history.length === 0 && (
          <div className="flex flex-wrap gap-2 pb-3">
            {CLI_EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  setInput(example);
                  inputRef.current?.focus();
                }}
                className="rounded-lg border border-base-200/70 bg-base-200/50 px-2.5 py-1 text-[10px] text-base-content/40 transition-colors hover:border-base-300 hover:text-base-content/70"
              >
                {example}
              </button>
            ))}
          </div>
        )}
        {history.map((entry) => (
          <CliLine
            key={entry.id}
            entry={entry}
            showTimestamps={cliSettings.showTimestamps}
            syntaxHighlighting={cliSettings.syntaxHighlighting}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-base-200/50 shrink-0">
        <div className="mb-2 h-6">
          {suggestions.length > 0 && (
            <div className="flex h-6 items-center gap-1.5 overflow-x-auto">
              {suggestions.map((suggestion, index) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    setInput(`${suggestion} `);
                    inputRef.current?.focus();
                  }}
                  className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-mono transition-colors ${
                    index === 0
                      ? "border-success/40 bg-success/10 text-success"
                      : "border-base-200/70 bg-base-200/40 text-base-content/45 hover:text-base-content/70"
                  }`}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="relative">
          {pendingDangerousCommand && (
            <div className="pointer-events-auto absolute inset-x-0 bottom-full z-20 mb-2 rounded-xl border border-warning/20 bg-warning/8 px-3 py-3 shadow-lg shadow-base-300/30 backdrop-blur-sm">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-wide text-warning/85">
                      {messages.cli.confirmDangerousCommand}
                    </div>
                    <div className="mt-1 text-[11px] leading-5 text-base-content/58">
                      {messages.cli.confirmDangerousDescription}
                    </div>
                  </div>
                  <div className="space-y-1">
                    {pendingDangerousCommand.dangerousCommands.map((command) => (
                      <code
                        key={command}
                        className="block overflow-x-auto rounded-lg bg-base-300/75 px-2.5 py-2 text-[11px] text-base-content/72 user-select-text"
                      >
                        {command}
                      </code>
                    ))}
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setPendingDangerousCommand(null);
                        inputRef.current?.focus();
                      }}
                      className="btn btn-xs btn-ghost cursor-pointer"
                    >
                      {messages.common.cancel}
                    </button>
                    <button
                      type="button"
                      onClick={() => executeCommand(pendingDangerousCommand.rawCommand)}
                      className="btn btn-xs btn-warning cursor-pointer"
                    >
                      {messages.cli.confirmDangerousApprove}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <span className="min-w-0 truncate font-mono text-[11px] text-success">
              {promptLabel}
            </span>
            <kbd className="shrink-0 kbd kbd-xs text-base-content/30">Enter</kbd>
          </div>
          <div className="flex items-center gap-2 bg-base-200 rounded-xl px-3 py-2">
            <span className="shrink-0 text-success">›</span>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (pendingDangerousCommand) {
                  setPendingDangerousCommand(null);
                }
              }}
              onKeyDown={handleKeyDown}
              placeholder={messages.cli.placeholder}
              className="flex-1 bg-transparent outline-none font-mono text-xs text-base-content user-select-text caret-success"
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
            />
          </div>
        </div>
        <p className="text-[9px] text-base-content/20 mt-1.5 font-mono">
          {messages.cli.hint}
        </p>
      </div>
    </div>
  );
}

function CliTimestamp({ entry }: { entry: CliEntry }) {
  return (
    <span className="shrink-0 font-mono text-[10px] text-base-content/25">
      [{formatTimestamp(entry.timestamp)}]
    </span>
  );
}

function CliCommandText({
  content,
  syntaxHighlighting,
}: {
  content: string;
  syntaxHighlighting: boolean;
}) {
  if (!syntaxHighlighting) {
    return <span className="text-base-content font-mono">{content}</span>;
  }

  const [commandName, ...argumentsList] = content.split(/\s+/);

  return (
    <span className="font-mono">
      <span className="text-info">{commandName}</span>
      {argumentsList.length > 0 ? (
        <>
          {" "}
          <span className="text-base-content/75">
            {argumentsList.join(" ")}
          </span>
        </>
      ) : null}
    </span>
  );
}

function CliLine({
  entry,
  showTimestamps,
  syntaxHighlighting,
}: {
  entry: CliEntry;
  showTimestamps: boolean;
  syntaxHighlighting: boolean;
}) {
  if (entry.type === "command") {
    return (
      <div className="flex items-start gap-2 py-0.5">
        {showTimestamps ? <CliTimestamp entry={entry} /> : null}
        <span className="shrink-0 font-mono text-success">
          {entry.promptLabel ?? "redis>"}
        </span>
        <CliCommandText
          content={entry.content}
          syntaxHighlighting={syntaxHighlighting}
        />
      </div>
    );
  }
  if (entry.type === "error") {
    return (
      <div className="flex items-start gap-2 py-0.5">
        {showTimestamps ? <CliTimestamp entry={entry} /> : null}
        <div className="text-error font-mono pl-4">{entry.content}</div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 py-0.5">
      {showTimestamps ? <CliTimestamp entry={entry} /> : null}
      <div className="text-base-content/60 font-mono pl-4 whitespace-pre-wrap">
        {entry.content}
      </div>
    </div>
  );
}
