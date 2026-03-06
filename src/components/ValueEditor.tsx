import { useState } from "react";
import {
  Copy,
  Trash2,
  Clock,
  Edit3,
  Check,
  X,
  Save,
  ChevronRight,
} from "lucide-react";
import type { KeyValue, ZSetMember } from "../types";
import { useI18n } from "../i18n";

interface ValueEditorProps {
  keyValue: KeyValue | null;
}

interface TtlUnits {
  second: string;
  minute: string;
  hour: string;
  day: string;
}

export function ValueEditor({ keyValue }: ValueEditorProps) {
  const { messages } = useI18n();
  const [copied, setCopied] = useState(false);
  const [editingTTL, setEditingTTL] = useState(false);
  const [ttlInput, setTtlInput] = useState("");

  if (!keyValue) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-base-content/30 gap-3">
        <div className="w-16 h-16 rounded-2xl bg-base-200 flex items-center justify-center">
          <ChevronRight size={24} />
        </div>
        <p className="text-sm font-mono">{messages.valueEditor.emptyState}</p>
      </div>
    );
  }

  const handleCopy = () => {
    const text =
      typeof keyValue.value === "string"
        ? keyValue.value
        : JSON.stringify(keyValue.value, null, 2);
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const ttlDisplay =
    keyValue.ttl === -1
      ? messages.valueEditor.noExpiry
      : keyValue.ttl === -2
      ? messages.valueEditor.expired
      : formatTTLFull(keyValue.ttl, messages.units.full);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-4 py-3 border-b border-base-200/50 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`badge badge-xs font-mono uppercase tracking-wider ${TYPE_BADGE[keyValue.type]}`}
              >
                {keyValue.type}
              </span>
              {keyValue.ttl > 0 && (
                <span className="badge badge-xs badge-warning font-mono">
                  {messages.valueEditor.ttlBadge}{" "}
                  {formatTTL(keyValue.ttl, messages.units.compact)}
                </span>
              )}
              {keyValue.ttl === -1 && (
                <span className="badge badge-xs badge-ghost font-mono">
                  {messages.valueEditor.persistent}
                </span>
              )}
            </div>
            <h2 className="text-sm font-mono font-semibold text-base-content truncate">
              {keyValue.key}
            </h2>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={handleCopy}
              className="btn btn-ghost btn-xs gap-1 cursor-pointer"
              aria-label={messages.valueEditor.copyValue}
            >
              {copied ? (
                <Check size={12} className="text-success" />
              ) : (
                <Copy size={12} />
              )}
            </button>
            <button
              className="btn btn-ghost btn-xs cursor-pointer text-error hover:bg-error/10"
              aria-label={messages.valueEditor.deleteKey}
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-2">
          <Clock size={11} className="text-base-content/40" />
          {editingTTL ? (
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={ttlInput}
                onChange={(e) => setTtlInput(e.target.value)}
                className="input input-xs w-24 font-mono bg-base-200 user-select-text"
                placeholder={messages.valueEditor.ttlInputPlaceholder}
                autoFocus
              />
              <button
                className="btn btn-ghost btn-xs text-success cursor-pointer"
                onClick={() => setEditingTTL(false)}
              >
                <Save size={11} />
              </button>
              <button
                className="btn btn-ghost btn-xs cursor-pointer"
                onClick={() => setEditingTTL(false)}
              >
                <X size={11} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setTtlInput(String(keyValue.ttl > 0 ? keyValue.ttl : ""));
                setEditingTTL(true);
              }}
              className="text-xs font-mono text-base-content/50 hover:text-base-content cursor-pointer flex items-center gap-1 transition-colors duration-150"
            >
              {ttlDisplay}
              <Edit3 size={9} className="opacity-0 group-hover:opacity-100" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {keyValue.type === "string" && (
          <StringViewer value={keyValue.value as string} />
        )}
        {keyValue.type === "hash" && (
          <HashViewer value={keyValue.value as Record<string, string>} />
        )}
        {keyValue.type === "list" && (
          <ListViewer value={keyValue.value as string[]} />
        )}
        {keyValue.type === "set" && (
          <SetViewer value={keyValue.value as string[]} />
        )}
        {keyValue.type === "zset" && (
          <ZSetViewer value={keyValue.value as ZSetMember[]} />
        )}
      </div>
    </div>
  );
}

function StringViewer({ value }: { value: string }) {
  const { messages } = useI18n();
  const [isEditing, setIsEditing] = useState(false);
  const [editVal, setEditVal] = useState(value);

  let formatted = value;
  let isJson = false;
  try {
    formatted = JSON.stringify(JSON.parse(value), null, 2);
    isJson = true;
  } catch {}

  if (isEditing) {
    return (
      <div className="flex flex-col gap-2 h-full">
        <textarea
          value={editVal}
          onChange={(e) => setEditVal(e.target.value)}
          className="textarea textarea-bordered flex-1 font-mono text-xs bg-base-200 resize-none user-select-text"
          autoFocus
        />
        <div className="flex gap-2">
          <button
            onClick={() => setIsEditing(false)}
            className="btn btn-success btn-sm gap-1.5 cursor-pointer"
          >
            <Save size={13} /> {messages.common.save}
          </button>
          <button
            onClick={() => setIsEditing(false)}
            className="btn btn-ghost btn-sm cursor-pointer"
          >
            {messages.common.cancel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative group">
      <button
        onClick={() => setIsEditing(true)}
        className="absolute top-2 right-2 btn btn-ghost btn-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200 cursor-pointer"
      >
        <Edit3 size={11} />
      </button>
      <pre className="text-xs font-mono bg-base-200 rounded-xl p-4 overflow-auto whitespace-pre-wrap break-all user-select-text leading-relaxed">
        {isJson ? (
          <JsonHighlight code={formatted} />
        ) : (
          <span className="text-base-content">{value}</span>
        )}
      </pre>
    </div>
  );
}

function HashViewer({ value }: { value: Record<string, string> }) {
  const { messages } = useI18n();
  const entries = Object.entries(value);

  return (
    <div className="overflow-auto rounded-xl border border-base-200/50">
      <table className="table table-xs w-full">
        <thead>
          <tr className="bg-base-200/80">
            <th className="font-mono text-base-content/50 w-8 text-center">
              {messages.valueEditor.headers.index}
            </th>
            <th className="font-mono text-base-content/50">
              {messages.valueEditor.field}
            </th>
            <th className="font-mono text-base-content/50">
              {messages.valueEditor.value}
            </th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {entries.map(([field, val], index) => (
            <tr key={field} className="hover:bg-base-200/30 group">
              <td className="font-mono text-base-content/30 text-center text-[10px]">
                {index + 1}
              </td>
              <td className="font-mono text-success text-xs">{field}</td>
              <td className="font-mono text-xs text-base-content/80 max-w-xs truncate user-select-text">
                {val}
              </td>
              <td>
                <button className="btn btn-ghost btn-xs opacity-0 group-hover:opacity-100 cursor-pointer">
                  <Edit3 size={10} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ListViewer({ value }: { value: string[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      {value.map((item, index) => (
        <div
          key={index}
          className="flex items-start gap-3 p-2.5 rounded-lg bg-base-200/50 hover:bg-base-200 transition-colors duration-150 group"
        >
          <span className="text-[10px] font-mono text-base-content/30 mt-0.5 w-5 text-right shrink-0">
            {index}
          </span>
          <span className="text-xs font-mono text-base-content/80 flex-1 min-w-0 break-all user-select-text">
            {item}
          </span>
          <button className="btn btn-ghost btn-xs opacity-0 group-hover:opacity-100 cursor-pointer shrink-0">
            <Edit3 size={10} />
          </button>
        </div>
      ))}
    </div>
  );
}

function SetViewer({ value }: { value: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {value.map((item, index) => (
        <div
          key={index}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-base-200 hover:bg-base-200/80 transition-colors duration-150 group cursor-default"
        >
          <span className="text-xs font-mono text-base-content/80 user-select-text">
            {item}
          </span>
          <button className="btn btn-ghost btn-xs opacity-0 group-hover:opacity-100 cursor-pointer p-0 w-4 h-4 min-h-0">
            <X size={9} />
          </button>
        </div>
      ))}
    </div>
  );
}

function ZSetViewer({ value }: { value: ZSetMember[] }) {
  const { messages } = useI18n();

  return (
    <div className="overflow-auto rounded-xl border border-base-200/50">
      <table className="table table-xs w-full">
        <thead>
          <tr className="bg-base-200/80">
            <th className="font-mono text-base-content/50 w-8 text-center">
              {messages.valueEditor.rank}
            </th>
            <th className="font-mono text-base-content/50">
              {messages.valueEditor.member}
            </th>
            <th className="font-mono text-base-content/50 text-right">
              {messages.valueEditor.score}
            </th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {value.map((item, index) => (
            <tr key={item.member} className="hover:bg-base-200/30 group">
              <td className="font-mono text-center">
                <span
                  className={`badge badge-xs font-mono ${
                    index === 0
                      ? "badge-warning"
                      : index === 1
                      ? "badge-ghost"
                      : "badge-ghost opacity-50"
                  }`}
                >
                  #{index + 1}
                </span>
              </td>
              <td className="font-mono text-xs text-base-content/80 user-select-text">
                {item.member}
              </td>
              <td className="font-mono text-xs text-success text-right">
                {item.score.toLocaleString()}
              </td>
              <td>
                <button className="btn btn-ghost btn-xs opacity-0 group-hover:opacity-100 cursor-pointer">
                  <Edit3 size={10} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JsonHighlight({ code }: { code: string }) {
  const highlighted = code.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          return `<span style="color:#86efac">${match}</span>`;
        }
        return `<span style="color:#93c5fd">${match}</span>`;
      }
      if (/true|false/.test(match)) {
        return `<span style="color:#fcd34d">${match}</span>`;
      }
      if (/null/.test(match)) {
        return `<span style="color:#f87171">${match}</span>`;
      }
      return `<span style="color:#c4b5fd">${match}</span>`;
    }
  );

  return <span dangerouslySetInnerHTML={{ __html: highlighted }} />;
}

const TYPE_BADGE: Record<string, string> = {
  string: "badge-info",
  hash: "badge-secondary",
  list: "badge-accent",
  set: "badge-warning",
  zset: "badge-error",
  stream: "badge-primary",
  json: "badge-success",
};

function formatTTL(ttl: number, units: TtlUnits): string {
  if (ttl < 60) return `${ttl}${units.second}`;
  if (ttl < 3600) return `${Math.floor(ttl / 60)}${units.minute}`;
  if (ttl < 86400) return `${Math.floor(ttl / 3600)}${units.hour}`;
  return `${Math.floor(ttl / 86400)}${units.day}`;
}

function formatTTLFull(ttl: number, units: TtlUnits): string {
  if (ttl < 60) return `${ttl} ${units.second}`;
  if (ttl < 3600) return `${Math.floor(ttl / 60)} ${units.minute}`;
  if (ttl < 86400) return `${Math.floor(ttl / 3600)} ${units.hour}`;
  return `${Math.floor(ttl / 86400)} ${units.day}`;
}
