import {
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
import { useModalTransition } from "../hooks/useModalTransition";
import {
  getRedisErrorMessage,
  type RedisKeyCreateEntryInput,
  type RedisKeyCreateInput,
  type RedisKeyCreateMemberInput,
} from "../lib/redis";
import type { RedisKey, RedisKeyType } from "../types";
import { useToast } from "./ToastProvider";

interface CreateKeyModalProps {
  defaultTtl: string;
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

export function CreateKeyModal({
  defaultTtl,
  onClose,
  onCreateKey,
  onCreated,
}: CreateKeyModalProps) {
  const { messages } = useI18n();
  const { showToast } = useToast();
  const { isVisible, requestClose, handleBackdropClick } =
    useModalTransition(onClose);
  const nextDraftIdRef = useRef(5);
  const keyInputRef = useRef<HTMLInputElement | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [keyName, setKeyName] = useState("");
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

  return (
    <div
      onClick={handleBackdropClick}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity duration-200 ease-out motion-reduce:transition-none ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        className={`mx-4 w-full max-w-2xl overflow-hidden rounded-2xl border border-base-content/10 bg-base-200 shadow-2xl transition-all duration-200 ease-out motion-reduce:transition-none ${
          isVisible
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-3 scale-[0.98] opacity-0"
        }`}
      >
        <div className="flex items-center justify-between border-b border-base-content/10 px-5 py-4">
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

        <div className="grid gap-4 px-5 py-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="md:col-span-2">
              <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-wider text-base-content/50">
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
                className="input input-sm w-full bg-base-300 border-base-100/50 font-mono text-sm user-select-text"
                spellCheck={false}
              />
            </label>
            <label>
              <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-wider text-base-content/50">
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
                className="input input-sm w-full bg-base-300 border-base-100/50 font-mono text-sm user-select-text"
              />
            </label>
          </div>

          <label>
            <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-wider text-base-content/50">
              {messages.keyBrowser.type}
            </span>
            <select
              value={keyType}
              onChange={(event) => {
                resetError();
                setKeyType(event.target.value as RedisKeyType);
              }}
              className="select select-sm w-full bg-base-300 border-base-100/50 font-mono text-sm"
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

          {keyType === "string" ? (
            <label>
              <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-wider text-base-content/50">
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
                className="textarea textarea-sm min-h-28 w-full resize-y bg-base-300 border-base-100/50 font-mono text-sm leading-6 user-select-text"
                spellCheck={false}
              />
            </label>
          ) : null}

          {keyType === "json" ? (
            <label>
              <span className="mb-1.5 block text-[10px] font-mono uppercase tracking-wider text-base-content/50">
                {messages.valueEditor.value}
              </span>
              <textarea
                rows={8}
                value={jsonValue}
                onChange={(event) => {
                  resetError();
                  setJsonValue(event.target.value);
                }}
                placeholder={messages.keyBrowser.jsonPlaceholder}
                className="textarea textarea-sm min-h-44 w-full resize-y bg-base-300 border-base-100/50 font-mono text-sm leading-6 user-select-text"
                spellCheck={false}
              />
            </label>
          ) : null}

          {keyType === "list" || keyType === "set" ? (
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-base-content/50">
                  {messages.keyBrowser.values}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    (keyType === "list" ? setListValues : setSetValues)((previous) => [
                      ...previous,
                      createTextValueDraft(nextDraftId()),
                    ])
                  }
                  className="btn btn-ghost btn-xs gap-1 px-2"
                >
                  <Plus size={12} />
                  {messages.keyBrowser.addValue}
                </button>
              </div>
              {(keyType === "list" ? listValues : setValues).map((item, index) => (
                <div key={item.id} className="flex items-center gap-2">
                  <span className="w-7 shrink-0 text-center text-[11px] font-mono text-base-content/45">
                    {index + 1}
                  </span>
                  <input
                    type="text"
                    value={item.value}
                    onChange={(event) =>
                      updateTextValue(
                        keyType === "list" ? setListValues : setSetValues,
                        item.id,
                        event.target.value
                      )
                    }
                    placeholder={messages.keyBrowser.valuePlaceholder}
                    className="input input-sm flex-1 bg-base-300 border-base-100/50 font-mono text-sm user-select-text"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      removeTextValue(
                        keyType === "list" ? setListValues : setSetValues,
                        item.id
                      )
                    }
                    className="btn btn-ghost btn-sm btn-square text-base-content/50"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {keyType === "hash" || keyType === "stream" ? (
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-base-content/50">
                  {messages.keyBrowser.entries}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    (keyType === "hash" ? setHashEntries : setStreamEntries)(
                      (previous) => [
                        ...previous,
                        createFieldValueDraft(nextDraftId()),
                      ]
                    )
                  }
                  className="btn btn-ghost btn-xs gap-1 px-2"
                >
                  <Plus size={12} />
                  {messages.keyBrowser.addEntry}
                </button>
              </div>
              {(keyType === "hash" ? hashEntries : streamEntries).map((entry) => (
                <div key={entry.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-2">
                  <input
                    type="text"
                    value={entry.field}
                    onChange={(event) =>
                      updateFieldValue(
                        keyType === "hash" ? setHashEntries : setStreamEntries,
                        entry.id,
                        "field",
                        event.target.value
                      )
                    }
                    placeholder={messages.keyBrowser.fieldPlaceholder}
                    className="input input-sm bg-base-300 border-base-100/50 font-mono text-sm user-select-text"
                    spellCheck={false}
                  />
                  <input
                    type="text"
                    value={entry.value}
                    onChange={(event) =>
                      updateFieldValue(
                        keyType === "hash" ? setHashEntries : setStreamEntries,
                        entry.id,
                        "value",
                        event.target.value
                      )
                    }
                    placeholder={messages.keyBrowser.valuePlaceholder}
                    className="input input-sm bg-base-300 border-base-100/50 font-mono text-sm user-select-text"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      removeFieldValue(
                        keyType === "hash" ? setHashEntries : setStreamEntries,
                        entry.id
                      )
                    }
                    className="btn btn-ghost btn-sm btn-square text-base-content/50"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {keyType === "zset" ? (
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
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
                  className="btn btn-ghost btn-xs gap-1 px-2"
                >
                  <Plus size={12} />
                  {messages.keyBrowser.addMember}
                </button>
              </div>
              {zsetMembers.map((member) => (
                <div key={member.id} className="grid grid-cols-[minmax(0,1.4fr)_minmax(120px,0.8fr)_auto] gap-2">
                  <input
                    type="text"
                    value={member.member}
                    onChange={(event) =>
                      updateMemberValue(member.id, "member", event.target.value)
                    }
                    placeholder={messages.keyBrowser.memberPlaceholder}
                    className="input input-sm bg-base-300 border-base-100/50 font-mono text-sm user-select-text"
                    spellCheck={false}
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    value={member.score}
                    onChange={(event) =>
                      updateMemberValue(member.id, "score", event.target.value)
                    }
                    placeholder="0"
                    className="input input-sm bg-base-300 border-base-100/50 font-mono text-sm user-select-text"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => removeMemberValue(member.id)}
                    className="btn btn-ghost btn-sm btn-square text-base-content/50"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-base-content/10 px-5 py-4">
          <span
            className={`min-h-4 text-[11px] ${
              error ? "text-error" : "text-base-content/40"
            }`}
          >
            {error || messages.keyBrowser.ttlHint}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={requestClose}
              className="btn btn-ghost btn-sm"
            >
              {messages.common.cancel}
            </button>
            <button
              type="button"
              onClick={() => {
                void handleSubmit();
              }}
              disabled={isSaving}
              className="btn btn-primary btn-sm font-mono"
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
