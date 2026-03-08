import { Suspense, lazy, useCallback, useEffect, useState } from "react";
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
  RotateCcw,
} from "lucide-react";
import { useI18n, type Locale } from "../i18n";
import { useModalTransition } from "../hooks/useModalTransition";
import {
  DEFAULT_APP_SETTINGS,
  loadAppSettings,
  subscribeAppSettings,
  updateAppSettings,
  type AppSettings,
} from "../lib/appSettings";
import { clearPrivacyRuntimeData } from "../lib/privacyRuntime";
import { useCliStore } from "../store/useCliState";
import { useToast } from "./ToastProvider";

interface SettingsPanelProps {
  onClose: () => void;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  keySeparator: string;
  onKeySeparatorChange: (separator: string) => void;
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

const LazySettingsAISection = lazy(async () => ({
  default: (await import("./SettingsAISection")).SettingsAISection,
}));

function AISettingsFallback() {
  return <div className="h-24 rounded-xl bg-base-300/40" />;
}

export function SettingsPanel({
  onClose,
  themeMode,
  onThemeChange,
  keySeparator,
  onKeySeparatorChange,
}: SettingsPanelProps) {
  const { messages } = useI18n();
  const { isVisible, requestClose, handleBackdropClick } =
    useModalTransition(onClose);
  const [category, setCategory] = useState<SettingsCategory>("general");
  const categoryLabels = messages.settings.categories;
  const categories = CATEGORIES.map((item) => ({
    ...item,
    label: categoryLabels[item.id],
  }));

  return (
    <div
      onClick={handleBackdropClick}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity duration-200 ease-out motion-reduce:transition-none ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        className={`bg-base-200 rounded-2xl w-full max-w-3xl mx-4 h-[600px] shadow-2xl border border-base-content/10 flex overflow-hidden transition-all duration-200 ease-out motion-reduce:transition-none ${
          isVisible
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-3 scale-[0.985] opacity-0"
        }`}
      >
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
              onClick={requestClose}
              className="btn btn-ghost btn-xs btn-circle cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {category === "general" && (
              <GeneralSettings
                keySeparator={keySeparator}
                onKeySeparatorChange={onKeySeparatorChange}
              />
            )}
            {category === "appearance" && <AppearanceSettings themeMode={themeMode} onThemeChange={onThemeChange} />}
            {category === "editor" && <EditorSettings />}
            {category === "ai" && (
              <Suspense fallback={<AISettingsFallback />}>
                <LazySettingsAISection />
              </Suspense>
            )}
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

function useAppSettingsSection<K extends keyof AppSettings>(sectionKey: K) {
  const [section, setSection] = useState<AppSettings[K]>(
    DEFAULT_APP_SETTINGS[sectionKey]
  );

  useEffect(() => {
    let isMounted = true;
    const unsubscribe = subscribeAppSettings((settings) => {
      if (!isMounted) {
        return;
      }

      setSection(settings[sectionKey]);
    });

    void loadAppSettings().then((settings) => {
      if (!isMounted) {
        return;
      }

      setSection(settings[sectionKey]);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [sectionKey]);

  const setPersistedSection = useCallback(
    (
      nextValue:
        | AppSettings[K]
        | ((previous: AppSettings[K]) => AppSettings[K])
    ) => {
      setSection((previous) => {
        const resolvedValue =
          typeof nextValue === "function"
            ? (nextValue as (previous: AppSettings[K]) => AppSettings[K])(
                previous
              )
            : nextValue;

        void updateAppSettings((current) => ({
          ...current,
          [sectionKey]:
            typeof nextValue === "function"
              ? (nextValue as (previous: AppSettings[K]) => AppSettings[K])(
                  current[sectionKey]
                )
              : nextValue,
        }));

        return resolvedValue;
      });
    },
    [sectionKey]
  );

  return [section, setPersistedSection] as const;
}

// ─── Category panels ─────────────────────────────────────────────────────────

function GeneralSettings({
  keySeparator,
  onKeySeparatorChange,
}: {
  keySeparator: string;
  onKeySeparatorChange: (separator: string) => void;
}) {
  const { locale, localeOptions, setLocale, messages } = useI18n();
  const general = messages.settings.general;
  const [generalSettings, setGeneralSettings] = useAppSettingsSection("general");

  return (
    <>
      <Section title={general.startup}>
        <Row
          label={general.autoConnect}
          description={general.autoConnectDescription}
        >
          <Toggle
            checked={generalSettings.autoConnect}
            onChange={(nextValue) =>
              setGeneralSettings((previous) => ({
                ...previous,
                autoConnect: nextValue,
              }))
            }
          />
        </Row>
        <Row label={general.language}>
          <SelectInput
            value={locale}
            onChange={(value) => {
              const nextLocale = value as Locale;
              void setLocale(nextLocale);
              setGeneralSettings((previous) => ({
                ...previous,
                locale: nextLocale,
              }));
            }}
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
            onChange={(e) => {
              const nextValue = e.target.value;
              onKeySeparatorChange(nextValue);
              setGeneralSettings((previous) => ({
                ...previous,
                keySeparator: nextValue,
              }));
            }}
            className="input input-xs w-16 bg-base-300 border-base-content/10 font-mono text-center user-select-text"
          />
        </Row>
        <Row label={general.maxKeys} description={general.maxKeysDescription}>
          <input
            type="number"
            value={generalSettings.maxKeys}
            onChange={(e) =>
              setGeneralSettings((previous) => ({
                ...previous,
                maxKeys: e.target.value,
              }))
            }
            className="input input-xs w-24 bg-base-300 border-base-content/10 font-mono text-right user-select-text"
          />
        </Row>
        <Row
          label={general.scanCount}
          description={general.scanCountDescription}
        >
          <input
            type="number"
            value={generalSettings.scanCount}
            onChange={(e) =>
              setGeneralSettings((previous) => ({
                ...previous,
                scanCount: e.target.value,
              }))
            }
            className="input input-xs w-24 bg-base-300 border-base-content/10 font-mono text-right user-select-text"
          />
        </Row>
      </Section>

      <Section title={general.safety}>
        <Row
          label={general.confirmDelete}
          description={general.confirmDeleteDescription}
        >
          <Toggle
            checked={generalSettings.confirmDelete}
            onChange={(nextValue) =>
              setGeneralSettings((previous) => ({
                ...previous,
                confirmDelete: nextValue,
              }))
            }
          />
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
          <rect x="4" y="8" width="10" height="10" rx="2" fill="#059669" fillOpacity="0.2" />
          <circle cx="9" cy="13" r="3" fill="#059669" />
          <rect x="4" y="22" width="10" height="2" rx="1" fill="#cbd5e1" />
          <rect x="4" y="26" width="8" height="2" rx="1" fill="#e2e8f0" />
          <rect x="4" y="30" width="10" height="2" rx="1" fill="#cbd5e1" />
          <rect x="4" y="34" width="7" height="2" rx="1" fill="#e2e8f0" />
          <rect x="22" y="6" width="34" height="6" rx="2" fill="#e2e8f0" />
          <rect x="22" y="16" width="50" height="3" rx="1" fill="#e2e8f0" />
          <rect x="22" y="21" width="44" height="3" rx="1" fill="#e2e8f0" />
          <rect x="22" y="26" width="48" height="3" rx="1" fill="#e2e8f0" />
          <rect x="22" y="6" width="10" height="6" rx="2" fill="#059669" />
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
  const [appearanceSettings, setAppearanceSettings] =
    useAppSettingsSection("appearance");

  return (
    <>
      <Section title={appearance.theme}>
        <div className="px-3 py-2">
          <ThemePicker
            value={themeMode}
            onChange={(nextMode) => {
              onThemeChange(nextMode);
              setAppearanceSettings((previous) => ({
                ...previous,
                themeMode: nextMode,
              }));
            }}
          />
        </div>
      </Section>

      <Section title={appearance.font}>
        <Row label={appearance.fontSize}>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="11"
              max="16"
              value={appearanceSettings.fontSize}
              onChange={(e) =>
                setAppearanceSettings((previous) => ({
                  ...previous,
                  fontSize: e.target.value,
                }))
              }
              className="range range-xs range-success w-24 cursor-pointer"
            />
            <span className="text-xs font-mono text-base-content/50 w-6">
              {appearanceSettings.fontSize}
            </span>
          </div>
        </Row>
      </Section>

      <Section title={appearance.layout}>
        <Row
          label={appearance.compactMode}
          description={appearance.compactModeDescription}
        >
          <Toggle
            checked={appearanceSettings.compactMode}
            onChange={(nextValue) =>
              setAppearanceSettings((previous) => ({
                ...previous,
                compactMode: nextValue,
              }))
            }
          />
        </Row>
        <Row label={appearance.showKeyType}>
          <Toggle
            checked={appearanceSettings.showKeyType}
            onChange={(nextValue) =>
              setAppearanceSettings((previous) => ({
                ...previous,
                showKeyType: nextValue,
              }))
            }
          />
        </Row>
        <Row label={appearance.showTtl}>
          <Toggle
            checked={appearanceSettings.showTtl}
            onChange={(nextValue) =>
              setAppearanceSettings((previous) => ({
                ...previous,
                showTtl: nextValue,
              }))
            }
          />
        </Row>
        <Row label={appearance.enableAnimations}>
          <Toggle
            checked={appearanceSettings.animationsEnabled}
            onChange={(nextValue) =>
              setAppearanceSettings((previous) => ({
                ...previous,
                animationsEnabled: nextValue,
              }))
            }
          />
        </Row>
      </Section>
    </>
  );
}

function EditorSettings() {
  const { messages } = useI18n();
  const editor = messages.settings.editor;
  const [editorSettings, setEditorSettings] = useAppSettingsSection("editor");

  return (
    <>
      <Section title={editor.jsonString}>
        <Row
          label={editor.autoFormatJson}
          description={editor.autoFormatJsonDescription}
        >
          <Toggle
            checked={editorSettings.autoFormatJson}
            onChange={(nextValue) =>
              setEditorSettings((previous) => ({
                ...previous,
                autoFormatJson: nextValue,
              }))
            }
          />
        </Row>
        <Row label={editor.syntaxHighlighting}>
          <Toggle
            checked={editorSettings.syntaxHighlighting}
            onChange={(nextValue) =>
              setEditorSettings((previous) => ({
                ...previous,
                syntaxHighlighting: nextValue,
              }))
            }
          />
        </Row>
        <Row label={editor.wordWrap}>
          <Toggle
            checked={editorSettings.wordWrap}
            onChange={(nextValue) =>
              setEditorSettings((previous) => ({
                ...previous,
                wordWrap: nextValue,
              }))
            }
          />
        </Row>
        <Row
          label={editor.maxValueSize}
          description={editor.maxValueSizeDescription}
        >
          <input
            type="number"
            value={editorSettings.maxValueSize}
            min="0.1"
            max="10"
            step="0.1"
            onChange={(e) =>
              setEditorSettings((previous) => ({
                ...previous,
                maxValueSize: e.target.value,
              }))
            }
            className="input input-xs w-24 bg-base-300 border-base-content/10 font-mono text-right user-select-text"
          />
        </Row>
      </Section>

      <Section title={editor.defaults}>
        <Row label={editor.defaultTtl} description={editor.defaultTtlDescription}>
          <input
            type="number"
            value={editorSettings.defaultTtl}
            onChange={(e) =>
              setEditorSettings((previous) => ({
                ...previous,
                defaultTtl: e.target.value,
              }))
            }
            className="input input-xs w-24 bg-base-300 border-base-content/10 font-mono text-right user-select-text"
          />
        </Row>
        <Row label={editor.hashDisplayMode}>
          <SelectInput
            value={editorSettings.hashDisplayMode}
            onChange={(value) =>
              setEditorSettings((previous) => ({
                ...previous,
                hashDisplayMode: value as AppSettings["editor"]["hashDisplayMode"],
              }))
            }
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

function CLISettings() {
  const { messages } = useI18n();
  const { showToast } = useToast();
  const cli = messages.settings.cli;
  const [cliSettings, setCliSettings] = useAppSettingsSection("cli");
  const clearCliHistory = useCliStore((state) => state.clearCliHistory);

  return (
    <>
      <Section title={cli.history}>
        <Row label={cli.maxHistoryEntries}>
          <input
            type="number"
            value={cliSettings.historySize}
            onChange={(e) =>
              setCliSettings((previous) => ({
                ...previous,
                historySize: e.target.value,
              }))
            }
            className="input input-xs w-24 bg-base-300 border-base-content/10 font-mono text-right user-select-text"
          />
        </Row>
        <Row label={cli.showTimestamps}>
          <Toggle
            checked={cliSettings.showTimestamps}
            onChange={(nextValue) =>
              setCliSettings((previous) => ({
                ...previous,
                showTimestamps: nextValue,
              }))
            }
          />
        </Row>
        <Row label={cli.syntaxHighlighting}>
          <Toggle
            checked={cliSettings.syntaxHighlighting}
            onChange={(nextValue) =>
              setCliSettings((previous) => ({
                ...previous,
                syntaxHighlighting: nextValue,
              }))
            }
          />
        </Row>
      </Section>

      <Section title={cli.execution}>
        <Row label={cli.commandTimeout}>
          <input
            type="number"
            value={cliSettings.timeout}
            onChange={(e) =>
              setCliSettings((previous) => ({
                ...previous,
                timeout: e.target.value,
              }))
            }
            className="input input-xs w-24 bg-base-300 border-base-content/10 font-mono text-right user-select-text"
          />
        </Row>
        <Row label={cli.pipelineMode} description={cli.pipelineModeDescription}>
          <Toggle
            checked={cliSettings.pipelineMode}
            onChange={(nextValue) =>
              setCliSettings((previous) => ({
                ...previous,
                pipelineMode: nextValue,
              }))
            }
          />
        </Row>
      </Section>

      <Section title={cli.actions}>
        <Row label={cli.clearHistory} description={cli.clearHistoryDescription}>
          <button
            onClick={() => {
              clearCliHistory();
              showToast({
                message: cli.clearHistory,
                tone: "info",
              });
            }}
            className="btn btn-ghost btn-xs gap-1.5 cursor-pointer text-base-content/50 hover:text-error"
          >
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
  const { showToast } = useToast();
  const privacy = messages.settings.privacy;
  const [privacySettings, setPrivacySettings] = useAppSettingsSection("privacy");

  return (
    <>
      <Section title={privacy.dataCollection}>
        <Row
          label={privacy.anonymousTelemetry}
          description={privacy.anonymousTelemetryDescription}
        >
          <Toggle
            checked={privacySettings.telemetry}
            onChange={(nextValue) =>
              setPrivacySettings((previous) => ({
                ...previous,
                telemetry: nextValue,
              }))
            }
          />
        </Row>
        <Row
          label={privacy.crashReports}
          description={privacy.crashReportsDescription}
        >
          <Toggle
            checked={privacySettings.crashReports}
            onChange={(nextValue) =>
              setPrivacySettings((previous) => ({
                ...previous,
                crashReports: nextValue,
              }))
            }
          />
        </Row>
      </Section>

      <Section title={privacy.security}>
        <Row
          label={privacy.savePasswords}
          description={privacy.savePasswordsDescription}
        >
          <Toggle
            checked={privacySettings.savePasswords}
            onChange={(nextValue) =>
              setPrivacySettings((previous) => ({
                ...previous,
                savePasswords: nextValue,
              }))
            }
          />
        </Row>
        <Row
          label={privacy.auditLog}
          description={privacy.auditLogDescription}
        >
          <Toggle
            checked={privacySettings.auditLog}
            onChange={(nextValue) =>
              setPrivacySettings((previous) => ({
                ...previous,
                auditLog: nextValue,
              }))
            }
          />
        </Row>
      </Section>

      <Section title={privacy.data}>
        <Row
          label={privacy.clearCachedData}
          description={privacy.clearCachedDataDescription}
        >
          <button
            onClick={() => {
              void clearPrivacyRuntimeData()
                .then(() => {
                  showToast({
                    message: privacy.clearCachedData,
                    tone: "success",
                  });
                })
                .catch((error) => {
                  showToast({
                    message:
                      error instanceof Error ? error.message : String(error),
                    tone: "error",
                    duration: 1800,
                  });
                });
            }}
            className="btn btn-ghost btn-xs gap-1.5 cursor-pointer text-base-content/50 hover:text-error"
          >
            <RotateCcw size={11} /> {messages.common.reset}
          </button>
        </Row>
      </Section>
    </>
  );
}
