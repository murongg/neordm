import { Suspense, lazy } from "react";
import { getRedisErrorMessage } from "../../lib/redis";
import type { JsonCodeEditorProps } from "../JsonCodeEditor";

const LazyJsonCodeEditor = lazy(() => import("../JsonCodeEditor"));

export interface TtlUnits {
  second: string;
  minute: string;
  hour: string;
  day: string;
}

export interface EditorRuntimeSettings {
  autoFormatJson: boolean;
  wordWrap: boolean;
  syntaxHighlighting: boolean;
  maxValueSize: string;
  defaultTtl: string;
  hashDisplayMode: "table" | "json";
}

export function replaceTemplate(
  template: string,
  values: Record<string, string | number>
) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key)
      ? String(values[key])
      : `{${key}}`
  );
}

export function JsonCodeEditor({
  value,
  onChange,
  className = "h-[18rem]",
  surfaceClassName = "bg-base-200",
  autoFocus = false,
  mode = "json",
  wordWrap = true,
  syntaxHighlightingEnabled = true,
}: {
  value: string;
  onChange: (nextValue: string) => void;
  className?: string;
  surfaceClassName?: string;
  autoFocus?: boolean;
  mode?: "json" | "text";
  wordWrap?: boolean;
  syntaxHighlightingEnabled?: boolean;
}) {
  return (
    <Suspense
      fallback={
        <JsonCodeEditorFallback
          value={value}
          onChange={onChange}
          className={className}
          surfaceClassName={surfaceClassName}
          autoFocus={autoFocus}
          mode={mode}
          wordWrap={wordWrap}
        />
      }
    >
      <LazyJsonCodeEditor
        value={value}
        onChange={onChange}
        className={className}
        surfaceClassName={surfaceClassName}
        autoFocus={autoFocus}
        mode={mode}
        wordWrap={wordWrap}
        syntaxHighlightingEnabled={syntaxHighlightingEnabled}
      />
    </Suspense>
  );
}

function JsonCodeEditorFallback({
  value,
  onChange,
  className = "h-[18rem]",
  surfaceClassName = "bg-base-200",
  autoFocus = false,
  wordWrap = true,
}: JsonCodeEditorProps) {
  return (
    <div className={`relative w-full overflow-visible rounded-xl ${className}`}>
      <div
        className={`h-full overflow-hidden rounded-xl border border-base-content/10 ${surfaceClassName}`}
      >
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`textarea h-full w-full resize-none overflow-auto border-0 bg-transparent px-3 py-3 font-mono text-xs leading-relaxed outline-none user-select-text ${
            wordWrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"
          }`}
          spellCheck={false}
          autoFocus={autoFocus}
        />
      </div>
    </div>
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function JsonHighlight({ code }: { code: string }) {
  const highlighted = escapeHtml(code).replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match: string) => {
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          return `<span style="color:var(--neordm-syntax-key)">${match}</span>`;
        }
        return `<span style="color:var(--neordm-syntax-string)">${match}</span>`;
      }
      if (/true|false/.test(match)) {
        return `<span style="color:var(--neordm-syntax-number)">${match}</span>`;
      }
      if (/null/.test(match)) {
        return `<span style="color:var(--neordm-syntax-null)">${match}</span>`;
      }
      return `<span style="color:var(--neordm-syntax-number)">${match}</span>`;
    }
  );

  return (
    <span
      style={{ color: "oklch(var(--bc) / 0.34)" }}
      dangerouslySetInnerHTML={{ __html: highlighted }}
    />
  );
}

export const TYPE_BADGE: Record<string, string> = {
  string: "badge-info",
  hash: "badge-secondary",
  list: "badge-accent",
  set: "badge-warning",
  zset: "badge-error",
  stream: "badge-primary",
  json: "badge-primary",
};

export function formatTTL(ttl: number, units: TtlUnits): string {
  if (ttl < 60) return `${ttl}${units.second}`;
  if (ttl < 3600) return `${Math.floor(ttl / 60)}${units.minute}`;
  if (ttl < 86400) return `${Math.floor(ttl / 3600)}${units.hour}`;
  return `${Math.floor(ttl / 86400)}${units.day}`;
}

export function formatTTLFull(ttl: number, units: TtlUnits): string {
  if (ttl < 60) return `${ttl} ${units.second}`;
  if (ttl < 3600) return `${Math.floor(ttl / 60)} ${units.minute}`;
  if (ttl < 86400) return `${Math.floor(ttl / 3600)} ${units.hour}`;
  return `${Math.floor(ttl / 86400)} ${units.day}`;
}

export function formatJsonDraft(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export function parseMaxValueSizeBytes(value: string) {
  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1024 * 1024;
  }

  return Math.max(1, Math.round(parsed * 1024 * 1024));
}

export function estimateTextSize(value: string) {
  return new TextEncoder().encode(value).length;
}

export function truncateTextByBytes(value: string, maxBytes: number) {
  if (estimateTextSize(value) <= maxBytes) {
    return value;
  }

  const encoder = new TextEncoder();
  let end = value.length;

  while (
    end > 0 &&
    encoder.encode(`${value.slice(0, end)}…`).length > maxBytes
  ) {
    end -= 1;
  }

  return `${value.slice(0, end)}…`;
}

export function compactJsonDraft(value: string) {
  try {
    return JSON.stringify(JSON.parse(value));
  } catch {
    return value;
  }
}

export function getJsonDraftError(value: string) {
  try {
    JSON.parse(value);
    return "";
  } catch (error) {
    return getRedisErrorMessage(error);
  }
}

export function isStructuredJsonText(value: string) {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}
