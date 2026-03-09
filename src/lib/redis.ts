import { invoke } from "@tauri-apps/api/core";
import type {
  KeyValue,
  RedisConnection,
  RedisKey,
  RedisKeyType,
} from "../types";

export interface RedisKeyRenamePair {
  oldKey: string;
  newKey: string;
}

export interface RedisHashEntryUpdate {
  oldField: string;
  newField: string;
  value: string;
}

export interface RedisZSetEntryUpdate {
  oldMember: string;
  newMember: string;
  score: number;
}

export interface RedisHashEntryDelete {
  field: string;
}

export interface RedisZSetEntryDelete {
  member: string;
}

export interface RedisStringValueUpdate {
  value: string;
}

export interface RedisJsonValueUpdate {
  value: string;
}

export interface RedisKeyCreateEntryInput {
  field: string;
  value: string;
}

export interface RedisKeyCreateMemberInput {
  member: string;
  score: number;
}

export interface RedisKeyCreateInput {
  key: string;
  type: RedisKeyType;
  ttl?: number;
  value?: string;
  values?: string[];
  entries?: RedisKeyCreateEntryInput[];
  members?: RedisKeyCreateMemberInput[];
}

export interface ListRedisKeysOptions {
  scanCount?: number;
  maxKeys?: number;
}

type RedisConnectionInvokeInput = Pick<
  RedisConnection,
  "host" | "port" | "username" | "db" | "tls" | "sshTunnel"
> & {
  password?: string;
};

function toConnectionInput(connection: RedisConnectionInvokeInput) {
  const sshTunnel = connection.sshTunnel;

  return {
    host: connection.host.trim(),
    port: connection.port,
    username: connection.username?.trim() || null,
    password: connection.password?.trim() || null,
    db: connection.db,
    tls: connection.tls,
    sshTunnel: sshTunnel
      ? {
          host: sshTunnel.host.trim(),
          port: sshTunnel.port,
          username: sshTunnel.username.trim(),
          password: sshTunnel.password?.trim() || null,
          privateKeyPath: sshTunnel.privateKeyPath?.trim() || null,
          passphrase: sshTunnel.passphrase || null,
        }
      : null,
  };
}

export function escapeRedisCommandArgument(value: string) {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

export function getRedisErrorMessage(error: unknown) {
  if (typeof error === "string") return error;

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return String(error ?? "");
}

export async function testRedisConnection(
  connection: RedisConnectionInvokeInput
) {
  await invoke("test_redis_connection", {
    input: toConnectionInput(connection),
  });
}

export async function listRedisKeys(
  connection: RedisConnectionInvokeInput,
  options: ListRedisKeysOptions = {}
): Promise<RedisKey[]> {
  return invoke("list_redis_keys", {
    input: {
      connection: toConnectionInput(connection),
      scanCount: options.scanCount,
      maxKeys: options.maxKeys,
    },
  });
}

export async function getRedisKeyValue(
  connection: RedisConnectionInvokeInput,
  key: string
): Promise<KeyValue> {
  return invoke("get_redis_key_value", {
    input: {
      connection: toConnectionInput(connection),
      key,
    },
  });
}

export async function createRedisKey(
  connection: RedisConnectionInvokeInput,
  input: RedisKeyCreateInput
): Promise<RedisKey> {
  return invoke("create_redis_key", {
    input: {
      connection: toConnectionInput(connection),
      key: input.key,
      type: input.type,
      ttl: input.ttl ?? null,
      value: input.value ?? null,
      values: input.values ?? null,
      entries: input.entries ?? null,
      members: input.members ?? null,
    },
  });
}

export async function runRedisCommand(
  connection: RedisConnectionInvokeInput,
  command: string
): Promise<string> {
  return invoke("run_redis_command", {
    input: {
      connection: toConnectionInput(connection),
      command,
    },
  });
}

export async function deleteRedisKeys(
  connection: RedisConnectionInvokeInput,
  keys: string[]
) {
  const uniqueKeys = Array.from(
    new Set(keys.map((key) => key.trim()).filter(Boolean))
  );

  if (!uniqueKeys.length) {
    return;
  }

  const chunkSize = 256;

  for (let index = 0; index < uniqueKeys.length; index += chunkSize) {
    const chunk = uniqueKeys
      .slice(index, index + chunkSize)
      .map(escapeRedisCommandArgument)
      .join(" ");

    await runRedisCommand(connection, `DEL ${chunk}`);
  }
}

export async function deleteRedisKey(
  connection: RedisConnectionInvokeInput,
  key: string
) {
  await deleteRedisKeys(connection, [key]);
}

export async function renameRedisKey(
  connection: RedisConnectionInvokeInput,
  oldKey: string,
  newKey: string
) {
  await invoke("rename_redis_key", {
    input: {
      connection: toConnectionInput(connection),
      oldKey,
      newKey,
    },
  });
}

export async function renameRedisKeys(
  connection: RedisConnectionInvokeInput,
  renames: RedisKeyRenamePair[]
) {
  await invoke("rename_redis_keys", {
    input: {
      connection: toConnectionInput(connection),
      renames,
    },
  });
}

export async function updateRedisHashEntry(
  connection: RedisConnectionInvokeInput,
  key: string,
  update: RedisHashEntryUpdate
) {
  await invoke("update_redis_hash_entry", {
    input: {
      connection: toConnectionInput(connection),
      key,
      oldField: update.oldField,
      newField: update.newField,
      value: update.value,
    },
  });
}

export async function updateRedisZSetEntry(
  connection: RedisConnectionInvokeInput,
  key: string,
  update: RedisZSetEntryUpdate
) {
  await invoke("update_redis_zset_entry", {
    input: {
      connection: toConnectionInput(connection),
      key,
      oldMember: update.oldMember,
      newMember: update.newMember,
      score: update.score,
    },
  });
}

export async function deleteRedisHashEntry(
  connection: RedisConnectionInvokeInput,
  key: string,
  entry: RedisHashEntryDelete
) {
  await invoke("delete_redis_hash_entry", {
    input: {
      connection: toConnectionInput(connection),
      key,
      field: entry.field,
    },
  });
}

export async function deleteRedisZSetEntry(
  connection: RedisConnectionInvokeInput,
  key: string,
  entry: RedisZSetEntryDelete
) {
  await invoke("delete_redis_zset_entry", {
    input: {
      connection: toConnectionInput(connection),
      key,
      member: entry.member,
    },
  });
}

export async function updateRedisStringValue(
  connection: RedisConnectionInvokeInput,
  key: string,
  update: RedisStringValueUpdate
) {
  await invoke("update_redis_string_value", {
    input: {
      connection: toConnectionInput(connection),
      key,
      value: update.value,
    },
  });
}

export async function updateRedisJsonValue(
  connection: RedisConnectionInvokeInput,
  key: string,
  update: RedisJsonValueUpdate
) {
  await invoke("update_redis_json_value", {
    input: {
      connection: toConnectionInput(connection),
      key,
      value: update.value,
    },
  });
}
