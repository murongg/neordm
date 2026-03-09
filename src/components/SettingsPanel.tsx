import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import type { ThemeMode } from "../hooks/useTheme";
import {
  X,
  Sliders,
  Palette,
  Bot,
  Terminal,
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
import { APP_NAME, APP_VERSION } from "../lib/appMeta";
import { clearPrivacyRuntimeData } from "../lib/privacyRuntime";
import { useAppUpdateStore } from "../store/useAppUpdateState";
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
  { id: "privacy", icon: <Shield size={14} /> },
];

const LazySettingsAISection = lazy(async () => ({
  default: (await import("./SettingsAISection")).SettingsAISection,
}));

type ThemePreviewTheme = "light" | "night";

function AISettingsFallback() {
  return <div className="h-24 rounded-xl bg-base-300/40" />;
}

function ThemePreviewCanvas() {
  return (
    <>
      <div className="absolute inset-y-0 left-0 w-[18px] bg-base-200" />
      <div className="absolute left-1 top-2 h-2.5 w-2.5 rounded-[2px] bg-primary/20" />
      <div className="absolute left-[5px] top-[9px] h-1.5 w-1.5 rounded-full bg-primary" />
      <div className="absolute left-1 top-[22px] h-0.5 w-2.5 rounded-full bg-base-300" />
      <div className="absolute left-1 top-[26px] h-0.5 w-2 rounded-full bg-base-200" />
      <div className="absolute left-1 top-[30px] h-0.5 w-2.5 rounded-full bg-base-300" />
      <div className="absolute left-1 top-[34px] h-0.5 w-1.75 rounded-full bg-base-200" />
      <div className="absolute left-[22px] top-[6px] h-1.5 w-[34px] rounded-[2px] bg-base-200" />
      <div className="absolute left-[22px] top-[16px] h-[3px] w-[50px] rounded-full bg-base-200" />
      <div className="absolute left-[22px] top-[21px] h-[3px] w-[44px] rounded-full bg-base-200" />
      <div className="absolute left-[22px] top-[26px] h-[3px] w-[48px] rounded-full bg-base-200" />
      <div className="absolute left-[22px] top-[6px] h-1.5 w-2.5 rounded-[2px] bg-primary" />
    </>
  );
}

function ThemePreviewSurface({ theme }: { theme: ThemePreviewTheme }) {
  return (
    <div
      data-theme={theme}
      className="relative h-full w-full overflow-hidden bg-base-100"
    >
      <ThemePreviewCanvas />
    </div>
  );
}

function ThemePreview({
  mode,
}: {
  mode: ThemeMode;
}) {
  if (mode === "system") {
    return (
      <div className="relative h-full w-full overflow-hidden">
        <div className="absolute inset-y-0 left-0 w-1/2 border-r border-base-content/8">
          <ThemePreviewSurface theme="light" />
        </div>
        <div className="absolute inset-y-0 right-0 w-1/2">
          <ThemePreviewSurface theme="night" />
        </div>
      </div>
    );
  }

  return <ThemePreviewSurface theme={mode === "dark" ? "night" : "light"} />;
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
                        ? "bg-primary/10 text-primary"
                        : "text-base-content/50 hover:bg-base-content/5 hover:text-base-content"
                    }
                  `}
                >
                  <span className={category === c.id ? "text-primary" : "text-base-content/30"}>
                    {c.icon}
                  </span>
                  {c.label}
                  {category === c.id && (
                    <span className="ml-auto w-1 h-4 rounded-full bg-primary" />
                  )}
                </button>
              </li>
            ))}
          </ul>
          <div className="p-3 border-t border-base-content/10">
            <p className="text-[10px] font-mono text-base-content/20 text-center">
              {APP_NAME} v{APP_VERSION}
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
      className="toggle toggle-xs toggle-primary cursor-pointer"
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

      <UpdatesSettings />
    </>
  );
}

function formatUpdateProgress(
  downloadedBytes: number,
  totalBytes: number | null
) {
  if (!totalBytes || totalBytes <= 0) {
    return `${Math.round(downloadedBytes / 1024)} KB`;
  }

  const progress = Math.min(
    100,
    Math.max(0, Math.round((downloadedBytes / totalBytes) * 100))
  );
  return `${progress}%`;
}

function UpdatesSettings() {
  const { messages } = useI18n();
  const updateState = useAppUpdateStore();
  const general = messages.settings.general;
  const isBusy =
    updateState.status === "checking" ||
    updateState.status === "downloading" ||
    updateState.status === "installing";

  const latestVersionText = `v${updateState.availableVersion ?? updateState.currentVersion}`;

  const latestVersionMeta = [
    updateState.status === "checking"
      ? general.checkingForUpdates
      : updateState.status === "latest"
      ? general.upToDate
      : updateState.status === "available"
      ? general.updateAvailable
      : updateState.status === "downloading"
      ? `${general.downloadingUpdate} ${formatUpdateProgress(
          updateState.downloadedBytes,
          updateState.totalBytes
        )}`
      : updateState.status === "installing"
      ? general.installingUpdate
      : null,
    updateState.releaseDate
      ? new Date(updateState.releaseDate).toLocaleDateString()
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const buttonLabel =
    updateState.status === "checking"
      ? general.checkingForUpdates
      : updateState.status === "available"
      ? general.downloadAndInstall
      : updateState.status === "downloading"
      ? general.downloadingUpdate
      : updateState.status === "installing"
      ? general.installingUpdate
      : general.checkForUpdates;

  return (
    <Section title={general.updates}>
      <Row label={general.currentVersion}>
        <span className="text-xs font-mono text-base-content/50">
          v{APP_VERSION}
        </span>
      </Row>
      <Row
        label={general.latestVersion}
        description={latestVersionMeta || undefined}
      >
        <span className="text-xs font-mono text-base-content/50">
          {latestVersionText}
        </span>
      </Row>
      <Row
        label={general.checkForUpdates}
        description={
          updateState.releaseNotes
            ? updateState.releaseNotes
                .replace(/\r/g, "")
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean)
                .slice(0, 2)
                .join(" · ")
            : undefined
        }
      >
        <button
          onClick={() => {
            if (updateState.status === "available") {
              void updateState.installUpdate();
              return;
            }

            void updateState.checkForUpdates();
          }}
          disabled={isBusy}
          className={`btn btn-xs gap-1.5 ${
            updateState.status === "available"
              ? "btn-primary"
              : "btn-ghost text-base-content/60"
          } ${isBusy ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
        >
          {buttonLabel}
        </button>
      </Row>
      {updateState.status === "error" && updateState.errorMessage ? (
        <div className="mt-2 rounded-xl border border-error/20 bg-error/8 px-3 py-2 text-[11px] text-error/80">
          {updateState.errorMessage}
        </div>
      ) : null}
    </Section>
  );
}

// ─── Theme Picker ────────────────────────────────────────────────────────────

function ThemePicker({ value, onChange }: { value: ThemeMode; onChange: (m: ThemeMode) => void }) {
  const { messages } = useI18n();
  const options: { mode: ThemeMode; label: string }[] = [
    {
      mode: "light",
      label: messages.settings.appearance.themes.light,
    },
    {
      mode: "dark",
      label: messages.settings.appearance.themes.dark,
    },
    {
      mode: "system",
      label: messages.settings.appearance.themes.system,
    },
  ];

  return (
    <div className="flex gap-3">
      {options.map(({ mode, label }) => {
        const active = value === mode;
        return (
          <button
            key={mode}
            onClick={() => onChange(mode)}
            className={`
              flex-1 flex flex-col cursor-pointer rounded-xl overflow-hidden
              border-2 transition-all duration-200
              ${active ? "border-primary shadow-lg shadow-primary/10" : "border-base-content/10 hover:border-base-content/25"}
            `}
          >
            <div className="w-full aspect-[80/52] overflow-hidden bg-base-300">
              <ThemePreview mode={mode} />
            </div>
            <div className={`flex items-center justify-between px-2.5 py-1.5 ${active ? "text-primary" : "text-base-content/50"}`}>
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

      <Section title={appearance.layout}>
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

function PrivacySettings() {
  const { messages } = useI18n();
  const { showToast } = useToast();
  const privacy = messages.settings.privacy;
  const [privacySettings, setPrivacySettings] = useAppSettingsSection("privacy");

  return (
    <>
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
