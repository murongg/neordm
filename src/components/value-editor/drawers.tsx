import { useMemo, useState, type ReactNode } from "react";
import { LoaderCircle, Save, X } from "lucide-react";
import { useI18n } from "../../i18n";
import { useModalTransition } from "../../hooks/useModalTransition";
import { getRedisErrorMessage, type RedisListInsertPosition } from "../../lib/redis";
import {
  compactJsonDraft,
  EditorRuntimeSettings,
  formatJsonDraft,
  getJsonDraftError,
  isStructuredJsonText,
  JsonCodeEditor,
} from "./shared";

function RowEditDrawerShell({
  title,
  subtitle,
  isSaving,
  error,
  onClose,
  onSave,
  children,
}: {
  title: string;
  subtitle: string;
  isSaving: boolean;
  error: string;
  onClose: () => void;
  onSave: () => Promise<boolean>;
  children: ReactNode;
}) {
  const { messages } = useI18n();
  const { isVisible, requestClose, handleBackdropClick } =
    useModalTransition(onClose);

  return (
    <div
      className={`absolute inset-0 z-30 flex justify-end bg-black/30 backdrop-blur-[1px] transition-opacity duration-200 ease-out motion-reduce:transition-none ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
      onClick={handleBackdropClick}
    >
      <div
        className={`flex h-full w-full max-w-sm flex-col border-l border-base-content/10 bg-base-200 shadow-2xl transition-transform duration-200 ease-out motion-reduce:transition-none ${
          isVisible ? "translate-x-0" : "translate-x-6"
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-base-content/10 px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-mono font-semibold text-base-content/85">
              {title}
            </h3>
            <p className="mt-1 truncate text-[11px] font-mono text-base-content/45">
              {subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="btn btn-ghost btn-xs shrink-0 cursor-pointer"
            aria-label={messages.common.cancel}
          >
            <X size={12} />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-4 py-4">{children}</div>

        <div className="border-t border-base-content/10 px-4 py-3">
          {error ? (
            <p className="mb-3 rounded-lg border border-error/15 bg-error/8 px-3 py-2 text-xs text-error">
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={requestClose}
              disabled={isSaving}
              className="btn btn-ghost btn-sm cursor-pointer"
            >
              {messages.common.cancel}
            </button>
            <button
              type="button"
              onClick={() => {
                void onSave().then((shouldClose) => {
                  if (!shouldClose) return;
                  requestClose();
                });
              }}
              disabled={isSaving}
              className="btn btn-primary btn-sm gap-1.5 cursor-pointer font-mono"
            >
              {isSaving ? (
                <LoaderCircle size={13} className="animate-spin" />
              ) : (
                <Save size={13} />
              )}
              {messages.common.save}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function HashRowEditDrawer({
  keyName,
  mode,
  initialField,
  initialValue,
  settings,
  onClose,
  onSave,
}: {
  keyName: string;
  mode: "create" | "edit";
  initialField: string;
  initialValue: string;
  settings: EditorRuntimeSettings;
  onClose: () => void;
  onSave: (nextField: string, nextValue: string) => Promise<void>;
}) {
  const { messages } = useI18n();
  const usesJsonValueEditor = useMemo(
    () => isStructuredJsonText(initialValue),
    [initialValue]
  );
  const [field, setField] = useState(initialField);
  const [value, setValue] = useState(() =>
    usesJsonValueEditor && settings.autoFormatJson
      ? formatJsonDraft(initialValue)
      : initialValue
  );
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const jsonValidationError = usesJsonValueEditor ? getJsonDraftError(value) : "";
  const error = saveError || jsonValidationError;

  const handleResetValue = () => {
    setValue(
      settings.autoFormatJson ? formatJsonDraft(initialValue) : initialValue
    );
    setSaveError("");
  };

  const handleSave = async () => {
    if (!field.length) {
      setSaveError(`${messages.valueEditor.field} cannot be empty`);
      return false;
    }

    if (usesJsonValueEditor && jsonValidationError) {
      setSaveError(jsonValidationError);
      return false;
    }

    setIsSaving(true);
    setSaveError("");

    try {
      await onSave(field, usesJsonValueEditor ? compactJsonDraft(value) : value);
      return true;
    } catch (saveError) {
      setSaveError(getRedisErrorMessage(saveError));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <RowEditDrawerShell
      title={mode === "create" ? messages.keyBrowser.addEntry : messages.common.edit}
      subtitle={keyName}
      isSaving={isSaving}
      error={error}
      onClose={onClose}
      onSave={handleSave}
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-mono text-base-content/50">
            {messages.valueEditor.field}
          </span>
          <input
            type="text"
            value={field}
            onChange={(event) => {
              setField(event.target.value);
              setSaveError("");
            }}
            className="input input-sm w-full bg-base-100 font-mono user-select-text"
            autoFocus
          />
        </label>
        {usesJsonValueEditor ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-mono text-base-content/50">
                {messages.valueEditor.value}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleResetValue}
                  className="btn btn-ghost btn-xs cursor-pointer font-mono"
                >
                  {messages.common.reset}
                </button>
              </div>
            </div>
            <JsonCodeEditor
              value={value}
              onChange={(nextValue) => {
                setValue(nextValue);
                setSaveError("");
              }}
              className="h-[18rem]"
              surfaceClassName="bg-base-100"
              wordWrap={settings.wordWrap}
              syntaxHighlightingEnabled={settings.syntaxHighlighting}
            />
          </div>
        ) : (
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-mono text-base-content/50">
              {messages.valueEditor.value}
            </span>
            <input
              type="text"
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setSaveError("");
              }}
              className="input input-sm w-full bg-base-100 font-mono user-select-text"
            />
          </label>
        )}
      </div>
    </RowEditDrawerShell>
  );
}

export function ZSetRowEditDrawer({
  keyName,
  mode,
  initialMember,
  initialScore,
  onClose,
  onSave,
}: {
  keyName: string;
  mode: "create" | "edit";
  initialMember: string;
  initialScore: number;
  onClose: () => void;
  onSave: (nextMember: string, nextScore: number) => Promise<void>;
}) {
  const { messages } = useI18n();
  const [member, setMember] = useState(initialMember);
  const [score, setScore] = useState(String(initialScore));
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!member.length) {
      setError(`${messages.valueEditor.member} cannot be empty`);
      return false;
    }

    const nextScore = Number(score);

    if (!Number.isFinite(nextScore)) {
      setError("Score must be a valid number");
      return false;
    }

    setIsSaving(true);
    setError("");

    try {
      await onSave(member, nextScore);
      return true;
    } catch (saveError) {
      setError(getRedisErrorMessage(saveError));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <RowEditDrawerShell
      title={mode === "create" ? messages.keyBrowser.addMember : messages.common.edit}
      subtitle={keyName}
      isSaving={isSaving}
      error={error}
      onClose={onClose}
      onSave={handleSave}
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-mono text-base-content/50">
            {messages.valueEditor.member}
          </span>
          <input
            type="text"
            value={member}
            onChange={(event) => setMember(event.target.value)}
            className="input input-sm w-full bg-base-100 font-mono user-select-text"
            autoFocus
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-mono text-base-content/50">
            {messages.valueEditor.score}
          </span>
          <input
            type="number"
            step="any"
            value={score}
            onChange={(event) => setScore(event.target.value)}
            className="input input-sm w-full bg-base-100 font-mono user-select-text"
          />
        </label>
      </div>
    </RowEditDrawerShell>
  );
}

export function SingleValueEditDrawer({
  keyName,
  mode,
  kind,
  initialValue,
  initialInsertPosition = "tail",
  settings,
  onClose,
  onSave,
}: {
  keyName: string;
  mode: "create" | "edit";
  kind: "list" | "set";
  initialValue: string;
  initialInsertPosition?: RedisListInsertPosition;
  settings: EditorRuntimeSettings;
  onClose: () => void;
  onSave: (
    nextValue: string,
    insertPosition?: RedisListInsertPosition
  ) => Promise<void>;
}) {
  const { messages } = useI18n();
  const usesJsonValueEditor = useMemo(
    () => mode === "edit" && isStructuredJsonText(initialValue),
    [initialValue, mode]
  );
  const [value, setValue] = useState(() =>
    usesJsonValueEditor && settings.autoFormatJson
      ? formatJsonDraft(initialValue)
      : initialValue
  );
  const [insertPosition, setInsertPosition] =
    useState<RedisListInsertPosition>(initialInsertPosition);
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const jsonValidationError = usesJsonValueEditor ? getJsonDraftError(value) : "";
  const error = saveError || jsonValidationError;
  const label =
    kind === "list" ? messages.valueEditor.value : messages.valueEditor.member;
  const showsInsertPosition = kind === "list" && mode === "create";
  const title =
    mode === "create"
      ? kind === "list"
        ? messages.keyBrowser.addValue
        : messages.keyBrowser.addMember
      : messages.common.edit;

  const handleResetValue = () => {
    setValue(
      usesJsonValueEditor && settings.autoFormatJson
        ? formatJsonDraft(initialValue)
        : initialValue
    );
    setSaveError("");
  };

  const handleSave = async () => {
    const nextValue = usesJsonValueEditor ? compactJsonDraft(value) : value.trim();

    if (!nextValue.length) {
      setSaveError(`${label} cannot be empty`);
      return false;
    }

    if (usesJsonValueEditor && jsonValidationError) {
      setSaveError(jsonValidationError);
      return false;
    }

    setIsSaving(true);
    setSaveError("");

    try {
      await onSave(nextValue, showsInsertPosition ? insertPosition : undefined);
      return true;
    } catch (saveError) {
      setSaveError(getRedisErrorMessage(saveError));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <RowEditDrawerShell
      title={title}
      subtitle={keyName}
      isSaving={isSaving}
      error={error}
      onClose={onClose}
      onSave={handleSave}
    >
      <div className="flex flex-col gap-4">
        {usesJsonValueEditor ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-mono text-base-content/50">
                {label}
              </span>
              <button
                type="button"
                onClick={handleResetValue}
                className="btn btn-ghost btn-xs cursor-pointer font-mono"
              >
                {messages.common.reset}
              </button>
            </div>
            <JsonCodeEditor
              value={value}
              onChange={(nextValue) => {
                setValue(nextValue);
                setSaveError("");
              }}
              className="h-[18rem]"
              surfaceClassName="bg-base-100"
              wordWrap={settings.wordWrap}
              syntaxHighlightingEnabled={settings.syntaxHighlighting}
              autoFocus
            />
          </div>
        ) : (
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-mono text-base-content/50">
              {label}
            </span>
            <input
              type="text"
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setSaveError("");
              }}
              className="input input-sm w-full bg-base-100 font-mono user-select-text"
              autoFocus
            />
          </label>
        )}
        {showsInsertPosition ? (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-base-200/60 py-2">
            <span className="text-[11px] font-mono text-base-content/50">
              {messages.valueEditor.insertPosition}
            </span>
            <div className="tabs tabs-box tabs-xs rounded-lg bg-base-100/70 p-0.5">
              <button
                type="button"
                onClick={() => {
                  setInsertPosition("head");
                  setSaveError("");
                }}
                className={`tab cursor-pointer rounded-md font-mono text-[11px] transition-colors duration-150 ${
                  insertPosition === "head" ? "tab-active" : ""
                }`}
              >
                {messages.valueEditor.insertHead}
              </button>
              <button
                type="button"
                onClick={() => {
                  setInsertPosition("tail");
                  setSaveError("");
                }}
                className={`tab cursor-pointer rounded-md font-mono text-[11px] transition-colors duration-150 ${
                  insertPosition === "tail" ? "tab-active" : ""
                }`}
              >
                {messages.valueEditor.insertTail}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </RowEditDrawerShell>
  );
}
