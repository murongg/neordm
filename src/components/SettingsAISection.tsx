import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  Eye,
  EyeOff,
  Info,
  LoaderCircle,
} from "lucide-react";
import { useI18n } from "../i18n";
import {
  DEFAULT_AI_SETTINGS,
  loadAiSettings,
  persistAiSettings,
  type OpenAiApiStyle,
} from "../lib/aiSettings";
import {
  testAiProviderConnection,
  type AiProviderConnectionTestCheck,
  type AiProviderConnectionTestCheckStatus,
  type AiProviderConnectionTestResult,
} from "../lib/openai";
import { useToast } from "./ToastProvider";

export function SettingsAISection() {
  const { messages } = useI18n();
  const { showToast } = useToast();
  const ai = messages.settings.ai;
  const [settings, setSettings] = useState(DEFAULT_AI_SETTINGS);
  const [showKey, setShowKey] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] =
    useState<AiProviderConnectionTestResult | null>(null);
  const [connectionTestChecks, setConnectionTestChecks] = useState<
    AiProviderConnectionTestCheck[]
  >([]);

  useEffect(() => {
    let cancelled = false;

    void loadAiSettings().then((nextSettings) => {
      if (cancelled) {
        return;
      }

      setSettings(nextSettings);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedProviderConfig = settings.providers[settings.activeProviderId];

  const updateSelectedProviderConfig = useCallback(
    (nextConfig: Partial<typeof selectedProviderConfig>) => {
      setSettings((previous) => ({
        ...previous,
        providers: {
          ...previous.providers,
          [previous.activeProviderId]: {
            ...previous.providers[previous.activeProviderId],
            ...nextConfig,
          },
        },
      }));
      setConnectionTestResult(null);
      setConnectionTestChecks([]);
    },
    []
  );

  const handleSave = useCallback(async () => {
    await persistAiSettings(settings);
    setConnectionTestResult(null);
    showToast({
      message: ai.saveApiKey,
      tone: "success",
      duration: 2000,
    });
  }, [ai.saveApiKey, settings, showToast]);

  const handleTestConnection = useCallback(async () => {
    setIsTestingConnection(true);
    setConnectionTestResult(null);
    setConnectionTestChecks([]);

    try {
      const result = await testAiProviderConnection(selectedProviderConfig, {
        onUpdate: setConnectionTestChecks,
      });

      setConnectionTestResult(result);

      if (result.ok) {
        const nextSettings = {
          ...settings,
          providers: {
            ...settings.providers,
            [settings.activeProviderId]: {
              ...selectedProviderConfig,
              capabilities: result.capabilities,
            },
          },
        };

        setSettings(nextSettings);
        await persistAiSettings(nextSettings);
      }

      showToast({
        message: result.summary,
        tone: result.ok ? "success" : "error",
        duration: result.ok ? 2200 : 2800,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to test AI connection.";

      setConnectionTestResult({
        ok: false,
        summary: message,
        normalizedBaseUrl: selectedProviderConfig.baseUrl.trim(),
        model: selectedProviderConfig.model.trim(),
        preferredApiStyle: null,
        capabilities: {
          responses: null,
          chatCompletions: null,
          testedAt: Date.now(),
        },
        checks: [
          {
            id: "config",
            label: "Config",
            status: "error",
            detail: message,
          },
        ],
      });
      setConnectionTestChecks([]);
      showToast({
        message,
        tone: "error",
        duration: 2800,
      });
    } finally {
      setIsTestingConnection(false);
    }
  }, [selectedProviderConfig, settings, showToast]);

  const activeConnectionTestChecks =
    connectionTestResult?.checks ??
    (connectionTestChecks.length > 0
      ? connectionTestChecks
      : DEFAULT_AI_TEST_CHECKS);
  const activeConnectionTestTone = connectionTestResult
    ? connectionTestResult.ok
      ? "success"
      : "error"
    : "info";
  const activeRunningCheck = connectionTestChecks.find(
    (check) => check.status === "running"
  );
  const activeConnectionTestSummary = connectionTestResult
    ? connectionTestResult.summary
    : activeRunningCheck
      ? `Testing ${activeRunningCheck.label}...`
      : `Runtime currently uses ${formatApiStyleLabel(
          selectedProviderConfig.apiStyle
        )}. Test checks \`GET /models\`, \`POST /responses\`, and \`POST /chat/completions\`.`;

  return (
    <>
      <SettingsSection title={ai.apiConfiguration}>
        <SettingsField label="API Key">
          <div className="flex items-center gap-2">
            <input
              type={showKey ? "text" : "password"}
              value={selectedProviderConfig.apiKey}
              onChange={(event) =>
                updateSelectedProviderConfig({ apiKey: event.target.value })
              }
              placeholder={ai.apiKeyPlaceholder}
              className="input input-xs h-8 min-h-8 flex-1 bg-base-300 border-base-content/10 font-mono text-xs user-select-text"
            />
            <button
              type="button"
              onClick={() => setShowKey((previous) => !previous)}
              className="btn btn-ghost btn-xs btn-square h-8 min-h-8 w-8 cursor-pointer"
            >
              {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </SettingsField>

        <SettingsField label={ai.baseUrl}>
          <input
            type="url"
            value={selectedProviderConfig.baseUrl}
            onChange={(event) =>
              updateSelectedProviderConfig({ baseUrl: event.target.value })
            }
            placeholder="https://api.openai.com/v1"
            className="input input-xs h-8 min-h-8 w-full bg-base-300 border-base-content/10 font-mono text-xs user-select-text"
          />
        </SettingsField>

        <div className="grid gap-1 md:grid-cols-[minmax(0,1fr)_140px]">
          <SettingsField label={ai.model}>
            <input
              value={selectedProviderConfig.model}
              onChange={(event) =>
                updateSelectedProviderConfig({ model: event.target.value })
              }
              placeholder="gpt-4.1-mini"
              className="input input-xs h-8 min-h-8 w-full bg-base-300 border-base-content/10 font-mono text-xs user-select-text"
            />
          </SettingsField>

          <SettingsField label={ai.maxTokens}>
            <input
              type="number"
              min="1"
              value={settings.maxTokens}
              onChange={(event) =>
                setSettings((previous) => ({
                  ...previous,
                  maxTokens: Math.max(1, Number(event.target.value) || 1),
                }))
              }
              className="input input-xs h-8 min-h-8 w-full bg-base-300 border-base-content/10 font-mono text-xs user-select-text"
            />
          </SettingsField>
        </div>

        <div className="flex items-center justify-end gap-1.5 px-3 pt-2">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={isTestingConnection}
            className="btn btn-outline btn-xs h-8 min-h-8 gap-1.5 cursor-pointer font-mono"
          >
            {isTestingConnection ? (
              <>
                <LoaderCircle size={12} className="animate-spin" />
                {ai.testingConnection}
              </>
            ) : (
              ai.testConnection
            )}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="btn btn-success btn-xs h-8 min-h-8 gap-1.5 cursor-pointer font-mono"
          >
            <Check size={12} /> {ai.saveApiKey}
          </button>
        </div>

        <ConnectionTestStatus
          tone={activeConnectionTestTone}
          summary={activeConnectionTestSummary}
          checks={activeConnectionTestChecks}
          isTesting={isTestingConnection}
          apiStyle={selectedProviderConfig.apiStyle}
        />
      </SettingsSection>

      <SettingsSection title={ai.behavior}>
        <SettingsRow
          label={ai.autoSuggest}
          description={ai.autoSuggestDescription}
        >
          <SettingsToggle
            checked={settings.autoSuggest}
            onChange={(nextValue) =>
              setSettings((previous) => ({
                ...previous,
                autoSuggest: nextValue,
              }))
            }
          />
        </SettingsRow>
        <SettingsRow
          label={ai.includeKeyContext}
          description={ai.includeKeyContextDescription}
        >
          <SettingsToggle
            checked={settings.includeKeyContext}
            onChange={(nextValue) =>
              setSettings((previous) => ({
                ...previous,
                includeKeyContext: nextValue,
              }))
            }
          />
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

const CONNECTION_TEST_TONE_STYLES = {
  success: "text-success",
  error: "text-error",
  info: "text-base-content/65",
} as const;

const CONNECTION_TEST_CHECK_STYLES: Record<
  AiProviderConnectionTestCheckStatus,
  string
> = {
  pending: "text-base-content/35",
  running: "text-info",
  success: "text-success",
  info: "text-base-content/55",
  error: "text-error",
};

const DEFAULT_AI_TEST_CHECKS: AiProviderConnectionTestCheck[] = [
  {
    id: "config",
    label: "Config",
    status: "info",
    detail: "Validates the API key, base URL, and selected model first.",
  },
  {
    id: "models",
    label: "GET /models",
    status: "info",
    detail: "Checks whether the gateway is reachable through the Tauri backend proxy.",
  },
  {
    id: "responses",
    label: "POST /responses",
    status: "info",
    detail: "Verifies the same runtime endpoint the AI agent will use.",
  },
  {
    id: "chat",
    label: "POST /chat/completions",
    status: "info",
    detail: "Checks legacy OpenAI chat compatibility on the same gateway.",
  },
];

function ConnectionTestStatus({
  tone,
  summary,
  checks,
  isTesting,
  apiStyle,
}: {
  tone: keyof typeof CONNECTION_TEST_TONE_STYLES;
  summary: string;
  checks: AiProviderConnectionTestCheck[];
  isTesting: boolean;
  apiStyle: OpenAiApiStyle;
}) {
  const SummaryIcon =
    tone === "success" ? Check : tone === "error" ? AlertCircle : Info;

  return (
    <div
      aria-live="polite"
      className="mt-3 border-t border-base-content/10 px-3 pt-3"
    >
      <div className="flex items-start gap-2">
        {isTesting ? (
          <LoaderCircle
            size={13}
            className="mt-0.5 shrink-0 animate-spin text-info"
          />
        ) : (
          <SummaryIcon
            size={13}
            className={`mt-0.5 shrink-0 ${CONNECTION_TEST_TONE_STYLES[tone]}`}
          />
        )}

        <div className="min-w-0 flex-1">
          <p
            className={`text-[11px] leading-5 font-mono ${
              isTesting ? "text-info" : CONNECTION_TEST_TONE_STYLES[tone]
            }`}
          >
            {summary}
          </p>
          <p className="mt-1 text-[10px] font-mono text-base-content/40">
            Runtime API: {formatApiStyleLabel(apiStyle)}
          </p>

          <div className="mt-2 space-y-1.5 pb-0.5">
            {checks.map((check) => (
              <ConnectionTestCheckRow key={check.id} check={check} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ConnectionTestCheckRow({
  check,
}: {
  check: AiProviderConnectionTestCheck;
}) {
  const CheckIcon =
    check.status === "success"
      ? Check
      : check.status === "error"
        ? AlertCircle
        : check.status === "running"
          ? LoaderCircle
          : Info;

  return (
    <div className="flex items-start gap-2 text-[10px] font-mono leading-4">
      <CheckIcon
        size={11}
        className={`mt-[2px] shrink-0 ${
          check.status === "running" ? "animate-spin" : ""
        } ${CONNECTION_TEST_CHECK_STYLES[check.status]}`}
      />
      <div className="min-w-0">
        <p className={CONNECTION_TEST_CHECK_STYLES[check.status]}>
          {check.label}
        </p>
        <p className="mt-0.5 break-words text-base-content/45">{check.detail}</p>
      </div>
    </div>
  );
}

function formatApiStyleLabel(apiStyle: OpenAiApiStyle) {
  return apiStyle === "chat-completions"
    ? "POST /chat/completions"
    : "POST /responses";
}

function SettingsSection({
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

function SettingsRow({
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
          <p className="text-[10px] text-base-content/40 mt-0.5">
            {description}
          </p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SettingsToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      className="toggle toggle-xs toggle-success cursor-pointer"
    />
  );
}

function SettingsField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2 rounded-xl px-3 py-2.5 transition-colors duration-150 hover:bg-base-300/50">
      <span className="text-xs font-mono text-base-content/80">{label}</span>
      {children}
    </label>
  );
}
