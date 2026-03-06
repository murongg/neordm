import { useState } from "react";
import type { ThemeMode } from "../hooks/useTheme";
import {
  X,
  Sliders,
  Palette,
  Bot,
  Terminal,
  Keyboard,
  Shield,
  ChevronRight,
  Check,
  Eye,
  EyeOff,
  RotateCcw,
} from "lucide-react";
import { useI18n, type Locale } from "../i18n";

interface SettingsPanelProps {
  onClose: () => void;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

type SettingsCategory =
  | "general"
  | "appearance"
  | "editor"
  | "ai"
  | "cli"
  | "shortcuts"
  | "privacy";

const CATEGORIES: {
  id: SettingsCategory;
  icon: React.ReactNode;
}[] = [
  { id: "general", icon: <Sliders size={14} /> },
  { id: "appearance", icon: <Palette size={14} /> },
  { id: "editor", icon: <ChevronRight size={14} /> },
  { id: "ai", icon: <Bot size={14} /> },
  { id: "cli", icon: <Terminal size={14} /> },
  { id: "shortcuts", icon: <Keyboard size={14} /> },
  { id: "privacy", icon: <Shield size={14} /> },
];

export function SettingsPanel({ onClose, themeMode, onThemeChange }: SettingsPanelProps) {
  const { messages } = useI18n();
  const [category, setCategory] = useState<SettingsCategory>("general");
  const categoryLabels = messages.settings.categories;
  const categories = CATEGORIES.map((item) => ({
    ...item,
    label: categoryLabels[item.id],
  }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-base-200 rounded-2xl w-full max-w-3xl mx-4 h-[600px] shadow-2xl border border-base-content/10 flex overflow-hidden">
        {/* Left nav */}
        <nav className="w-48 bg-base-300 flex flex-col shrink-0">
          <div className="px-4 pt-5 pb-3 border-b border-base-content/10">
            <h2 className="text-xs font-mono font-semibold text-base-content/50 uppercase tracking-widest">
              {messages.common.settings}
            </h2>
          </div>
          <ul className="flex-1 py-2 overflow-y-auto">
            {categories.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => setCategory(c.id)}
                  className={`
                    w-full flex items-center gap-2.5 px-4 py-2 text-xs font-mono cursor-pointer
                    transition-colors duration-150 text-left
                    ${
                      category === c.id
                        ? "bg-success/10 text-success"
                        : "text-base-content/50 hover:bg-base-content/5 hover:text-base-content"
                    }
                  `}
                >
                  <span className={category === c.id ? "text-success" : "text-base-content/30"}>
                    {c.icon}
                  </span>
                  {c.label}
                  {category === c.id && (
                    <span className="ml-auto w-1 h-4 rounded-full bg-success" />
                  )}
                </button>
              </li>
            ))}
          </ul>
          <div className="p-3 border-t border-base-content/10">
            <p className="text-[10px] font-mono text-base-content/20 text-center">
              NeoRDM v0.1.0
            </p>
          </div>
        </nav>

        {/* Right content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-base-content/10 shrink-0">
            <h3 className="text-sm font-mono font-semibold">
              {categories.find((c) => c.id === category)?.label}
            </h3>
            <button
              onClick={onClose}
              className="btn btn-ghost btn-xs btn-circle cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {category === "general" && <GeneralSettings />}
            {category === "appearance" && <AppearanceSettings themeMode={themeMode} onThemeChange={onThemeChange} />}
            {category === "editor" && <EditorSettings />}
            {category === "ai" && <AISettings />}
            {category === "cli" && <CLISettings />}
            {category === "shortcuts" && <ShortcutsSettings />}
            {category === "privacy" && <PrivacySettings />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Setting primitives ──────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <h4 className="text-[10px] font-mono font-semibold text-base-content/40 uppercase tracking-widest mb-3">
        {title}
      </h4>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-base-300/50 transition-colors duration-150 group">
      <div className="flex-1 min-w-0 mr-4">
        <p className="text-xs font-mono text-base-content/80">{label}</p>
        {description && (
          <p className="text-[10px] text-base-content/40 mt-0.5">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="toggle toggle-xs toggle-success cursor-pointer"
    />
  );
}

function SelectInput({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="select select-xs bg-base-300 border-base-content/10 font-mono text-xs cursor-pointer min-w-32"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ─── Category panels ─────────────────────────────────────────────────────────

function GeneralSettings() {
  const { locale, localeOptions, setLocale, messages } = useI18n();
  const general = messages.settings.general;
  const [autoConnect, setAutoConnect] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(true);
  const [keySeparator, setKeySeparator] = useState(":");
  const [maxKeys, setMaxKeys] = useState("10000");
  const [scanCount, setScanCount] = useState("200");

  return (
    <>
      <Section title={general.startup}>
        <Row
          label={general.autoConnect}
          description={general.autoConnectDescription}
        >
          <Toggle checked={autoConnect} onChange={setAutoConnect} />
        </Row>
        <Row label={general.language}>
          <SelectInput
            value={locale}
            onChange={(value) => setLocale(value as Locale)}
            options={localeOptions}
          />
        </Row>
      </Section>

      <Section title={general.keyBrowser}>
        <Row
          label={general.keySeparator}
          description={general.keySeparatorDescription}
        >
          <input
            type="text"
            value={keySeparator}
            onChange={(e) => setKeySeparator(e.target.value)}
            className="input input-xs w-16 bg-base-300 border-base-content/10 font-mono text-center user-select-text"
          />
        </Row>
        <Row label={general.maxKeys} description={general.maxKeysDescription}>
          <input
            type="number"
            value={maxKeys}
            onChange={(e) => setMaxKeys(e.target.value)}
            className="input input-xs w-24 bg-base-300 border-base-content/10 font-mono text-right user-select-text"
          />
        </Row>
        <Row
          label={general.scanCount}
          description={general.scanCountDescription}
        >
          <input
            type="number"
            value={scanCount}
            onChange={(e) => setScanCount(e.target.value)}
            className="input input-xs w-24 bg-base-300 border-base-content/10 font-mono text-right user-select-text"
          />
        </Row>
      </Section>

      <Section title={general.safety}>
        <Row
          label={general.confirmDelete}
          description={general.confirmDeleteDescription}
        >
          <Toggle checked={confirmDelete} onChange={setConfirmDelete} />
        </Row>
      </Section>
    </>
  );
}

// ─── Theme Picker ────────────────────────────────────────────────────────────

function ThemePicker({ value, onChange }: { value: ThemeMode; onChange: (m: ThemeMode) => void }) {
  const { messages } = useI18n();
  const options: { mode: ThemeMode; label: string; preview: React.ReactNode }[] = [
    {
      mode: "light",
      label: messages.settings.appearance.themes.light,
      preview: (
        <svg viewBox="0 0 80 52" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
          <rect width="80" height="52" rx="4" fill="#f0f4f8" />
          <rect width="18" height="52" fill="#e2e8f0" />
          <rect x="4" y="8" width="10" height="10" rx="2" fill="#4f8ef7" fillOpacity="0.2" />
          <circle cx="9" cy="13" r="3" fill="#4f8ef7" />
          <rect x="4" y="22" width="10" height="2" rx="1" fill="#cbd5e1" />
          <rect x="4" y="26" width="8" height="2" rx="1" fill="#e2e8f0" />
          <rect x="4" y="30" width="10" height="2" rx="1" fill="#cbd5e1" />
          <rect x="4" y="34" width="7" height="2" rx="1" fill="#e2e8f0" />
          <rect x="22" y="6" width="34" height="6" rx="2" fill="#e2e8f0" />
          <rect x="22" y="16" width="50" height="3" rx="1" fill="#e2e8f0" />
          <rect x="22" y="21" width="44" height="3" rx="1" fill="#e2e8f0" />
          <rect x="22" y="26" width="48" height="3" rx="1" fill="#e2e8f0" />
          <rect x="22" y="6" width="10" height="6" rx="2" fill="#4f8ef7" />
        </svg>
      ),
    },
    {
      mode: "dark",
      label: messages.settings.appearance.themes.dark,
      preview: (
        <svg viewBox="0 0 80 52" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
          <rect width="80" height="52" rx="4" fill="#0f172a" />
          <rect width="18" height="52" fill="#1e293b" />
          <rect x="4" y="8" width="10" height="10" rx="2" fill="#22c55e" fillOpacity="0.2" />
          <circle cx="9" cy="13" r="3" fill="#22c55e" />
          <rect x="4" y="22" width="10" height="2" rx="1" fill="#334155" />
          <rect x="4" y="26" width="8" height="2" rx="1" fill="#1e293b" />
          <rect x="4" y="30" width="10" height="2" rx="1" fill="#334155" />
          <rect x="4" y="34" width="7" height="2" rx="1" fill="#1e293b" />
          <rect x="22" y="6" width="34" height="6" rx="2" fill="#1e293b" />
          <rect x="22" y="16" width="50" height="3" rx="1" fill="#1e293b" />
          <rect x="22" y="21" width="44" height="3" rx="1" fill="#1e293b" />
          <rect x="22" y="26" width="48" height="3" rx="1" fill="#1e293b" />
          <rect x="22" y="6" width="10" height="6" rx="2" fill="#22c55e" />
        </svg>
      ),
    },
    {
      mode: "system",
      label: messages.settings.appearance.themes.system,
      preview: (
        <svg viewBox="0 0 80 52" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
          <defs>
            <clipPath id="cp-light"><polygon points="0,0 80,0 0,52" /></clipPath>
            <clipPath id="cp-dark"><polygon points="80,0 80,52 0,52" /></clipPath>
          </defs>
          <g clipPath="url(#cp-light)">
            <rect width="80" height="52" rx="4" fill="#f0f4f8" />
            <rect width="18" height="52" fill="#e2e8f0" />
            <rect x="4" y="8" width="10" height="10" rx="2" fill="#4f8ef7" fillOpacity="0.2" />
            <circle cx="9" cy="13" r="3" fill="#4f8ef7" />
            <rect x="22" y="6" width="34" height="6" rx="2" fill="#e2e8f0" />
            <rect x="22" y="16" width="50" height="3" rx="1" fill="#e2e8f0" />
            <rect x="22" y="21" width="44" height="3" rx="1" fill="#e2e8f0" />
          </g>
          <g clipPath="url(#cp-dark)">
            <rect width="80" height="52" rx="4" fill="#0f172a" />
            <rect width="18" height="52" fill="#1e293b" />
            <rect x="4" y="8" width="10" height="10" rx="2" fill="#22c55e" fillOpacity="0.2" />
            <circle cx="9" cy="13" r="3" fill="#22c55e" />
            <rect x="22" y="6" width="34" height="6" rx="2" fill="#1e293b" />
            <rect x="22" y="16" width="50" height="3" rx="1" fill="#1e293b" />
            <rect x="22" y="21" width="44" height="3" rx="1" fill="#1e293b" />
          </g>
          <line x1="80" y1="0" x2="0" y2="52" stroke="#475569" strokeWidth="0.75" />
        </svg>
      ),
    },
  ];

  return (
    <div className="flex gap-3">
      {options.map(({ mode, label, preview }) => {
        const active = value === mode;
        return (
          <button
            key={mode}
            onClick={() => onChange(mode)}
            className={`
              flex-1 flex flex-col cursor-pointer rounded-xl overflow-hidden
              border-2 transition-all duration-200
              ${active ? "border-success shadow-lg shadow-success/10" : "border-base-content/10 hover:border-base-content/25"}
            `}
          >
            <div className="w-full aspect-[80/52] overflow-hidden bg-base-300">
              {preview}
            </div>
            <div className={`flex items-center justify-between px-2.5 py-1.5 ${active ? "text-success" : "text-base-content/50"}`}>
              <span className="text-xs font-mono">{label}</span>
              {active && <Check size={11} />}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function AppearanceSettings({
  themeMode,
  onThemeChange,
}: {
  themeMode: ThemeMode;
  onThemeChange: (m: ThemeMode) => void;
}) {
  const { messages } = useI18n();
  const appearance = messages.settings.appearance;
  const [fontSize, setFontSize] = useState("13");
  const [compactMode, setCompactMode] = useState(false);
  const [showKeyType, setShowKeyType] = useState(true);
  const [showTTL, setShowTTL] = useState(true);
  const [animationsEnabled, setAnimationsEnabled] = useState(true);

  return (
    <>
      <Section title={appearance.theme}>
        <div className="px-3 py-2">
          <ThemePicker value={themeMode} onChange={onThemeChange} />
        </div>
      </Section>

      <Section title={appearance.font}>
        <Row label={appearance.fontSize}>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="11"
              max="16"
              value={fontSize}
              onChange={(e) => setFontSize(e.target.value)}
              className="range range-xs range-success w-24 cursor-pointer"
            />
            <span className="text-xs font-mono text-base-content/50 w-6">
              {fontSize}
            </span>
          </div>
        </Row>
      </Section>

      <Section title={appearance.layout}>
        <Row
          label={appearance.compactMode}
          description={appearance.compactModeDescription}
        >
          <Toggle checked={compactMode} onChange={setCompactMode} />
        </Row>
        <Row label={appearance.showKeyType}>
          <Toggle checked={showKeyType} onChange={setShowKeyType} />
        </Row>
        <Row label={appearance.showTtl}>
          <Toggle checked={showTTL} onChange={setShowTTL} />
        </Row>
        <Row label={appearance.enableAnimations}>
          <Toggle checked={animationsEnabled} onChange={setAnimationsEnabled} />
        </Row>
      </Section>
    </>
  );
}

function EditorSettings() {
  const { messages } = useI18n();
  const editor = messages.settings.editor;
  const [autoFormat, setAutoFormat] = useState(true);
  const [wordWrap, setWordWrap] = useState(true);
  const [syntaxHighlight, setSyntaxHighlight] = useState(true);
  const [maxValueSize, setMaxValueSize] = useState("1");
  const [defaultTTL, setDefaultTTL] = useState("-1");
  const [hashDisplayMode, setHashDisplayMode] = useState("table");

  return (
    <>
      <Section title={editor.jsonString}>
        <Row
          label={editor.autoFormatJson}
          description={editor.autoFormatJsonDescription}
        >
          <Toggle checked={autoFormat} onChange={setAutoFormat} />
        </Row>
        <Row label={editor.syntaxHighlighting}>
          <Toggle checked={syntaxHighlight} onChange={setSyntaxHighlight} />
        </Row>
        <Row label={editor.wordWrap}>
          <Toggle checked={wordWrap} onChange={setWordWrap} />
        </Row>
        <Row
          label={editor.maxValueSize}
          description={editor.maxValueSizeDescription}
        >
          <input
            type="number"
            value={maxValueSize}
            min="0.1"
            max="10"
            step="0.1"
            onChange={(e) => setMaxValueSize(e.target.value)}
            className="input input-xs w-24 bg-base-300 border-base-content/10 font-mono text-right user-select-text"
          />
        </Row>
      </Section>

      <Section title={editor.defaults}>
        <Row label={editor.defaultTtl} description={editor.defaultTtlDescription}>
          <input
            type="number"
            value={defaultTTL}
            onChange={(e) => setDefaultTTL(e.target.value)}
            className="input input-xs w-24 bg-base-300 border-base-content/10 font-mono text-right user-select-text"
          />
        </Row>
        <Row label={editor.hashDisplayMode}>
          <SelectInput
            value={hashDisplayMode}
            onChange={setHashDisplayMode}
            options={[
              { value: "table", label: editor.hashDisplayModes.table },
              { value: "json", label: editor.hashDisplayModes.json },
            ]}
          />
        </Row>
      </Section>
    </>
  );
}

function AISettings() {
  const { messages } = useI18n();
  const ai = messages.settings.ai;
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState("claude-sonnet-4-6");
  const [autoSuggest, setAutoSuggest] = useState(true);
  const [contextKeys, setContextKeys] = useState(true);
  const [maxTokens, setMaxTokens] = useState("2048");

  return (
    <>
      <Section title={ai.apiConfiguration}>
        <Row label={ai.apiKey}>
          <div className="flex items-center gap-1.5">
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={ai.apiKeyPlaceholder}
              className="input input-xs w-48 bg-base-300 border-base-content/10 font-mono text-xs user-select-text"
            />
            <button
              onClick={() => setShowKey((v) => !v)}
              className="btn btn-ghost btn-xs cursor-pointer"
            >
              {showKey ? <EyeOff size={11} /> : <Eye size={11} />}
            </button>
          </div>
        </Row>
        <Row label={ai.model}>
          <SelectInput
            value={model}
            onChange={setModel}
            options={[
              { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
              { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
              { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
            ]}
          />
        </Row>
        <Row label={ai.maxTokens}>
          <input
            type="number"
            value={maxTokens}
            onChange={(e) => setMaxTokens(e.target.value)}
            className="input input-xs w-24 bg-base-300 border-base-content/10 font-mono text-right user-select-text"
          />
        </Row>
      </Section>

      <Section title={ai.behavior}>
        <Row label={ai.autoSuggest} description={ai.autoSuggestDescription}>
          <Toggle checked={autoSuggest} onChange={setAutoSuggest} />
        </Row>
        <Row
          label={ai.includeKeyContext}
          description={ai.includeKeyContextDescription}
        >
          <Toggle checked={contextKeys} onChange={setContextKeys} />
        </Row>
      </Section>

      <div className="mt-2">
        <button className="btn btn-success btn-sm w-full gap-2 cursor-pointer font-mono">
          <Check size={13} /> {ai.saveApiKey}
        </button>
      </div>
    </>
  );
}

function CLISettings() {
  const { messages } = useI18n();
  const cli = messages.settings.cli;
  const [historySize, setHistorySize] = useState("500");
  const [timeout, setTimeout] = useState("30");
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [syntaxHighlight, setSyntaxHighlight] = useState(true);
  const [pipelineMode, setPipelineMode] = useState(false);

  return (
    <>
      <Section title={cli.history}>
        <Row label={cli.maxHistoryEntries}>
          <input
            type="number"
            value={historySize}
            onChange={(e) => setHistorySize(e.target.value)}
            className="input input-xs w-24 bg-base-300 border-base-content/10 font-mono text-right user-select-text"
          />
        </Row>
        <Row label={cli.showTimestamps}>
          <Toggle checked={showTimestamps} onChange={setShowTimestamps} />
        </Row>
        <Row label={cli.syntaxHighlighting}>
          <Toggle checked={syntaxHighlight} onChange={setSyntaxHighlight} />
        </Row>
      </Section>

      <Section title={cli.execution}>
        <Row label={cli.commandTimeout}>
          <input
            type="number"
            value={timeout}
            onChange={(e) => setTimeout(e.target.value)}
            className="input input-xs w-24 bg-base-300 border-base-content/10 font-mono text-right user-select-text"
          />
        </Row>
        <Row label={cli.pipelineMode} description={cli.pipelineModeDescription}>
          <Toggle checked={pipelineMode} onChange={setPipelineMode} />
        </Row>
      </Section>

      <Section title={cli.actions}>
        <Row label={cli.clearHistory} description={cli.clearHistoryDescription}>
          <button className="btn btn-ghost btn-xs gap-1.5 cursor-pointer text-base-content/50 hover:text-error">
            <RotateCcw size={11} /> {messages.common.clear}
          </button>
        </Row>
      </Section>
    </>
  );
}

function ShortcutsSettings() {
  const { messages } = useI18n();

  return (
    <>
      <Section title={messages.settings.shortcuts.title}>
        {messages.settings.shortcuts.items.map((shortcut) => (
          <Row key={shortcut.action} label={shortcut.action}>
            <div className="flex items-center gap-1">
              {shortcut.keys.map((key) => (
                <kbd key={key} className="kbd kbd-xs font-mono">
                  {key}
                </kbd>
              ))}
            </div>
          </Row>
        ))}
      </Section>
    </>
  );
}

function PrivacySettings() {
  const { messages } = useI18n();
  const privacy = messages.settings.privacy;
  const [telemetry, setTelemetry] = useState(false);
  const [crashReports, setCrashReports] = useState(false);
  const [savePasswords, setSavePasswords] = useState(true);
  const [auditLog, setAuditLog] = useState(false);

  return (
    <>
      <Section title={privacy.dataCollection}>
        <Row
          label={privacy.anonymousTelemetry}
          description={privacy.anonymousTelemetryDescription}
        >
          <Toggle checked={telemetry} onChange={setTelemetry} />
        </Row>
        <Row
          label={privacy.crashReports}
          description={privacy.crashReportsDescription}
        >
          <Toggle checked={crashReports} onChange={setCrashReports} />
        </Row>
      </Section>

      <Section title={privacy.security}>
        <Row
          label={privacy.savePasswords}
          description={privacy.savePasswordsDescription}
        >
          <Toggle checked={savePasswords} onChange={setSavePasswords} />
        </Row>
        <Row
          label={privacy.auditLog}
          description={privacy.auditLogDescription}
        >
          <Toggle checked={auditLog} onChange={setAuditLog} />
        </Row>
      </Section>

      <Section title={privacy.data}>
        <Row
          label={privacy.clearCachedData}
          description={privacy.clearCachedDataDescription}
        >
          <button className="btn btn-ghost btn-xs gap-1.5 cursor-pointer text-base-content/50 hover:text-error">
            <RotateCcw size={11} /> {messages.common.reset}
          </button>
        </Row>
      </Section>
    </>
  );
}
