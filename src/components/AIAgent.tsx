import {
  Children,
  isValidElement,
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  Bot,
  Send,
  Sparkles,
  Terminal,
  User,
  Copy,
  Check,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  Square,
} from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  AiAssistantEvent,
  AiToolEvent,
  ChatMessage,
  PendingAiCommandConfirmation,
} from "../types";
import { useI18n } from "../i18n";
import { DataTable } from "./DataTable";
import { useToast } from "./ToastProvider";

type MarkdownTableCell = ReactElement<{ children?: ReactNode }>;

type ProcessBlock =
  | {
      id: string;
      kind: "thinking";
      detail: string;
      status: "running" | "completed";
      timestamp: number;
      order: number;
    }
  | {
      id: string;
      kind: "toolcall";
      detail: string;
      status: "running" | "completed";
      timestamp: number;
      order: number;
    }
  | {
      id: string;
      kind: "tool";
      toolName: string;
      detail?: string;
      status: AiToolEvent["status"];
      timestamp: number;
      order: number;
    }
  | {
      id: string;
      kind: "error";
      detail: string;
      timestamp: number;
      order: number;
    };

interface AIAgentProps {
  messages: ChatMessage[];
  isResponding: boolean;
  activeToolName?: string | null;
  activeToolEvents?: AiToolEvent[];
  activeAssistantEvents?: AiAssistantEvent[];
  pendingCommandConfirmation?: PendingAiCommandConfirmation | null;
  onApproveCommand?: () => void;
  onRejectCommand?: () => void;
  onSend: (msg: string) => void | Promise<void>;
  onStop?: () => void;
}

export function AIAgent({
  messages,
  isResponding,
  activeToolName,
  activeToolEvents = [],
  activeAssistantEvents = [],
  pendingCommandConfirmation,
  onApproveCommand,
  onRejectCommand,
  onSend,
  onStop,
}: AIAgentProps) {
  const { messages: i18nMessages } = useI18n();
  const { showToast } = useToast();
  const [input, setInput] = useState("");
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messageStreamRef = useRef<HTMLDivElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const autoScrollPinnedRef = useRef(true);
  const lastAutoScrollAtRef = useRef(0);
  const deferredActiveAssistantEvents = useDeferredValue(activeAssistantEvents);
  const deferredActiveToolEvents = useDeferredValue(activeToolEvents);
  const deferredActiveToolName = useDeferredValue(activeToolName);
  const lastAssistantEvent =
    deferredActiveAssistantEvents[deferredActiveAssistantEvents.length - 1];
  const lastToolEvent = deferredActiveToolEvents[deferredActiveToolEvents.length - 1];

  const updateAutoScrollPinned = useCallback(() => {
    const container = scrollContainerRef.current;

    if (!container) {
      return;
    }

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    autoScrollPinnedRef.current = distanceFromBottom < 80;
  }, []);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;

    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, []);

  const scheduleScrollToBottom = useCallback((force = false) => {
    if (scrollFrameRef.current !== null) {
      return;
    }

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const container = scrollContainerRef.current;

      if (!container) {
        return;
      }

      const now = window.performance.now();
      const shouldThrottle =
        now - lastAutoScrollAtRef.current < 120 && isResponding;

      if ((!autoScrollPinnedRef.current && !force) || shouldThrottle) {
        return;
      }

      lastAutoScrollAtRef.current = now;
      scrollToBottom();
    });
  }, [isResponding, scrollToBottom]);

  useEffect(() => {
    scheduleScrollToBottom();
  }, [
    isResponding,
    lastAssistantEvent?.detail,
    lastAssistantEvent?.id,
    lastToolEvent?.detail,
    lastToolEvent?.id,
    messages.length,
    scheduleScrollToBottom,
  ]);

  useLayoutEffect(() => {
    scheduleScrollToBottom(true);
  }, []);

  useEffect(() => {
    const messageStream = messageStreamRef.current;

    if (!messageStream || typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      scheduleScrollToBottom();
    });

    resizeObserver.observe(messageStream);

    return () => {
      resizeObserver.disconnect();
    };
  }, [scheduleScrollToBottom]);

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, []);

  const sendMessage = useCallback(
    (content: string) => {
      const trimmed = content.trim();

      if (!trimmed || isResponding) {
        return;
      }

      autoScrollPinnedRef.current = true;
      scheduleScrollToBottom(true);
      onSend(trimmed);
    },
    [isResponding, onSend, scheduleScrollToBottom]
  );

  const handleSend = useCallback(() => {
    if (!input.trim() || isResponding) return;
    sendMessage(input);
    setInput("");
  }, [input, isResponding, sendMessage]);

  const handleCopyCmd = useCallback((cmd: string) => {
    void navigator.clipboard.writeText(cmd).then(() => {
      setCopiedCmd(cmd);
      showToast({
        message: i18nMessages.common.copied,
        tone: "success",
      });
      window.setTimeout(() => setCopiedCmd(null), 2000);
    });
  }, [i18nMessages.common.copied, showToast]);

  const renderedMessages = useMemo(
    () =>
      messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          copiedCmd={copiedCmd}
          onCopyCmd={handleCopyCmd}
        />
      )),
    [copiedCmd, handleCopyCmd, messages]
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-base-200/50 shrink-0 flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center">
          <Bot size={14} className="text-primary" />
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
      <div
        ref={scrollContainerRef}
        onScroll={updateAutoScrollPinned}
        className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3"
      >
        <div ref={messageStreamRef} className="flex flex-col gap-3">
          {renderedMessages}
          {isResponding && (
            <ThinkingBubble
              activeToolName={deferredActiveToolName}
              toolEvents={deferredActiveToolEvents}
              assistantEvents={deferredActiveAssistantEvents}
            />
          )}
        </div>
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
                disabled={isResponding}
                onClick={() => sendMessage(s)}
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
        <div className="relative">
          {pendingCommandConfirmation && (
            <div className="pointer-events-auto absolute inset-x-0 bottom-full z-20 mb-2 rounded-xl border border-warning/20 bg-warning/8 px-3 py-3 shadow-lg shadow-base-300/30 backdrop-blur-sm">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-wide text-warning/85">
                      {i18nMessages.cli.confirmDangerousCommand}
                    </div>
                    <div className="mt-1 text-[11px] leading-5 text-base-content/58">
                      {i18nMessages.cli.confirmDangerousDescription}
                    </div>
                  </div>
                  {pendingCommandConfirmation.reason && (
                    <div className="rounded-lg bg-base-300/55 px-2.5 py-2 text-[11px] leading-5 text-base-content/55">
                      {pendingCommandConfirmation.reason}
                    </div>
                  )}
                  <code className="block overflow-x-auto rounded-lg bg-base-300/75 px-2.5 py-2 text-[11px] text-base-content/72 user-select-text">
                    {pendingCommandConfirmation.command}
                  </code>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={onRejectCommand}
                      className="btn btn-xs btn-ghost cursor-pointer"
                    >
                      {i18nMessages.common.cancel}
                    </button>
                    <button
                      type="button"
                      onClick={onApproveCommand}
                      className="btn btn-xs btn-warning cursor-pointer"
                    >
                      {i18nMessages.cli.confirmDangerousApprove}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder={i18nMessages.ai.placeholder}
              className="input input-sm flex-1 bg-base-200 border-base-content/10 font-mono text-xs user-select-text"
              disabled={isResponding}
            />
            {isResponding ? (
              <button
                type="button"
                onClick={onStop}
                disabled={!onStop}
                className="btn btn-sm btn-ghost cursor-pointer disabled:cursor-not-allowed"
                aria-label={i18nMessages.common.cancel}
              >
                <Square size={12} />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim() || isResponding}
                className="btn btn-sm btn-primary cursor-pointer disabled:cursor-not-allowed"
                aria-label={i18nMessages.ai.send}
              >
                <Send size={13} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const ThinkingBubble = memo(function ThinkingBubble({
  activeToolName,
  toolEvents,
  assistantEvents,
}: {
  activeToolName?: string | null;
  toolEvents: AiToolEvent[];
  assistantEvents: AiAssistantEvent[];
}) {
  return (
    <div className="flex gap-2">
      <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-primary/20">
        <Bot size={11} className="text-primary" />
      </div>
      <div className="rounded-xl rounded-tl-sm bg-base-200 px-3 py-2">
        <AssistantTranscript
          events={assistantEvents}
          toolEvents={toolEvents}
          activeToolName={activeToolName}
          live
        />
      </div>
    </div>
  );
});

const MessageBubble = memo(function MessageBubble({
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
          isUser ? "bg-primary/20" : "bg-primary/12"
        }`}
      >
        {isUser ? (
          <User size={11} className="text-primary" />
        ) : (
          <Bot size={11} className="text-primary" />
        )}
      </div>

      {/* Content */}
      <div className={`max-w-[85%] flex flex-col gap-1.5 ${isUser ? "items-end" : ""}`}>
        <div
          className={`px-3 py-2 rounded-xl text-xs font-mono leading-relaxed user-select-text ${
            isUser
              ? "bg-primary/20 text-primary-content/90 rounded-tr-sm"
              : "bg-base-200 text-base-content/80 rounded-tl-sm"
          }`}
        >
          {isUser ? (
            <MessageContent content={message.content} />
          ) : (
            <AssistantTranscript
              content={message.content}
              events={message.events}
              toolEvents={message.toolEvents}
            />
          )}
        </div>

        {/* Suggested command */}
        {message.command && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-base-300 border border-primary/20">
            <Terminal size={10} className="text-primary shrink-0" />
            <code className="text-[11px] font-mono text-primary flex-1">
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
});

const AssistantTranscript = memo(function AssistantTranscript({
  content,
  events = [],
  toolEvents = [],
  activeToolName,
  live = false,
}: {
  content?: string;
  events?: AiAssistantEvent[];
  toolEvents?: AiToolEvent[];
  activeToolName?: string | null;
  live?: boolean;
}) {
  const { messages, format } = useI18n();
  const text = messages.ui.aiPanel;
  const { processBlocks, responseContent, hasThinkingBlock, hasRunningToolBlock } =
    useMemo(() => {
      const groupedBlocks = new Map<
        string,
        Extract<ProcessBlock, { kind: "thinking" | "toolcall" }>
      >();
      const standaloneBlocks: ProcessBlock[] = [];
      let latestResponseContent = "";

      events.forEach((event, index) => {
        const detail = event.detail ?? "";
        const groupedKey = parseGroupedAssistantEventKey(event);

        if (event.type === "text_delta" && detail) {
          latestResponseContent = detail;
          return;
        }

        if (event.type === "error" && detail) {
          standaloneBlocks.push({
            id: `error-${event.id}`,
            kind: "error",
            detail,
            timestamp: event.timestamp.getTime(),
            order: index,
          });
          return;
        }

        if (!groupedKey) {
          return;
        }

        const existingBlock = groupedBlocks.get(groupedKey.id);
        const baseBlock =
          existingBlock ??
          ({
            id: groupedKey.id,
            kind: groupedKey.kind,
            detail: "",
            status: "running",
            timestamp: event.timestamp.getTime(),
            order: index,
          } satisfies Extract<ProcessBlock, { kind: "thinking" | "toolcall" }>);

        if (event.type.endsWith("_delta") && detail) {
          baseBlock.detail = detail;
        }

        if (event.type.endsWith("_end")) {
          baseBlock.status = "completed";
        }

        groupedBlocks.set(groupedKey.id, baseBlock);
      });

      toolEvents.forEach((event, index) => {
        standaloneBlocks.push({
          id: `tool-${event.id}`,
          kind: "tool",
          toolName: event.toolName,
          detail: event.detail,
          status: event.status,
          timestamp: event.timestamp.getTime(),
          order: events.length + index,
        });
      });

      const blocks = [...groupedBlocks.values(), ...standaloneBlocks]
        .filter((block) => {
          if (block.kind === "thinking" || block.kind === "toolcall") {
            return block.detail.length > 0;
          }

          return true;
        })
        .sort((left, right) => {
          if (left.timestamp === right.timestamp) {
            return left.order - right.order;
          }

          return left.timestamp - right.timestamp;
        });

      return {
        processBlocks: blocks,
        responseContent: latestResponseContent || content || "",
        hasThinkingBlock: blocks.some((block) => block.kind === "thinking"),
        hasRunningToolBlock: blocks.some(
          (block) => block.kind === "tool" && block.status === "running"
        ),
      };
    }, [content, events, toolEvents]);
  const hasActiveProcess = useMemo(() => {
    return processBlocks.some((block) => {
      if (block.kind === "thinking" || block.kind === "toolcall") {
        return block.status === "running";
      }

      if (block.kind === "tool") {
        return block.status === "running";
      }

      return false;
    });
  }, [processBlocks]);
  const hasProcessError = useMemo(() => {
    return processBlocks.some((block) => {
      if (block.kind === "error") {
        return true;
      }

      return block.kind === "tool" && block.status === "error";
    });
  }, [processBlocks]);
  const [isProcessExpanded, setIsProcessExpanded] = useState(
    live || hasActiveProcess || hasProcessError
  );
  const previousHasActiveProcessRef = useRef(hasActiveProcess);

  const collapsibleBlockIds = useMemo(() => {
    return processBlocks
      .filter((block) => block.kind === "thinking" || block.kind === "toolcall")
      .map((block) => block.id);
  }, [processBlocks]);
  const latestCollapsibleBlockId =
    collapsibleBlockIds[collapsibleBlockIds.length - 1] ?? null;
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(
    latestCollapsibleBlockId
  );

  useEffect(() => {
    setExpandedBlockId(latestCollapsibleBlockId);
  }, [latestCollapsibleBlockId]);

  useEffect(() => {
    if (hasProcessError || hasActiveProcess) {
      setIsProcessExpanded(true);
    } else if (previousHasActiveProcessRef.current && !hasActiveProcess) {
      setIsProcessExpanded(false);
    }

    previousHasActiveProcessRef.current = hasActiveProcess;
  }, [hasActiveProcess, hasProcessError]);

  return (
    <div className="space-y-2">
      {live && (
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-base-content/45">
          <span className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-pulse" />
          <span className="h-1.5 w-1.5 rounded-full bg-primary/50 animate-pulse [animation-delay:120ms]" />
          <span className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-pulse [animation-delay:240ms]" />
          <span>{hasThinkingBlock ? text.thinking : text.working}</span>
        </div>
      )}

      {activeToolName && !hasRunningToolBlock && (
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-base-content/45">
          <LoaderCircle size={10} className="animate-spin text-primary/70" />
          <span>{format(text.usingTool, { toolName: activeToolName })}</span>
        </div>
      )}

      {processBlocks.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setIsProcessExpanded((previous) => !previous)}
            className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors duration-150 hover:bg-base-300/35"
            aria-expanded={isProcessExpanded}
          >
            {isProcessExpanded ? (
              <ChevronDown size={12} className="shrink-0 text-base-content/40" />
            ) : (
              <ChevronRight size={12} className="shrink-0 text-base-content/40" />
            )}
            <span className="text-[10px] font-mono uppercase tracking-wide text-base-content/30">
              {text.process}
            </span>
            <span className="text-[10px] text-base-content/35">
              {getProcessSummary(processBlocks, text, format)}
            </span>
          </button>

          {isProcessExpanded && (
            <div className="space-y-1.5">
              {processBlocks.map((block) => (
                <ProcessBlockRow
                  key={block.id}
                  block={block}
                  live={live}
                  expanded={block.id === expandedBlockId}
                  onToggle={() => {
                    if (block.kind !== "thinking" && block.kind !== "toolcall") {
                      return;
                    }

                    setExpandedBlockId((previous) =>
                      previous === block.id ? null : block.id
                    );
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {responseContent && (
        <div className={processBlocks.length > 0 ? "border-t border-base-content/8 pt-2" : undefined}>
          <div className="mb-1 text-[9px] font-mono uppercase tracking-[0.18em] text-base-content/22">
            {text.response}
          </div>
          <div>
            {live ? (
              <PlainMessageContent content={responseContent} />
            ) : (
              <MessageContent content={responseContent} />
            )}
          </div>
        </div>
      )}
    </div>
  );
});

const ProcessBlockRow = memo(function ProcessBlockRow({
  block,
  live,
  expanded,
  onToggle,
}: {
  block: ProcessBlock;
  live: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { messages } = useI18n();
  const text = messages.ui.aiPanel;
  if (block.kind === "tool") {
    const EventIcon =
      block.status === "running"
        ? LoaderCircle
        : block.status === "error"
        ? AlertCircle
        : Check;
    const toneClass =
      block.status === "running"
        ? "text-info"
        : block.status === "error"
        ? "text-error"
        : "text-success";
    const label = getToolEventLabel(block.status, text);

    return (
      <div className="flex items-start gap-2 rounded-md bg-base-300/20 px-2 py-1.5 text-[11px] leading-5">
        <EventIcon
          size={11}
          className={`mt-[3px] shrink-0 ${toneClass} ${
            block.status === "running" ? "animate-spin" : ""
          }`}
        />
        <div className="min-w-0 space-y-0.5">
          <div className={`font-mono ${toneClass}`}>
            {label} · {block.toolName}
          </div>
          {block.detail && (
            <div className="whitespace-pre-wrap break-words text-base-content/55">
              {block.detail}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (block.kind === "error") {
    return (
      <div className="rounded-md border border-error/20 bg-error/8 px-2 py-1.5">
        <div className="font-mono text-[10px] uppercase tracking-wide text-error">
          {text.failed}
        </div>
        <div className="mt-1 break-words text-[11px] leading-5 text-base-content/65">
          {block.detail}
        </div>
      </div>
    );
  }

  const detail = block.detail;
  const isThinking = block.kind === "thinking";
  const headerToneClass =
    isThinking && !expanded ? "text-base-content/35" : isThinking ? "text-secondary" : "text-info";
  const previewToneClass = isThinking
    ? "text-[11px] leading-5 text-base-content/35"
    : "text-[11px] leading-5 text-base-content/45";
  const buttonClass = isThinking
    ? expanded
      ? "bg-secondary/6 hover:bg-secondary/8"
      : "hover:bg-base-300/30"
    : expanded
    ? "bg-info/6 hover:bg-info/8"
    : "hover:bg-base-300/45";

  if (detail) {
    const ChevronIcon = expanded ? ChevronDown : ChevronRight;

    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={onToggle}
          className={`flex w-full items-start gap-2 rounded-md px-1 py-1 text-left transition-colors duration-150 ${buttonClass}`}
          aria-expanded={expanded}
        >
          <ChevronIcon
            size={12}
            className={`mt-[3px] shrink-0 ${headerToneClass}`}
          />
          <div className="min-w-0 space-y-1">
            <div className={`text-[10px] font-mono uppercase tracking-wide ${headerToneClass}`}>
              {getProcessBlockTitle(block, text)}
            </div>
            {!expanded && (
              <div className={`break-words ${previewToneClass}`}>
                {getCollapsedDeltaPreview(detail)}
              </div>
            )}
          </div>
        </button>

        {expanded && block.kind === "thinking" && (
          <div className="rounded-md border border-secondary/12 bg-secondary/6 px-3 py-2 user-select-text">
            {live ? (
              <PlainMessageContent content={detail} subtle />
            ) : (
              <MessageContent content={detail} subtle />
            )}
          </div>
        )}

        {expanded && block.kind === "toolcall" && (
          <div className="space-y-1 rounded-md border border-info/12 bg-info/6 px-3 py-2">
            <div className="font-mono text-[10px] uppercase tracking-wide text-info/70">
              {getProcessBlockTitle(block, text)}
            </div>
            <div className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-base-content/58">
              {detail}
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
});

function getCollapsedDeltaPreview(detail: string, maxLength = 140) {
  const previewSource =
    detail.length > maxLength * 4 ? detail.slice(0, maxLength * 4) : detail;
  const normalizedDetail = previewSource.replace(/\s+/g, " ").trim();

  if (normalizedDetail.length <= maxLength) {
    return normalizedDetail;
  }

  return `${normalizedDetail.slice(0, maxLength)}…`;
}

function getProcessSummary(
  processBlocks: ProcessBlock[],
  text: ReturnType<typeof useI18n>["messages"]["ui"]["aiPanel"],
  format: ReturnType<typeof useI18n>["format"]
) {
  if (processBlocks.length === 0) {
    return "";
  }

  const toolCount = processBlocks.filter((block) => block.kind === "tool").length;
  const hasThinking = processBlocks.some((block) => block.kind === "thinking");

  if (toolCount > 0 && hasThinking) {
    return format(text.stepsWithTools, {
      steps: processBlocks.length,
      tools: toolCount,
    });
  }

  if (toolCount > 0) {
    return format(text.steps, {
      count: processBlocks.length,
    });
  }

  if (hasThinking) {
    return format(text.steps, {
      count: processBlocks.length,
    });
  }

  return format(text.items, {
    count: processBlocks.length,
  });
}

function parseGroupedAssistantEventKey(event: AiAssistantEvent) {
  const match = event.id.match(
    /^(loop-\d+)-(thinking|toolcall)_(start|delta|end)-(\d+)$/
  );

  if (!match) {
    return null;
  }

  return {
    id: `${match[1]}-${match[2]}-${match[4]}`,
    kind: match[2] as "thinking" | "toolcall",
  };
}

function getProcessBlockTitle(
  block: Extract<ProcessBlock, { kind: "thinking" | "toolcall" }>,
  text: ReturnType<typeof useI18n>["messages"]["ui"]["aiPanel"]
) {
  if (block.kind === "thinking") {
    return block.status === "completed" ? text.thoughtProcess : text.thinking;
  }

  const toolName = extractToolName(block.detail);

  if (toolName) {
    return `${block.status === "completed" ? text.preparedTool : text.preparingTool} · ${toolName}`;
  }

  return block.status === "completed" ? text.preparedTool : text.preparingTool;
}

function extractToolName(detail: string) {
  const match = detail.trim().match(/^([a-zA-Z0-9_.-]+)/);
  return match?.[1] ?? null;
}

function getToolEventLabel(
  status: AiToolEvent["status"],
  text: ReturnType<typeof useI18n>["messages"]["ui"]["aiPanel"]
) {
  switch (status) {
    case "running":
      return text.runningTool;
    case "success":
      return text.toolFinished;
    case "error":
      return text.toolFailed;
    default:
      return text.completed;
  }
}

const PlainMessageContent = memo(function PlainMessageContent({
  content,
  subtle = false,
}: {
  content: string;
  subtle?: boolean;
}) {
  return (
    <div
      className={`user-select-text whitespace-pre-wrap break-words ${
        subtle ? "text-base-content/58" : "text-base-content/80"
      }`}
    >
      {content}
    </div>
  );
});

const MessageContent = memo(function MessageContent({
  content,
  subtle = false,
}: {
  content: string;
  subtle?: boolean;
}) {
  const textToneClass = subtle ? "text-base-content/58" : "text-base-content/80";
  const strongToneClass = subtle
    ? "font-semibold text-base-content/68"
    : "font-semibold text-base-content";
  const quoteToneClass = subtle
    ? "my-2 border-l-2 border-base-content/10 pl-3 text-base-content/50"
    : "my-2 border-l-2 border-primary/30 pl-3 text-base-content/60";
  const linkToneClass = subtle
    ? "text-info/80 underline decoration-base-content/20 underline-offset-2"
    : "text-primary underline decoration-primary/50 underline-offset-2";
  const inlineCodeToneClass = subtle
    ? "rounded bg-base-300/80 px-1 py-0.5 text-[11px] text-base-content/65"
    : "rounded bg-base-300 px-1 py-0.5 text-[11px] text-primary";
  const blockCodeToneClass = subtle
    ? "block overflow-x-auto rounded-lg bg-base-300/80 px-3 py-2 text-[11px] text-base-content/65"
    : "block overflow-x-auto rounded-lg bg-base-300 px-3 py-2 text-[11px] text-primary";
  const parseTableSectionRows = (sectionChildren: ReactNode) =>
    Children.toArray(sectionChildren).filter(
      (child): child is ReactElement<{ children?: ReactNode }> =>
        isValidElement(child) && child.type === "tr"
    );
  const parseTableCells = (rowChildren: ReactNode) =>
    Children.toArray(rowChildren).filter(
      (child): child is ReactElement<{ children?: ReactNode }> =>
        isValidElement(child) && (child.type === "th" || child.type === "td")
    );

  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => (
          <p className={`whitespace-pre-wrap ${textToneClass}`}>{children}</p>
        ),
        strong: ({ children }) => (
          <strong className={strongToneClass}>{children}</strong>
        ),
        em: ({ children }) => <em className={`italic ${textToneClass}`}>{children}</em>,
        ul: ({ children }) => (
          <ul className={`my-1 list-disc space-y-1 pl-4 ${textToneClass}`}>{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className={`my-1 list-decimal space-y-1 pl-4 ${textToneClass}`}>{children}</ol>
        ),
        li: ({ children }) => <li className={`pl-0.5 ${textToneClass}`}>{children}</li>,
        blockquote: ({ children }) => (
          <blockquote className={quoteToneClass}>
            {children}
          </blockquote>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className={linkToneClass}
          >
            {children}
          </a>
        ),
        code: ({ className, children }) => {
          const isBlock = Boolean(className);

          if (isBlock) {
            return (
              <code className={blockCodeToneClass}>
                {children}
              </code>
            );
          }

          return (
            <code className={inlineCodeToneClass}>
              {children}
            </code>
          );
        },
        pre: ({ children }) => (
          <pre className={`my-2 overflow-x-auto ${textToneClass}`}>{children}</pre>
        ),
        h1: ({ children }) => (
          <h1 className={`mt-1 mb-2 text-sm font-semibold ${strongToneClass}`}>
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className={`mt-1 mb-2 text-sm font-semibold ${strongToneClass}`}>
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className={`mt-1 mb-1.5 text-xs font-semibold ${strongToneClass}`}>
            {children}
          </h3>
        ),
        hr: () => <hr className="my-2 border-base-content/10" />,
        table: ({ children }) => {
          const sections = Children.toArray(children).filter(
            (child): child is ReactElement<{ children?: ReactNode }> =>
              isValidElement(child) &&
              (child.type === "thead" || child.type === "tbody")
          );
          const thead = sections.find((section) => section.type === "thead");
          const tbody = sections.find((section) => section.type === "tbody");
          const headerRow = thead
            ? parseTableSectionRows(thead.props.children)[0] ?? null
            : null;
          const headerCells = headerRow ? parseTableCells(headerRow.props.children) : [];
          const bodyRows = tbody ? parseTableSectionRows(tbody.props.children) : [];
          const rows: MarkdownTableCell[][] = bodyRows.map((row) =>
            parseTableCells(row.props.children)
          );

          if (!headerCells.length) {
            return (
              <div className="my-2 overflow-x-auto rounded-lg border border-base-content/10">
                {children}
              </div>
            );
          }

          return (
            <DataTable
              rows={rows}
              columns={headerCells.map((cell, index) => ({
                id: `markdown-col-${index}`,
                header: cell.props.children,
                headerClassName: "text-left font-semibold text-base-content",
                cellClassName: "align-top",
                renderCell: (row: MarkdownTableCell[]) => row[index]?.props.children ?? null,
              }))}
              getRowKey={(_, index) => `markdown-row-${index}`}
              size="sm"
              containerClassName="my-2 overflow-hidden rounded-lg border border-base-content/10"
              scrollAreaClassName="overflow-x-auto"
              tableClassName={`min-w-full ${textToneClass}`}
              headerRowClassName="bg-base-300/80"
            />
          );
        },
      }}
    >
      {content}
    </Markdown>
  );
});
