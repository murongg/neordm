import { invoke } from "@tauri-apps/api/core";
import type { KeyValue, RedisConnection, RedisKey } from "../types";

export interface RedisKeyRenamePair {
  oldKey: string;
  newKey: string;
}

type RedisConnectionInvokeInput = Pick<
  RedisConnection,
  "host" | "port" | "db" | "tls"
> & {
  password?: string;
};

function toConnectionInput(connection: RedisConnectionInvokeInput) {
  return {
    host: connection.host.trim(),
    port: connection.port,
    password: connection.password?.trim() || null,
    db: connection.db,
    tls: connection.tls,
  };
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
  connection: RedisConnectionInvokeInput
): Promise<RedisKey[]> {
  return invoke("list_redis_keys", {
    input: toConnectionInput(connection),
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
