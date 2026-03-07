import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal, Trash2, Copy } from "lucide-react";
import type { CliEntry } from "../types";
import { useI18n } from "../i18n";
import { getCliAutocompleteSuggestions } from "../lib/redisCli";

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

function formatHistoryLine(entry: CliEntry) {
  switch (entry.type) {
    case "command":
      return `${entry.promptLabel ?? "redis>"} ${entry.content}`;
    case "error":
      return `(error) ${entry.content}`;
    default:
      return entry.content;
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
  const [input, setInput] = useState("");
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const draftInputRef = useRef("");

  const suggestions = useMemo(
    () => getCliAutocompleteSuggestions(input, cmdHistory),
    [cmdHistory, input]
  );
  const transcript = useMemo(
    () => history.map(formatHistoryLine).join("\n"),
    [history]
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  const handleRun = () => {
    const cmd = input.trim();
    if (!cmd) return;
    onRun(cmd);
    setCmdHistory((prev) => [cmd, ...prev.slice(0, 49)]);
    setHistoryIndex(-1);
    draftInputRef.current = "";
    setInput("");
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
          <CliLine key={entry.id} entry={entry} />
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
        {/* <div className="mb-1.5 flex items-center justify-between gap-3">
          <span className="min-w-0 truncate font-mono text-[11px] text-success">
            {promptLabel}
          </span>
          <kbd className="shrink-0 kbd kbd-xs text-base-content/30">Enter</kbd>
        </div> */}
        <div className="flex items-center gap-2 bg-base-200 rounded-xl px-3 py-2">
          <span className="shrink-0 text-success">›</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={messages.cli.placeholder}
            className="flex-1 bg-transparent outline-none font-mono text-xs text-base-content user-select-text caret-success"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
          />
        </div>
        <p className="text-[9px] text-base-content/20 mt-1.5 font-mono">
          {messages.cli.hint}
        </p>
      </div>
    </div>
  );
}

function CliLine({ entry }: { entry: CliEntry }) {
  if (entry.type === "command") {
    return (
      <div className="flex items-start gap-2 py-0.5">
        <span className="shrink-0 font-mono text-success">
          {entry.promptLabel ?? "redis>"}
        </span>
        <span className="text-base-content font-mono">{entry.content}</span>
      </div>
    );
  }
  if (entry.type === "error") {
    return (
      <div className="text-error font-mono pl-4 py-0.5">{entry.content}</div>
    );
  }
  return (
    <div className="text-base-content/60 font-mono pl-4 py-0.5 whitespace-pre-wrap">
      {entry.content}
    </div>
  );
}
