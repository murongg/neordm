import { invoke } from "@tauri-apps/api/core";
import type {
  KeyValue,
  KeyValuePageState,
  RedisConnection,
  RedisClusterTopologyNode,
  RedisPubSubEvent,
  RedisKey,
  RedisKeyType,
  RedisStreamConsumer,
  RedisStreamConsumerGroup,
  RedisStreamEntriesResult,
  RedisStreamPendingEntry,
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

export interface RedisHashEntryAdd {
  field: string;
  value: string;
}

export interface RedisZSetEntryUpdate {
  oldMember: string;
  newMember: string;
  score: number;
}

export interface RedisZSetEntryAdd {
  member: string;
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

export type RedisListInsertPosition = "head" | "tail";

export interface RedisListValueAppend {
  value: string;
  position?: RedisListInsertPosition;
}

export interface RedisListValueUpdate {
  index: number;
  value: string;
}

export interface RedisListValueDelete {
  index: number;
}

export interface RedisSetMemberAdd {
  member: string;
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
  clusterNodeAddress?: string | null;
}

export interface RedisKeysScanPageOptions {
  scanCount?: number;
  pageSize?: number;
  cursor?: string | null;
  clusterNodeAddress?: string | null;
}

export interface RedisKeysScanPage {
  keys: RedisKey[];
  nextCursor: string | null;
}

export interface RedisKeyValuePageOptions {
  pageSize?: number;
  cursor?: string | null;
}

export interface RedisStreamEntriesOptions {
  pageSize?: number;
  cursor?: string | null;
}

export interface RedisKeyValuePage extends KeyValue {
  page: KeyValuePageState;
}

export const REDIS_PUBSUB_EVENT = "redis://pubsub";

type RedisConnectionInvokeInput = Pick<
  RedisConnection,
  | "host"
  | "port"
  | "mode"
  | "sentinel"
  | "cluster"
  | "username"
  | "db"
  | "tls"
  | "sshTunnel"
> & {
  password?: string;
};

function toConnectionInput(connection: RedisConnectionInvokeInput) {
  const sshTunnel = connection.sshTunnel;
  const sentinel = connection.mode === "sentinel" ? connection.sentinel : undefined;
  const cluster = connection.mode === "cluster" ? connection.cluster : undefined;

  return {
    host: connection.host.trim(),
    port: connection.port,
    mode: connection.mode ?? "direct",
    sentinel: sentinel
      ? {
          masterName: sentinel.masterName.trim(),
          nodes: sentinel.nodes.map((node) => ({
            host: node.host.trim(),
            port: node.port,
          })),
          username: sentinel.username?.trim() || null,
          password: sentinel.password?.trim() || null,
          tls: Boolean(sentinel.tls),
        }
      : null,
    cluster: cluster
      ? {
          nodes: cluster.nodes.map((node) => ({
            host: node.host.trim(),
            port: node.port,
          })),
        }
      : null,
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
      clusterNodeAddress: options.clusterNodeAddress ?? null,
    },
  });
}

export async function scanRedisKeysPage(
  connection: RedisConnectionInvokeInput,
  options: RedisKeysScanPageOptions = {}
): Promise<RedisKeysScanPage> {
  return invoke("scan_redis_keys_page", {
    input: {
      connection: toConnectionInput(connection),
      scanCount: options.scanCount,
      pageSize: options.pageSize,
      cursor: options.cursor ?? null,
      clusterNodeAddress: options.clusterNodeAddress ?? null,
    },
  });
}

export async function getRedisClusterTopology(
  connection: RedisConnectionInvokeInput
): Promise<RedisClusterTopologyNode[]> {
  return invoke("get_redis_cluster_topology", {
    input: {
      connection: toConnectionInput(connection),
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

export async function getRedisKeyValuePage(
  connection: RedisConnectionInvokeInput,
  key: string,
  options: RedisKeyValuePageOptions = {}
): Promise<RedisKeyValuePage> {
  const response = await invoke<
    KeyValue & {
      nextCursor: string | null;
      totalCount: number | null;
      loadedCount: number;
      pageSize: number;
    }
  >("get_redis_key_value_page", {
    input: {
      connection: toConnectionInput(connection),
      key,
      pageSize: options.pageSize,
      cursor: options.cursor ?? null,
    },
  });

  return {
    ...response,
    page: {
      nextCursor: response.nextCursor,
      totalCount: response.totalCount,
      loadedCount: response.loadedCount,
      pageSize: response.pageSize,
    },
  };
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

export async function startRedisPubSubSession(
  connection: RedisConnectionInvokeInput
): Promise<string> {
  return invoke("start_redis_pubsub_session", {
    input: {
      connection: toConnectionInput(connection),
    },
  });
}

export async function stopRedisPubSubSession(sessionId: string) {
  await invoke("stop_redis_pubsub_session", {
    input: {
      sessionId,
    },
  });
}

export async function subscribeRedisPubSubChannels(
  sessionId: string,
  channels: string[]
): Promise<string[]> {
  return invoke("subscribe_redis_pubsub_channels", {
    input: {
      sessionId,
      channels,
    },
  });
}

export async function subscribeRedisPubSubPatterns(
  sessionId: string,
  patterns: string[]
): Promise<string[]> {
  return invoke("subscribe_redis_pubsub_patterns", {
    input: {
      sessionId,
      channels: patterns,
    },
  });
}

export async function unsubscribeRedisPubSubChannels(
  sessionId: string,
  channels: string[]
): Promise<string[]> {
  return invoke("unsubscribe_redis_pubsub_channels", {
    input: {
      sessionId,
      channels,
    },
  });
}

export async function unsubscribeRedisPubSubPatterns(
  sessionId: string,
  patterns: string[]
): Promise<string[]> {
  return invoke("unsubscribe_redis_pubsub_patterns", {
    input: {
      sessionId,
      channels: patterns,
    },
  });
}

export async function publishRedisPubSubMessage(
  connection: RedisConnectionInvokeInput,
  channel: string,
  payload: string
): Promise<number> {
  return invoke("publish_redis_pubsub_message", {
    input: {
      connection: toConnectionInput(connection),
      channel,
      payload,
    },
  });
}

export type { RedisPubSubEvent };

export async function getRedisStreamEntries(
  connection: RedisConnectionInvokeInput,
  key: string,
  options: RedisStreamEntriesOptions = {}
): Promise<RedisStreamEntriesResult> {
  return invoke("get_redis_stream_entries", {
    input: {
      connection: toConnectionInput(connection),
      key,
      pageSize: options.pageSize,
      cursor: options.cursor ?? null,
    },
  });
}

export async function appendRedisStreamEntry(
  connection: RedisConnectionInvokeInput,
  key: string,
  entries: RedisKeyCreateEntryInput[]
): Promise<string> {
  return invoke("append_redis_stream_entry", {
    input: {
      connection: toConnectionInput(connection),
      key,
      entries,
    },
  });
}

export async function getRedisStreamGroups(
  connection: RedisConnectionInvokeInput,
  key: string
): Promise<RedisStreamConsumerGroup[]> {
  return invoke("get_redis_stream_groups", {
    input: {
      connection: toConnectionInput(connection),
      key,
    },
  });
}

export async function getRedisStreamConsumers(
  connection: RedisConnectionInvokeInput,
  key: string,
  group: string
): Promise<RedisStreamConsumer[]> {
  return invoke("get_redis_stream_consumers", {
    input: {
      connection: toConnectionInput(connection),
      key,
      group,
    },
  });
}

export async function getRedisStreamPendingEntries(
  connection: RedisConnectionInvokeInput,
  key: string,
  group: string,
  options: {
    count?: number;
    consumer?: string | null;
  } = {}
): Promise<RedisStreamPendingEntry[]> {
  return invoke("get_redis_stream_pending_entries", {
    input: {
      connection: toConnectionInput(connection),
      key,
      group,
      count: options.count,
      consumer: options.consumer ?? null,
    },
  });
}

export async function createRedisStreamConsumerGroup(
  connection: RedisConnectionInvokeInput,
  input: {
    key: string;
    group: string;
    startId: string;
  }
) {
  await invoke("create_redis_stream_consumer_group", {
    input: {
      connection: toConnectionInput(connection),
      key: input.key,
      group: input.group,
      startId: input.startId,
    },
  });
}

export async function destroyRedisStreamConsumerGroup(
  connection: RedisConnectionInvokeInput,
  key: string,
  group: string
): Promise<number> {
  return invoke("destroy_redis_stream_consumer_group", {
    input: {
      connection: toConnectionInput(connection),
      key,
      group,
    },
  });
}

export async function deleteRedisStreamConsumer(
  connection: RedisConnectionInvokeInput,
  key: string,
  group: string,
  consumer: string
): Promise<number> {
  return invoke("delete_redis_stream_consumer", {
    input: {
      connection: toConnectionInput(connection),
      key,
      group,
      consumer,
    },
  });
}

export async function deleteRedisStreamEntries(
  connection: RedisConnectionInvokeInput,
  key: string,
  ids: string[]
): Promise<number> {
  return invoke("delete_redis_stream_entries", {
    input: {
      connection: toConnectionInput(connection),
      key,
      ids,
    },
  });
}

export async function ackRedisStreamEntries(
  connection: RedisConnectionInvokeInput,
  key: string,
  group: string,
  ids: string[]
): Promise<number> {
  return invoke("ack_redis_stream_entries", {
    input: {
      connection: toConnectionInput(connection),
      key,
      group,
      ids,
    },
  });
}

export async function claimRedisStreamEntries(
  connection: RedisConnectionInvokeInput,
  input: {
    key: string;
    group: string;
    consumer: string;
    minIdleTime: number;
    ids: string[];
  }
): Promise<string[]> {
  return invoke("claim_redis_stream_entries", {
    input: {
      connection: toConnectionInput(connection),
      key: input.key,
      group: input.group,
      consumer: input.consumer,
      minIdleTime: input.minIdleTime,
      ids: input.ids,
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

  if (connection.mode === "cluster") {
    for (const key of uniqueKeys) {
      await runRedisCommand(connection, `DEL ${escapeRedisCommandArgument(key)}`);
    }

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

export async function addRedisHashEntry(
  connection: RedisConnectionInvokeInput,
  key: string,
  input: RedisHashEntryAdd
) {
  await invoke("add_redis_hash_entry", {
    input: {
      connection: toConnectionInput(connection),
      key,
      field: input.field,
      value: input.value,
    },
  });
}

export async function appendRedisListValue(
  connection: RedisConnectionInvokeInput,
  key: string,
  input: RedisListValueAppend
) {
  await invoke("append_redis_list_value", {
    input: {
      connection: toConnectionInput(connection),
      key,
      value: input.value,
      position: input.position ?? "tail",
    },
  });
}

export async function updateRedisListValue(
  connection: RedisConnectionInvokeInput,
  key: string,
  input: RedisListValueUpdate
) {
  await invoke("update_redis_list_value", {
    input: {
      connection: toConnectionInput(connection),
      key,
      index: input.index,
      value: input.value,
    },
  });
}

export async function deleteRedisListValue(
  connection: RedisConnectionInvokeInput,
  key: string,
  input: RedisListValueDelete
) {
  await invoke("delete_redis_list_value", {
    input: {
      connection: toConnectionInput(connection),
      key,
      index: input.index,
    },
  });
}

export async function addRedisSetMember(
  connection: RedisConnectionInvokeInput,
  key: string,
  input: RedisSetMemberAdd
) {
  await invoke("add_redis_set_member", {
    input: {
      connection: toConnectionInput(connection),
      key,
      member: input.member,
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

export async function addRedisZSetEntry(
  connection: RedisConnectionInvokeInput,
  key: string,
  input: RedisZSetEntryAdd
) {
  await invoke("add_redis_zset_entry", {
    input: {
      connection: toConnectionInput(connection),
      key,
      member: input.member,
      score: input.score,
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
