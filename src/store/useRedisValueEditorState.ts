import { useCallback, type Dispatch, type SetStateAction } from "react";
import { getCurrentMessages } from "../i18n";
import {
  addRedisHashEntry,
  addRedisSetMember,
  addRedisZSetEntry,
  appendRedisListValue,
  deleteRedisKey,
  deleteRedisHashEntry,
  deleteRedisListValue,
  deleteRedisZSetEntry,
  escapeRedisCommandArgument,
  runRedisCommand,
  type RedisListInsertPosition,
  updateRedisHashEntry,
  updateRedisJsonValue,
  updateRedisListValue,
  updateRedisStringValue,
  updateRedisZSetEntry,
} from "../lib/redis";
import {
  recordAuditEvent,
  recordCrashReport,
  recordTelemetryEvent,
} from "../lib/privacyRuntime";
import type { KeyValue, RedisConnection } from "../types";

interface UseRedisValueEditorStateOptions {
  activeConnection?: RedisConnection;
  keyValue: KeyValue | null;
  onRefreshKeyValue: () => Promise<void>;
  notConnectedMessage: string;
  onRefreshKeys: () => Promise<void>;
  removeKeyFromState: (key: string) => void;
  selectedDb: number;
  setKeyValue: Dispatch<SetStateAction<KeyValue | null>>;
}

export function useRedisValueEditorState({
  activeConnection,
  keyValue,
  onRefreshKeyValue,
  notConnectedMessage,
  onRefreshKeys,
  removeKeyFromState,
  selectedDb,
  setKeyValue,
}: UseRedisValueEditorStateOptions) {
  const refreshCurrentKeyValue = useCallback(async () => {
    await onRefreshKeyValue();
  }, [onRefreshKeyValue]);

  const getCurrentCollectionCount = useCallback(
    (expectedKey: string, expectedType: KeyValue["type"]) => {
      if (!keyValue || keyValue.key !== expectedKey || keyValue.type !== expectedType) {
        return null;
      }

      if (typeof keyValue.page?.totalCount === "number") {
        return keyValue.page.totalCount;
      }

      if (Array.isArray(keyValue.value)) {
        return keyValue.value.length;
      }

      if (keyValue.value && typeof keyValue.value === "object") {
        return Object.keys(keyValue.value).length;
      }

      return null;
    },
    [keyValue]
  );

  const addHashEntry = useCallback(
    async (key: string, field: string, value: string) => {
      const messages = getCurrentMessages();
      if (!activeConnection) {
        throw new Error(notConnectedMessage);
      }

      if (!field.length) {
        throw new Error(messages.ui.errors.fieldRequired);
      }

      await addRedisHashEntry(
        { ...activeConnection, db: selectedDb },
        key,
        {
          field,
          value,
        }
      );
      void recordTelemetryEvent("editor.hash.add");
      void recordAuditEvent("editor.hash.add", { key, field });
      await refreshCurrentKeyValue();
    },
    [activeConnection, notConnectedMessage, refreshCurrentKeyValue, selectedDb]
  );

  const appendListValue = useCallback(
    async (key: string, value: string, position: RedisListInsertPosition = "tail") => {
      const messages = getCurrentMessages();
      if (!activeConnection) {
        throw new Error(notConnectedMessage);
      }

      if (!value.length) {
        throw new Error(messages.ui.errors.valueRequired);
      }

      await appendRedisListValue(
        { ...activeConnection, db: selectedDb },
        key,
        { value, position }
      );
      void recordTelemetryEvent("editor.list.add");
      void recordAuditEvent("editor.list.add", { key, position });
      await refreshCurrentKeyValue();
    },
    [activeConnection, notConnectedMessage, refreshCurrentKeyValue, selectedDb]
  );

  const updateListValue = useCallback(
    async (key: string, index: number, value: string) => {
      const messages = getCurrentMessages();
      if (!activeConnection) {
        throw new Error(notConnectedMessage);
      }

      if (!Number.isInteger(index) || index < 0) {
        throw new Error(messages.ui.errors.indexInvalid);
      }

      if (!value.length) {
        throw new Error(messages.ui.errors.valueRequired);
      }

      await updateRedisListValue(
        { ...activeConnection, db: selectedDb },
        key,
        { index, value }
      );
      void recordTelemetryEvent("editor.list.update");
      void recordAuditEvent("editor.list.update", { key, index });
      await refreshCurrentKeyValue();
    },
    [activeConnection, notConnectedMessage, refreshCurrentKeyValue, selectedDb]
  );

  const deleteListValue = useCallback(
    async (key: string, index: number) => {
      const messages = getCurrentMessages();
      if (!activeConnection) {
        throw new Error(notConnectedMessage);
      }

      if (!Number.isInteger(index) || index < 0) {
        throw new Error(messages.ui.errors.indexInvalid);
      }

      await deleteRedisListValue(
        { ...activeConnection, db: selectedDb },
        key,
        { index }
      );
      void recordTelemetryEvent("editor.list.delete");
      void recordAuditEvent("editor.list.delete", { key, index });

      const currentCount = getCurrentCollectionCount(key, "list");
      if (currentCount !== null && currentCount <= 1) {
        removeKeyFromState(key);
        return;
      }

      await refreshCurrentKeyValue();
    },
    [
      activeConnection,
      getCurrentCollectionCount,
      notConnectedMessage,
      refreshCurrentKeyValue,
      removeKeyFromState,
      selectedDb,
    ]
  );

  const addSetMember = useCallback(
    async (key: string, member: string) => {
      const messages = getCurrentMessages();
      if (!activeConnection) {
        throw new Error(notConnectedMessage);
      }

      if (!member.length) {
        throw new Error(messages.ui.errors.memberRequired);
      }

      await addRedisSetMember(
        { ...activeConnection, db: selectedDb },
        key,
        { member }
      );
      void recordTelemetryEvent("editor.set.add");
      void recordAuditEvent("editor.set.add", { key });
      await refreshCurrentKeyValue();
    },
    [activeConnection, notConnectedMessage, refreshCurrentKeyValue, selectedDb]
  );

  const updateKeyTtl = useCallback(
    async (key: string, nextTtl: number) => {
      const messages = getCurrentMessages();
      if (!activeConnection) {
        throw new Error(notConnectedMessage);
      }

      if (!Number.isInteger(nextTtl) || nextTtl < -1 || nextTtl === 0) {
        throw new Error(messages.keyBrowser.ttlInvalid);
      }

      const escapedKey = escapeRedisCommandArgument(key);
      const command =
        nextTtl === -1
          ? `PERSIST ${escapedKey}`
          : `EXPIRE ${escapedKey} ${nextTtl}`;

      try {
        await runRedisCommand(
          { ...activeConnection, db: selectedDb },
          command
        );
      } catch (error) {
        void recordCrashReport("editor.ttl.update", error);
        throw error;
      }

      void recordTelemetryEvent("editor.ttl.update");
      void recordAuditEvent("editor.ttl.update", {
        key,
        ttl: nextTtl,
      });

      await onRefreshKeys();
    },
    [activeConnection, notConnectedMessage, onRefreshKeys, selectedDb]
  );

  const updateHashEntry = useCallback(
    async (
      key: string,
      oldField: string,
      nextField: string,
      nextValue: string
    ) => {
      const messages = getCurrentMessages();
      if (!activeConnection) {
        throw new Error(notConnectedMessage);
      }

      if (!nextField.length) {
        throw new Error(messages.ui.errors.fieldRequired);
      }

      if (oldField === nextField && keyValue?.type === "hash") {
        const currentEntries =
          keyValue.value &&
          typeof keyValue.value === "object" &&
          !Array.isArray(keyValue.value)
            ? (keyValue.value as Record<string, string>)
            : null;

        if (currentEntries?.[oldField] === nextValue) {
          return;
        }
      }

      await updateRedisHashEntry(
        { ...activeConnection, db: selectedDb },
        key,
        {
          oldField,
          newField: nextField,
          value: nextValue,
        }
      );
      void recordTelemetryEvent("editor.hash.update");
      void recordAuditEvent("editor.hash.update", {
        key,
      });
      await refreshCurrentKeyValue();
    },
    [
      activeConnection,
      keyValue?.type,
      keyValue?.value,
      notConnectedMessage,
      refreshCurrentKeyValue,
      selectedDb,
    ]
  );

  const updateStringValue = useCallback(
    async (key: string, nextValue: string) => {
      if (!activeConnection) {
        throw new Error(notConnectedMessage);
      }

      if (
        keyValue?.key === key &&
        keyValue.type === "string" &&
        typeof keyValue.value === "string" &&
        keyValue.value === nextValue
      ) {
        return;
      }

      await updateRedisStringValue(
        { ...activeConnection, db: selectedDb },
        key,
        { value: nextValue }
      );
      void recordTelemetryEvent("editor.string.save");
      void recordAuditEvent("editor.string.save", {
        key,
      });

      setKeyValue((previous) => {
        if (
          !previous ||
          previous.key !== key ||
          previous.type !== "string" ||
          typeof previous.value !== "string"
        ) {
          return previous;
        }

        return {
          ...previous,
          value: nextValue,
        };
      });
    },
    [activeConnection, keyValue, notConnectedMessage, selectedDb, setKeyValue]
  );

  const updateJsonValue = useCallback(
    async (key: string, nextValue: string) => {
      if (!activeConnection) {
        throw new Error(notConnectedMessage);
      }

      if (
        keyValue?.key === key &&
        keyValue.type === "json" &&
        typeof keyValue.value === "string" &&
        keyValue.value === nextValue
      ) {
        return;
      }

      await updateRedisJsonValue(
        { ...activeConnection, db: selectedDb },
        key,
        { value: nextValue }
      );
      void recordTelemetryEvent("editor.json.save");
      void recordAuditEvent("editor.json.save", {
        key,
      });

      setKeyValue((previous) => {
        if (
          !previous ||
          previous.key !== key ||
          previous.type !== "json" ||
          typeof previous.value !== "string"
        ) {
          return previous;
        }

        return {
          ...previous,
          value: nextValue,
        };
      });
    },
    [activeConnection, keyValue, notConnectedMessage, selectedDb, setKeyValue]
  );

  const deleteKey = useCallback(
    async (key: string) => {
      const messages = getCurrentMessages();
      if (!activeConnection) {
        throw new Error(notConnectedMessage);
      }

      if (!key.length) {
        throw new Error(messages.keyBrowser.keyNameRequired);
      }

      await deleteRedisKey({ ...activeConnection, db: selectedDb }, key);
      void recordTelemetryEvent("editor.key.delete");
      void recordAuditEvent("editor.key.delete", {
        key,
      });
      removeKeyFromState(key);
    },
    [activeConnection, notConnectedMessage, removeKeyFromState, selectedDb]
  );

  const deleteHashEntry = useCallback(
    async (key: string, field: string) => {
      const messages = getCurrentMessages();
      if (!activeConnection) {
        throw new Error(notConnectedMessage);
      }

      if (!field.length) {
        throw new Error(messages.ui.errors.fieldRequired);
      }

      await deleteRedisHashEntry(
        { ...activeConnection, db: selectedDb },
        key,
        { field }
      );
      void recordTelemetryEvent("editor.hash.delete");
      void recordAuditEvent("editor.hash.delete", {
        key,
      });

      const currentCount = getCurrentCollectionCount(key, "hash");
      if (currentCount !== null && currentCount <= 1) {
        removeKeyFromState(key);
        return;
      }

      await refreshCurrentKeyValue();
    },
    [
      activeConnection,
      getCurrentCollectionCount,
      notConnectedMessage,
      refreshCurrentKeyValue,
      removeKeyFromState,
      selectedDb,
    ]
  );

  const updateZSetEntry = useCallback(
    async (
      key: string,
      oldMember: string,
      nextMember: string,
      nextScore: number
    ) => {
      const messages = getCurrentMessages();
      if (!activeConnection) {
        throw new Error(notConnectedMessage);
      }

      if (!nextMember.length) {
        throw new Error(messages.ui.errors.memberRequired);
      }

      if (!Number.isFinite(nextScore)) {
        throw new Error(messages.keyBrowser.scoreInvalid);
      }

      if (keyValue?.type === "zset" && Array.isArray(keyValue.value)) {
        const currentMember = (
          keyValue.value as Array<{ member: string; score: number }>
        ).find((item) => item.member === oldMember);

        if (
          currentMember &&
          currentMember.member === nextMember &&
          currentMember.score === nextScore
        ) {
          return;
        }
      }

      await updateRedisZSetEntry(
        { ...activeConnection, db: selectedDb },
        key,
        {
          oldMember,
          newMember: nextMember,
          score: nextScore,
        }
      );
      void recordTelemetryEvent("editor.zset.update");
      void recordAuditEvent("editor.zset.update", {
        key,
      });
      await refreshCurrentKeyValue();
    },
    [
      activeConnection,
      keyValue?.type,
      keyValue?.value,
      notConnectedMessage,
      refreshCurrentKeyValue,
      selectedDb,
    ]
  );

  const deleteZSetEntry = useCallback(
    async (key: string, member: string) => {
      const messages = getCurrentMessages();
      if (!activeConnection) {
        throw new Error(notConnectedMessage);
      }

      if (!member.length) {
        throw new Error(messages.ui.errors.memberRequired);
      }

      await deleteRedisZSetEntry(
        { ...activeConnection, db: selectedDb },
        key,
        { member }
      );
      void recordTelemetryEvent("editor.zset.delete");
      void recordAuditEvent("editor.zset.delete", {
        key,
      });

      const currentCount = getCurrentCollectionCount(key, "zset");
      if (currentCount !== null && currentCount <= 1) {
        removeKeyFromState(key);
        return;
      }

      await refreshCurrentKeyValue();
    },
    [
      activeConnection,
      getCurrentCollectionCount,
      notConnectedMessage,
      refreshCurrentKeyValue,
      removeKeyFromState,
      selectedDb,
    ]
  );

  const addZSetEntry = useCallback(
    async (key: string, member: string, score: number) => {
      const messages = getCurrentMessages();
      if (!activeConnection) {
        throw new Error(notConnectedMessage);
      }

      if (!member.length) {
        throw new Error(messages.ui.errors.memberRequired);
      }

      if (!Number.isFinite(score)) {
        throw new Error(messages.keyBrowser.scoreInvalid);
      }

      await addRedisZSetEntry(
        { ...activeConnection, db: selectedDb },
        key,
        { member, score }
      );
      void recordTelemetryEvent("editor.zset.add");
      void recordAuditEvent("editor.zset.add", { key, member });
      await refreshCurrentKeyValue();
    },
    [activeConnection, notConnectedMessage, refreshCurrentKeyValue, selectedDb]
  );

  return {
    addHashEntry,
    addSetMember,
    addZSetEntry,
    appendListValue,
    deleteHashEntry,
    deleteKey,
    deleteListValue,
    deleteZSetEntry,
    updateHashEntry,
    updateJsonValue,
    updateKeyTtl,
    updateListValue,
    updateStringValue,
    updateZSetEntry,
  };
}
