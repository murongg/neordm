import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

export interface JsonCodeEditorProps {
  value: string;
  onChange: (nextValue: string) => void;
  className?: string;
  surfaceClassName?: string;
  autoFocus?: boolean;
  mode?: "json" | "text";
  wordWrap?: boolean;
  syntaxHighlightingEnabled?: boolean;
}

const jsonEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    color: "oklch(var(--bc) / 0.88)",
    fontFamily: "var(--font-heading)",
    fontSize: "12px",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "inherit",
    lineHeight: "1.7",
    scrollbarGutter: "stable both-edges",
  },
  ".cm-content": {
    minHeight: "100%",
    padding: "12px 12px 20px 0",
    caretColor: "oklch(var(--bc))",
  },
  ".cm-line": {
    padding: 0,
  },
  ".cm-gutters": {
    minHeight: "100%",
    borderRight: "1px solid oklch(var(--bc) / 0.08)",
    backgroundColor: "color-mix(in oklab, var(--color-base-300) 25%, transparent)",
    color: "oklch(var(--bc) / 0.28)",
  },
  ".cm-gutterElement": {
    minWidth: "32px",
    padding: "0 8px",
    fontFamily: "inherit",
    fontSize: "10px",
    lineHeight: "1.7",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in oklab, var(--color-primary) 8%, transparent)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--color-primary)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "oklch(var(--bc))",
  },
  ".cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in oklab, var(--color-primary) 20%, transparent)",
  },
});

const jsonSyntaxTheme = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.propertyName, color: "var(--color-primary)" },
    { tag: t.string, color: "oklch(var(--bc) / 0.84)" },
    { tag: [t.number, t.bool], color: "var(--color-success)" },
    { tag: t.null, color: "var(--color-error)" },
    {
      tag: [t.separator, t.brace, t.squareBracket],
      color: "oklch(var(--bc) / 0.34)",
    },
  ])
);

export default function JsonCodeEditor({
  value,
  onChange,
  className = "h-[18rem]",
  surfaceClassName = "bg-base-200",
  autoFocus = false,
  mode = "json",
  wordWrap = true,
  syntaxHighlightingEnabled = true,
}: JsonCodeEditorProps) {
  const extensions = useMemo(
    () => {
      const nextExtensions = [jsonEditorTheme];

      if (wordWrap) {
        nextExtensions.push(EditorView.lineWrapping);
      }

      if (mode === "json") {
        nextExtensions.unshift(json());

        if (syntaxHighlightingEnabled) {
          nextExtensions.push(jsonSyntaxTheme);
        }
      }

      return nextExtensions;
    },
    [mode, syntaxHighlightingEnabled, wordWrap]
  );

  return (
    <div
      className={`neordm-json-editor relative w-full overflow-hidden rounded-xl border border-base-content/10 focus-within:border-primary/35 ${surfaceClassName} ${className}`}
    >
      <CodeMirror
        className="h-full"
        value={value}
        height="100%"
        theme="none"
        extensions={extensions}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          foldGutter: false,
          dropCursor: false,
          allowMultipleSelections: false,
          autocompletion: false,
          highlightSelectionMatches: false,
          searchKeymap: false,
          completionKeymap: false,
          lintKeymap: false,
          tabSize: 2,
        }}
        indentWithTab
        autoFocus={autoFocus}
        onChange={(nextValue) => onChange(nextValue)}
      />
    </div>
  );
}
