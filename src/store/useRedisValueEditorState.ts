import { useCallback, type Dispatch, type SetStateAction } from "react";
import {
  deleteRedisHashEntry,
  deleteRedisZSetEntry,
  runRedisCommand,
  updateRedisHashEntry,
  updateRedisJsonValue,
  updateRedisStringValue,
  updateRedisZSetEntry,
} from "../lib/redis";
import {
  recordAuditEvent,
  recordCrashReport,
  recordTelemetryEvent,
} from "../lib/privacyRuntime";
import type { KeyValue, RedisConnection } from "../types";

function escapeRedisCommandArgument(value: string) {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

interface UseRedisValueEditorStateOptions {
  activeConnection?: RedisConnection;
  keyValue: KeyValue | null;
  notConnectedMessage: string;
  onRefreshKeys: () => Promise<void>;
  removeKeyFromState: (key: string) => void;
  selectedDb: number;
  setKeyValue: Dispatch<SetStateAction<KeyValue | null>>;
}

export function useRedisValueEditorState({
  activeConnection,
  keyValue,
  notConnectedMessage,
  onRefreshKeys,
  removeKeyFromState,
  selectedDb,
  setKeyValue,
}: UseRedisValueEditorStateOptions) {
  const updateKeyTtl = useCallback(
    async (key: string, nextTtl: number) => {
      if (!activeConnection) {
        throw new Error(notConnectedMessage);
      }

      if (!Number.isInteger(nextTtl) || nextTtl < -1 || nextTtl === 0) {
        throw new Error("TTL must be -1 or a positive integer");
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
      if (!activeConnection) {
        throw new Error(notConnectedMessage);
      }

      if (!nextField.length) {
        throw new Error("Field cannot be empty");
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

      setKeyValue((previous) => {
        if (
          !previous ||
          previous.key !== key ||
          previous.type !== "hash" ||
          !previous.value ||
          typeof previous.value !== "object" ||
          Array.isArray(previous.value)
        ) {
          return previous;
        }

        const nextEntries = Object.entries(previous.value as Record<string, string>)
          .map(([field, value]) =>
            field === oldField
              ? ([nextField, nextValue] as const)
              : ([field, value] as const)
          );

        return {
          ...previous,
          value: Object.fromEntries(nextEntries),
        };
      });
    },
    [
      activeConnection,
      keyValue?.type,
      keyValue?.value,
      notConnectedMessage,
      selectedDb,
      setKeyValue,
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
      if (!activeConnection) {
        throw new Error(notConnectedMessage);
      }

      if (!key.length) {
        throw new Error("Key name cannot be empty");
      }

      await runRedisCommand(
        { ...activeConnection, db: selectedDb },
        `DEL ${escapeRedisCommandArgument(key)}`
      );
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
      if (!activeConnection) {
        throw new Error(notConnectedMessage);
      }

      if (!field.length) {
        throw new Error("Field cannot be empty");
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

      setKeyValue((previous) => {
        if (
          !previous ||
          previous.key !== key ||
          previous.type !== "hash" ||
          !previous.value ||
          typeof previous.value !== "object" ||
          Array.isArray(previous.value)
        ) {
          return previous;
        }

        const nextEntries = Object.entries(previous.value as Record<string, string>).filter(
          ([entryField]) => entryField !== field
        );

        if (!nextEntries.length) {
          return null;
        }

        return {
          ...previous,
          value: Object.fromEntries(nextEntries),
        };
      });

      const currentEntries =
        keyValue?.key === key &&
        keyValue.type === "hash" &&
        keyValue.value &&
        typeof keyValue.value === "object" &&
        !Array.isArray(keyValue.value)
          ? (keyValue.value as Record<string, string>)
          : null;

      if (currentEntries && Object.keys(currentEntries).length <= 1) {
        removeKeyFromState(key);
      }
    },
    [
      activeConnection,
      keyValue,
      notConnectedMessage,
      removeKeyFromState,
      selectedDb,
      setKeyValue,
    ]
  );

  const updateZSetEntry = useCallback(
    async (
      key: string,
      oldMember: string,
      nextMember: string,
      nextScore: number
    ) => {
      if (!activeConnection) {
        throw new Error(notConnectedMessage);
      }

      if (!nextMember.length) {
        throw new Error("Member cannot be empty");
      }

      if (!Number.isFinite(nextScore)) {
        throw new Error("Score must be a finite number");
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

      setKeyValue((previous) => {
        if (
          !previous ||
          previous.key !== key ||
          previous.type !== "zset" ||
          !Array.isArray(previous.value)
        ) {
          return previous;
        }

        const nextMembers = (previous.value as Array<{ member: string; score: number }>)
          .map((item) =>
            item.member === oldMember
              ? {
                  member: nextMember,
                  score: nextScore,
                }
              : item
          )
          .sort((left, right) => {
            if (left.score === right.score) {
              return left.member.localeCompare(right.member);
            }

            return left.score - right.score;
          });

        return {
          ...previous,
          value: nextMembers,
        };
      });
    },
    [
      activeConnection,
      keyValue?.type,
      keyValue?.value,
      notConnectedMessage,
      selectedDb,
      setKeyValue,
    ]
  );

  const deleteZSetEntry = useCallback(
    async (key: string, member: string) => {
      if (!activeConnection) {
        throw new Error(notConnectedMessage);
      }

      if (!member.length) {
        throw new Error("Member cannot be empty");
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

      setKeyValue((previous) => {
        if (
          !previous ||
          previous.key !== key ||
          previous.type !== "zset" ||
          !Array.isArray(previous.value)
        ) {
          return previous;
        }

        const nextMembers = (previous.value as Array<{ member: string; score: number }>).filter(
          (item) => item.member !== member
        );

        if (!nextMembers.length) {
          return null;
        }

        return {
          ...previous,
          value: nextMembers,
        };
      });

      const currentMembers =
        keyValue?.key === key &&
        keyValue.type === "zset" &&
        Array.isArray(keyValue.value)
          ? (keyValue.value as Array<{ member: string; score: number }>)
          : null;

      if (currentMembers && currentMembers.length <= 1) {
        removeKeyFromState(key);
      }
    },
    [
      activeConnection,
      keyValue,
      notConnectedMessage,
      removeKeyFromState,
      selectedDb,
      setKeyValue,
    ]
  );

  return {
    deleteHashEntry,
    deleteKey,
    deleteZSetEntry,
    updateHashEntry,
    updateJsonValue,
    updateKeyTtl,
    updateStringValue,
    updateZSetEntry,
  };
}
