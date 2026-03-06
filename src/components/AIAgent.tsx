import { useState, useRef, useEffect } from "react";
import { Bot, Send, Sparkles, Terminal, User, Copy, Check } from "lucide-react";
import type { ChatMessage } from "../types";
import { useI18n } from "../i18n";
import { useToast } from "./ToastProvider";

interface AIAgentProps {
  messages: ChatMessage[];
  onSend: (msg: string) => void;
}

export function AIAgent({ messages, onSend }: AIAgentProps) {
  const { messages: i18nMessages } = useI18n();
  const { showToast } = useToast();
  const [input, setInput] = useState("");
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;
    onSend(input.trim());
    setInput("");
  };

  const handleCopyCmd = (cmd: string) => {
    void navigator.clipboard.writeText(cmd).then(() => {
      setCopiedCmd(cmd);
      showToast({
        message: i18nMessages.common.copied,
        tone: "success",
      });
      window.setTimeout(() => setCopiedCmd(null), 2000);
    });
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-base-200/50 shrink-0 flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-success/20 flex items-center justify-center">
          <Bot size={14} className="text-success" />
        </div>
        <div>
          <h3 className="text-xs font-semibold font-mono">
            {i18nMessages.ai.title}
          </h3>
          <p className="text-[10px] text-base-content/40">
            {i18nMessages.ai.subtitle}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
          <span className="text-[10px] text-base-content/40">
            {i18nMessages.ai.online}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            copiedCmd={copiedCmd}
            onCopyCmd={handleCopyCmd}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Suggestions */}
      {messages.length <= 2 && (
        <div className="px-4 pb-2 shrink-0">
          <p className="text-[10px] text-base-content/30 mb-1.5 flex items-center gap-1">
            <Sparkles size={9} /> {i18nMessages.ai.quickActions}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {i18nMessages.ai.suggestions.map((s) => (
              <button
                key={s}
                onClick={() => onSend(s)}
                className="px-2.5 py-1 rounded-lg text-[10px] font-mono bg-base-200 hover:bg-base-100 text-base-content/60 hover:text-base-content transition-colors duration-150 cursor-pointer border border-base-content/5"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3 border-t border-base-200/50 shrink-0">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder={i18nMessages.ai.placeholder}
            className="input input-sm flex-1 bg-base-200 border-base-content/10 font-mono text-xs user-select-text"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="btn btn-sm btn-success cursor-pointer disabled:cursor-not-allowed"
            aria-label={i18nMessages.ai.send}
          >
            <Send size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  copiedCmd,
  onCopyCmd,
}: {
  message: ChatMessage;
  copiedCmd: string | null;
  onCopyCmd: (cmd: string) => void;
}) {
  const { localeTag, messages } = useI18n();
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-2 ${isUser ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
          isUser ? "bg-primary/20" : "bg-success/20"
        }`}
      >
        {isUser ? (
          <User size={11} className="text-primary" />
        ) : (
          <Bot size={11} className="text-success" />
        )}
      </div>

      {/* Content */}
      <div className={`max-w-[85%] flex flex-col gap-1.5 ${isUser ? "items-end" : ""}`}>
        <div
          className={`px-3 py-2 rounded-xl text-xs font-mono leading-relaxed ${
            isUser
              ? "bg-primary/20 text-primary-content/90 rounded-tr-sm"
              : "bg-base-200 text-base-content/80 rounded-tl-sm"
          }`}
        >
          <MessageContent content={message.content} />
        </div>

        {/* Suggested command */}
        {message.command && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-base-300 border border-success/20">
            <Terminal size={10} className="text-success shrink-0" />
            <code className="text-[11px] font-mono text-success flex-1">
              {message.command}
            </code>
            <button
              onClick={() => onCopyCmd(message.command!)}
              className="btn btn-ghost btn-xs w-5 h-5 p-0 cursor-pointer"
              aria-label={messages.ai.copyCommand}
            >
              {copiedCmd === message.command ? (
                <Check size={9} className="text-success" />
              ) : (
                <Copy size={9} />
              )}
            </button>
          </div>
        )}

        <span className="text-[9px] text-base-content/30 font-mono">
          {message.timestamp.toLocaleTimeString(localeTag, {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
    </div>
  );
}

function MessageContent({ content }: { content: string }) {
  // Handle markdown-style code blocks and bold
  const parts = content.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <span
              key={i}
              className="px-1 py-0.5 rounded bg-base-300 text-success text-[10px]"
            >
              {part.slice(1, -1)}
            </span>
          );
        }
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={i} className="font-semibold text-base-content">
              {part.slice(2, -2)}
            </strong>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
