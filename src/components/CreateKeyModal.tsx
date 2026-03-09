import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { Database, Plus, Trash2, X } from "lucide-react";
import { useI18n } from "../i18n";
import { useAppSettings } from "../hooks/useAppSettings";
import { useModalTransition } from "../hooks/useModalTransition";
import {
  getRedisErrorMessage,
  type RedisKeyCreateEntryInput,
  type RedisKeyCreateInput,
  type RedisKeyCreateMemberInput,
} from "../lib/redis";
import type { RedisKey, RedisKeyType } from "../types";
import type { JsonCodeEditorProps } from "./JsonCodeEditor";
import { useToast } from "./ToastProvider";

const LazyJsonCodeEditor = lazy(() => import("./JsonCodeEditor"));

interface CreateKeyModalProps {
  defaultTtl: string;
  initialKeyName?: string;
  onClose: () => void;
  onCreateKey: (input: RedisKeyCreateInput) => Promise<RedisKey>;
  onCreated: (key: RedisKey) => void;
}

interface TextValueDraft {
  id: number;
  value: string;
}

interface FieldValueDraft {
  id: number;
  field: string;
  value: string;
}

interface MemberScoreDraft {
  id: number;
  member: string;
  score: string;
}

function createTextValueDraft(id: number, value = ""): TextValueDraft {
  return { id, value };
}

function createFieldValueDraft(
  id: number,
  field = "",
  value = ""
): FieldValueDraft {
  return { id, field, value };
}

function createMemberScoreDraft(
  id: number,
  member = "",
  score = "0"
): MemberScoreDraft {
  return { id, member, score };
}

function isValidTtl(value: number) {
  return Number.isInteger(value) && (value === -1 || value > 0);
}

const MODAL_INPUT_CLASS =
  "input input-sm bg-base-300 font-mono text-sm user-select-text";
const MODAL_SELECT_CLASS = "select select-sm bg-base-300 font-mono text-sm";
const MODAL_TEXTAREA_CLASS =
  "textarea textarea-sm bg-base-300 font-mono text-sm user-select-text";

export function CreateKeyModal({
  defaultTtl,
  initialKeyName = "",
  onClose,
  onCreateKey,
  onCreated,
}: CreateKeyModalProps) {
  const { messages } = useI18n();
  const appSettings = useAppSettings();
  const { showToast } = useToast();
  const { isVisible, requestClose, handleBackdropClick } =
    useModalTransition(onClose);
  const nextDraftIdRef = useRef(5);
  const keyInputRef = useRef<HTMLInputElement | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [keyName, setKeyName] = useState(initialKeyName);
  const [keyType, setKeyType] = useState<RedisKeyType>("string");
  const [ttl, setTtl] = useState(defaultTtl);
  const [stringValue, setStringValue] = useState("");
  const [jsonValue, setJsonValue] = useState("{\n  \n}");
  const [listValues, setListValues] = useState<TextValueDraft[]>([
    createTextValueDraft(1),
  ]);
  const [setValues, setSetValues] = useState<TextValueDraft[]>([
    createTextValueDraft(2),
  ]);
  const [hashEntries, setHashEntries] = useState<FieldValueDraft[]>([
    createFieldValueDraft(3),
  ]);
  const [streamEntries, setStreamEntries] = useState<FieldValueDraft[]>([
    createFieldValueDraft(4),
  ]);
  const [zsetMembers, setZsetMembers] = useState<MemberScoreDraft[]>([
    createMemberScoreDraft(5),
  ]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      keyInputRef.current?.focus({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  const nextDraftId = useCallback(() => {
    nextDraftIdRef.current += 1;
    return nextDraftIdRef.current;
  }, []);

  const resetError = useCallback(() => {
    setError("");
  }, []);

  const modalDescription = useMemo(
    () => messages.keyBrowser.createDescription,
    [messages.keyBrowser.createDescription]
  );

  const buildPayload = useCallback((): RedisKeyCreateInput => {
    const trimmedKey = keyName.trim();

    if (!trimmedKey.length) {
      throw new Error(messages.keyBrowser.keyNameRequired);
    }

    const ttlNumber = Number.parseInt(ttl.trim(), 10);

    if (!isValidTtl(ttlNumber)) {
      throw new Error(messages.keyBrowser.ttlInvalid);
    }

    switch (keyType) {
      case "string":
        return {
          key: trimmedKey,
          type: "string",
          ttl: ttlNumber,
          value: stringValue,
        };
      case "json": {
        const nextJsonValue = jsonValue.trim();

        if (!nextJsonValue.length) {
          throw new Error(messages.keyBrowser.jsonRequired);
        }

        JSON.parse(nextJsonValue);

        return {
          key: trimmedKey,
          type: "json",
          ttl: ttlNumber,
          value: nextJsonValue,
        };
      }
      case "list": {
        const values = listValues
          .map((item) => item.value.trim())
          .filter((item) => item.length > 0);

        if (!values.length) {
          throw new Error(messages.keyBrowser.valueListRequired);
        }

        return {
          key: trimmedKey,
          type: "list",
          ttl: ttlNumber,
          values,
        };
      }
      case "set": {
        const values = setValues
          .map((item) => item.value.trim())
          .filter((item) => item.length > 0);

        if (!values.length) {
          throw new Error(messages.keyBrowser.valueListRequired);
        }

        return {
          key: trimmedKey,
          type: "set",
          ttl: ttlNumber,
          values,
        };
      }
      case "hash": {
        const entries: RedisKeyCreateEntryInput[] = hashEntries
          .map((entry) => ({
            field: entry.field.trim(),
            value: entry.value,
          }))
          .filter((entry) => entry.field.length > 0);

        if (!entries.length) {
          throw new Error(messages.keyBrowser.fieldListRequired);
        }

        return {
          key: trimmedKey,
          type: "hash",
          ttl: ttlNumber,
          entries,
        };
      }
      case "stream": {
        const entries: RedisKeyCreateEntryInput[] = streamEntries
          .map((entry) => ({
            field: entry.field.trim(),
            value: entry.value,
          }))
          .filter((entry) => entry.field.length > 0);

        if (!entries.length) {
          throw new Error(messages.keyBrowser.fieldListRequired);
        }

        return {
          key: trimmedKey,
          type: "stream",
          ttl: ttlNumber,
          entries,
        };
      }
      case "zset": {
        const members: RedisKeyCreateMemberInput[] = zsetMembers
          .map((member) => ({
            member: member.member.trim(),
            score: Number.parseFloat(member.score),
          }))
          .filter((member) => member.member.length > 0);

        if (!members.length) {
          throw new Error(messages.keyBrowser.memberListRequired);
        }

        if (members.some((member) => !Number.isFinite(member.score))) {
          throw new Error(messages.keyBrowser.scoreInvalid);
        }

        return {
          key: trimmedKey,
          type: "zset",
          ttl: ttlNumber,
          members,
        };
      }
    }
  }, [
    hashEntries,
    jsonValue,
    keyName,
    keyType,
    listValues,
    messages.keyBrowser.fieldListRequired,
    messages.keyBrowser.jsonRequired,
    messages.keyBrowser.keyNameRequired,
    messages.keyBrowser.memberListRequired,
    messages.keyBrowser.scoreInvalid,
    messages.keyBrowser.ttlInvalid,
    messages.keyBrowser.valueListRequired,
    setValues,
    streamEntries,
    stringValue,
    ttl,
    zsetMembers,
  ]);

  const handleSubmit = useCallback(async () => {
    if (isSaving) {
      return;
    }

    try {
      resetError();
      const payload = buildPayload();
      setIsSaving(true);
      const createdKey = await onCreateKey(payload);
      onCreated(createdKey);
      showToast({
        message: messages.keyBrowser.createSuccess.replace("{key}", createdKey.key),
        tone: "success",
        duration: 1600,
      });
      requestClose();
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : getRedisErrorMessage(submitError);

      setError(message);
      showToast({
        message,
        tone: "error",
        duration: 2200,
      });
    } finally {
      setIsSaving(false);
    }
  }, [
    buildPayload,
    isSaving,
    messages.keyBrowser.createSuccess,
    onCreateKey,
    onCreated,
    requestClose,
    resetError,
    showToast,
  ]);

  const updateTextValue = useCallback(
    (
      setter: Dispatch<SetStateAction<TextValueDraft[]>>,
      id: number,
      value: string
    ) => {
      resetError();
      setter((previous) =>
        previous.map((item) => (item.id === id ? { ...item, value } : item))
      );
    },
    [resetError]
  );

  const updateFieldValue = useCallback(
    (
      setter: Dispatch<SetStateAction<FieldValueDraft[]>>,
      id: number,
      field: "field" | "value",
      value: string
    ) => {
      resetError();
      setter((previous) =>
        previous.map((item) => (item.id === id ? { ...item, [field]: value } : item))
      );
    },
    [resetError]
  );

  const updateMemberValue = useCallback(
    (id: number, field: "member" | "score", value: string) => {
      resetError();
      setZsetMembers((previous) =>
        previous.map((item) => (item.id === id ? { ...item, [field]: value } : item))
      );
    },
    [resetError]
  );

  const removeTextValue = useCallback(
    (
      setter: Dispatch<SetStateAction<TextValueDraft[]>>,
      id: number
    ) => {
      resetError();
      setter((previous) =>
        previous.length > 1
          ? previous.filter((item) => item.id !== id)
          : previous.map((item) => (item.id === id ? { ...item, value: "" } : item))
      );
    },
    [resetError]
  );

  const removeFieldValue = useCallback(
    (
      setter: Dispatch<SetStateAction<FieldValueDraft[]>>,
      id: number
    ) => {
      resetError();
      setter((previous) =>
        previous.length > 1
          ? previous.filter((item) => item.id !== id)
          : previous.map((item) =>
              item.id === id ? { ...item, field: "", value: "" } : item
            )
      );
    },
    [resetError]
  );

  const removeMemberValue = useCallback(
    (id: number) => {
      resetError();
      setZsetMembers((previous) =>
        previous.length > 1
          ? previous.filter((item) => item.id !== id)
          : previous.map((item) =>
              item.id === id ? { ...item, member: "", score: "0" } : item
            )
      );
    },
    [resetError]
  );

  const activeTextValues = keyType === "list" ? listValues : setValues;
  const activeTextValueSetter = keyType === "list" ? setListValues : setSetValues;
  const activeEntries = keyType === "hash" ? hashEntries : streamEntries;
  const activeEntrySetter =
    keyType === "hash" ? setHashEntries : setStreamEntries;
  const supportsBatchValues = keyType === "list" || keyType === "set";
  const supportsEntryPairs = keyType === "hash" || keyType === "stream";

  return (
    <div
      onClick={handleBackdropClick}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity duration-200 ease-out motion-reduce:transition-none ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        className={`mx-4 w-full max-w-215 overflow-visible rounded-2xl border border-base-content/10 bg-base-200 shadow-2xl transition-all duration-200 ease-out motion-reduce:transition-none ${
          isVisible
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-3 scale-[0.98] opacity-0"
        }`}
      >
        <div className="flex items-center justify-between border-b border-base-content/10 px-4 py-3.5">
          <div className="flex items-center gap-2">
            <Database size={15} className="text-primary" />
            <div>
              <h2 className="text-sm font-semibold font-mono">
                {messages.keyBrowser.createTitle}
              </h2>
              <p className="mt-1 text-[11px] text-base-content/55">
                {modalDescription}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="btn btn-ghost btn-xs btn-circle"
          >
            <X size={14} />
          </button>
        </div>

        <div className="max-h-[76vh] overflow-y-auto px-1 py-1">
          <div className="grid grid-cols-1 lg:grid-cols-[232px_minmax(0,1fr)]">
            <div className="grid content-start gap-3 border-b border-base-content/10 px-4 py-4 lg:border-b-0 lg:border-r">
              <label>
                <span className="mb-1 block text-[10px] font-mono uppercase tracking-wider text-base-content/50">
                  {messages.keyBrowser.keyName}
                </span>
                <input
                  ref={keyInputRef}
                  type="text"
                  value={keyName}
                  onChange={(event) => {
                    resetError();
                    setKeyName(event.target.value);
                  }}
                  placeholder={messages.keyBrowser.keyNamePlaceholder}
                  className={`${MODAL_INPUT_CLASS} h-10 w-full`}
                  spellCheck={false}
                />
              </label>

              <label>
                <span className="mb-1 block text-[10px] font-mono uppercase tracking-wider text-base-content/50">
                  {messages.keyBrowser.type}
                </span>
                <select
                  value={keyType}
                  onChange={(event) => {
                    resetError();
                    setKeyType(event.target.value as RedisKeyType);
                  }}
                  className={`${MODAL_SELECT_CLASS} h-10 w-full`}
                >
                  <option value="string">string</option>
                  <option value="json">json</option>
                  <option value="hash">hash</option>
                  <option value="list">list</option>
                  <option value="set">set</option>
                  <option value="zset">zset</option>
                  <option value="stream">stream</option>
                </select>
              </label>

              <label>
                <span className="mb-1 block text-[10px] font-mono uppercase tracking-wider text-base-content/50">
                  {messages.keyBrowser.ttl}
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={ttl}
                  onChange={(event) => {
                    resetError();
                    setTtl(event.target.value);
                  }}
                  placeholder={messages.keyBrowser.ttlPlaceholder}
                  className={`${MODAL_INPUT_CLASS} h-10 w-full`}
                />
              </label>

              <p className="text-[11px] leading-5 text-base-content/45">
                {messages.keyBrowser.ttlHint}
              </p>
            </div>

            <div className="grid content-start gap-3 px-4 py-4">
              {keyType === "string" ? (
                <label>
                  <span className="mb-1 block text-[10px] font-mono uppercase tracking-wider text-base-content/50">
                    {messages.valueEditor.value}
                  </span>
                  <textarea
                    rows={4}
                    value={stringValue}
                    onChange={(event) => {
                      resetError();
                      setStringValue(event.target.value);
                    }}
                    placeholder={messages.keyBrowser.valuePlaceholder}
                    className={`${MODAL_TEXTAREA_CLASS} min-h-24 w-full resize-y leading-6`}
                    spellCheck={false}
                  />
                </label>
              ) : null}

              {keyType === "json" ? (
                <label>
                  <span className="mb-1 block text-[10px] font-mono uppercase tracking-wider text-base-content/50">
                    {messages.valueEditor.value}
                  </span>
                  <JsonCodeEditor
                    value={jsonValue}
                    onChange={(event) => {
                      resetError();
                      setJsonValue(event);
                    }}
                    className="h-72"
                    surfaceClassName="bg-base-300/65"
                    autoFocus={false}
                    mode="json"
                    wordWrap={appSettings.editor.wordWrap}
                    syntaxHighlightingEnabled={
                      appSettings.editor.syntaxHighlighting
                    }
                  />
                </label>
              ) : null}

              {supportsBatchValues ? (
                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-base-content/50">
                      {messages.keyBrowser.values}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        activeTextValueSetter((previous) => [
                          ...previous,
                          createTextValueDraft(nextDraftId()),
                        ])
                      }
                      className="btn btn-ghost btn-xs h-7 min-h-7 gap-1 px-2"
                    >
                      <Plus size={11} />
                      {messages.keyBrowser.addValue}
                    </button>
                  </div>
                  <div className="grid max-h-80 gap-1.5 overflow-y-auto px-1 py-1">
                    {activeTextValues.map((item, index) => (
                      <div
                        key={item.id}
                        className="grid grid-cols-[24px_minmax(0,1fr)_30px] items-center gap-1.5"
                      >
                        <span className="text-center text-[11px] font-mono text-base-content/40">
                          {index + 1}
                        </span>
                        <input
                          type="text"
                          value={item.value}
                          onChange={(event) =>
                            updateTextValue(
                              activeTextValueSetter,
                              item.id,
                              event.target.value
                            )
                          }
                          placeholder={messages.keyBrowser.valuePlaceholder}
                          className={`${MODAL_INPUT_CLASS} h-9 w-full`}
                          spellCheck={false}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            removeTextValue(activeTextValueSetter, item.id)
                          }
                          className="btn btn-ghost btn-sm btn-square h-9 min-h-9 text-base-content/45"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {supportsEntryPairs ? (
                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-base-content/50">
                      {messages.keyBrowser.entries}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        activeEntrySetter((previous) => [
                          ...previous,
                          createFieldValueDraft(nextDraftId()),
                        ])
                      }
                      className="btn btn-ghost btn-xs h-7 min-h-7 gap-1 px-2"
                    >
                      <Plus size={11} />
                      {messages.keyBrowser.addEntry}
                    </button>
                  </div>
                  <div className="grid max-h-80 gap-1.5 overflow-y-auto px-1 py-1">
                    {activeEntries.map((entry) => (
                      <div
                        key={entry.id}
                        className="grid grid-cols-[minmax(0,0.95fr)_minmax(0,1.3fr)_30px] items-center gap-1.5"
                      >
                        <input
                          type="text"
                          value={entry.field}
                          onChange={(event) =>
                            updateFieldValue(
                              activeEntrySetter,
                              entry.id,
                              "field",
                              event.target.value
                            )
                          }
                          placeholder={messages.keyBrowser.fieldPlaceholder}
                          className={`${MODAL_INPUT_CLASS} h-9`}
                          spellCheck={false}
                        />
                        <input
                          type="text"
                          value={entry.value}
                          onChange={(event) =>
                            updateFieldValue(
                              activeEntrySetter,
                              entry.id,
                              "value",
                              event.target.value
                            )
                          }
                          placeholder={messages.keyBrowser.valuePlaceholder}
                          className={`${MODAL_INPUT_CLASS} h-9`}
                          spellCheck={false}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            removeFieldValue(activeEntrySetter, entry.id)
                          }
                          className="btn btn-ghost btn-sm btn-square h-9 min-h-9 text-base-content/45"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {keyType === "zset" ? (
                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-base-content/50">
                      {messages.keyBrowser.members}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setZsetMembers((previous) => [
                          ...previous,
                          createMemberScoreDraft(nextDraftId()),
                        ])
                      }
                      className="btn btn-ghost btn-xs h-7 min-h-7 gap-1 px-2"
                    >
                      <Plus size={11} />
                      {messages.keyBrowser.addMember}
                    </button>
                  </div>
                  <div className="grid max-h-80 gap-1.5 overflow-y-auto px-1 py-1">
                    {zsetMembers.map((member) => (
                      <div
                        key={member.id}
                        className="grid grid-cols-[minmax(0,1.2fr)_110px_30px] items-center gap-1.5"
                      >
                        <input
                          type="text"
                          value={member.member}
                          onChange={(event) =>
                            updateMemberValue(
                              member.id,
                              "member",
                              event.target.value
                            )
                          }
                          placeholder={messages.keyBrowser.memberPlaceholder}
                          className={`${MODAL_INPUT_CLASS} h-9`}
                          spellCheck={false}
                        />
                        <input
                          type="text"
                          inputMode="decimal"
                          value={member.score}
                          onChange={(event) =>
                            updateMemberValue(
                              member.id,
                              "score",
                              event.target.value
                            )
                          }
                          placeholder="0"
                          className={`${MODAL_INPUT_CLASS} h-9`}
                          spellCheck={false}
                        />
                        <button
                          type="button"
                          onClick={() => removeMemberValue(member.id)}
                          className="btn btn-ghost btn-sm btn-square h-9 min-h-9 text-base-content/45"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-base-content/10 px-4 py-3">
          <span
            className={`min-h-4 pr-3 text-[11px] ${
              error ? "text-error" : "text-base-content/40"
            }`}
          >
            {error || "\u00A0"}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={requestClose}
              className="btn btn-ghost btn-sm h-9 min-h-9"
            >
              {messages.common.cancel}
            </button>
            <button
              type="button"
              onClick={() => {
                void handleSubmit();
              }}
              disabled={isSaving}
              className="btn btn-primary btn-sm h-9 min-h-9 px-4 font-mono"
            >
              {isSaving
                ? messages.keyBrowser.creating
                : messages.keyBrowser.createSubmit}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function JsonCodeEditor({
  value,
  onChange,
  className = "h-72",
  surfaceClassName = "bg-base-200",
  autoFocus = false,
  mode = "json",
  wordWrap = true,
  syntaxHighlightingEnabled = true,
}: JsonCodeEditorProps) {
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
  className = "h-72",
  surfaceClassName = "bg-base-200",
  autoFocus = false,
  wordWrap = true,
}: JsonCodeEditorProps) {
  return (
    <div
      className={`relative w-full overflow-visible rounded-xl ${className}`}
    >
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
