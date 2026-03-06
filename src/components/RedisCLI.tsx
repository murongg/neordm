import { useState, useRef, useEffect } from "react";
import { Terminal, ChevronRight, Trash2, Copy } from "lucide-react";
import type { CliEntry } from "../types";

interface RedisCLIProps {
  history: CliEntry[];
  onRun: (cmd: string) => void;
  connectionName: string;
}

export function RedisCLI({ history, onRun, connectionName }: RedisCLIProps) {
  const [input, setInput] = useState("");
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  const handleRun = () => {
    const cmd = input.trim();
    if (!cmd) return;
    onRun(cmd);
    setCmdHistory((prev) => [cmd, ...prev.slice(0, 49)]);
    setHistoryIndex(-1);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleRun();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(historyIndex + 1, cmdHistory.length - 1);
      setHistoryIndex(next);
      if (cmdHistory[next]) setInput(cmdHistory[next]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.max(historyIndex - 1, -1);
      setHistoryIndex(next);
      setInput(next === -1 ? "" : cmdHistory[next]);
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
          <h3 className="text-xs font-semibold font-mono">Redis CLI</h3>
          <p className="text-[10px] text-base-content/40 font-mono">
            {connectionName}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => navigator.clipboard.writeText(history.map(e => e.content).join('\n'))}
            className="btn btn-ghost btn-xs cursor-pointer"
            aria-label="Copy history"
          >
            <Copy size={11} />
          </button>
          <button
            className="btn btn-ghost btn-xs cursor-pointer text-base-content/40 hover:text-error"
            aria-label="Clear"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {/* Output */}
      <div className="flex-1 overflow-y-auto px-4 py-3 font-mono text-xs flex flex-col gap-0.5">
        {history.map((entry) => (
          <CliLine key={entry.id} entry={entry} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-base-200/50 shrink-0">
        <div className="flex items-center gap-2 bg-base-200 rounded-xl px-3 py-2">
          <ChevronRight size={13} className="text-success shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a Redis command..."
            className="flex-1 bg-transparent outline-none font-mono text-xs text-base-content user-select-text caret-success"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
          />
          <kbd className="kbd kbd-xs text-base-content/30">Enter</kbd>
        </div>
        <p className="text-[9px] text-base-content/20 mt-1.5 font-mono">
          ↑↓ history · Tab autocomplete · Ctrl+L clear
        </p>
      </div>
    </div>
  );
}

function CliLine({ entry }: { entry: CliEntry }) {
  if (entry.type === "command") {
    return (
      <div className="flex items-start gap-2 py-0.5">
        <span className="text-success shrink-0">›</span>
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
