export type RedisKeyType = "string" | "hash" | "list" | "set" | "zset" | "stream" | "json";
export type RedisConnectionMode = "direct" | "sentinel" | "cluster";

export interface RedisSentinelNode {
  host: string;
  port: number;
}

export interface RedisSentinelConfig {
  masterName: string;
  nodes: RedisSentinelNode[];
  username?: string;
  password?: string;
  tls?: boolean;
}

export interface RedisClusterNode {
  host: string;
  port: number;
}

export interface RedisClusterConfig {
  nodes: RedisClusterNode[];
}

export interface RedisClusterSlotRange {
  start: number;
  end: number;
}

export interface RedisClusterTopologyNode {
  host: string;
  port: number;
  address: string;
  slotRanges: RedisClusterSlotRange[];
  slotCount: number;
}

export interface RedisSshTunnel {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
}

export interface RedisConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  mode?: RedisConnectionMode;
  sentinel?: RedisSentinelConfig;
  cluster?: RedisClusterConfig;
  username?: string;
  password?: string;
  db: number;
  tls: boolean;
  sshTunnel?: RedisSshTunnel;
  status: "connected" | "disconnected" | "connecting" | "error";
  color: string;
}

export interface RedisKey {
  key: string;
  type: RedisKeyType;
  ttl: number; // -1 = no expiry, -2 = expired
  slot?: number;
  nodeAddress?: string;
  size?: number;
  encoding?: string;
}

export interface HashField {
  field: string;
  value: string;
}

export interface ZSetMember {
  score: number;
  member: string;
}

export interface KeyValuePageState {
  nextCursor: string | null;
  totalCount: number | null;
  loadedCount: number;
  pageSize: number;
}

export interface RedisStreamConsumerGroup {
  name: string;
  consumers: number;
  pending: number;
  lastDeliveredId: string;
  entriesRead?: number | null;
  lag?: number | null;
}

export interface RedisStreamEntryField {
  field: string;
  value: string;
}

export interface RedisStreamEntry {
  id: string;
  fields: RedisStreamEntryField[];
}

export interface RedisStreamEntriesResult {
  totalCount: number;
  nextCursor: string | null;
  entries: RedisStreamEntry[];
}

export interface RedisStreamConsumer {
  name: string;
  pending: number;
  idle: number;
  inactive?: number | null;
}

export interface RedisStreamPendingEntry {
  id: string;
  consumer: string;
  idle: number;
  deliveries: number;
}

export interface KeyValue {
  key: string;
  type: RedisKeyType;
  ttl: number;
  slot?: number;
  nodeAddress?: string;
  page?: KeyValuePageState | null;
  value:
    | string
    | Record<string, string>
    | string[]
    | ZSetMember[]
    | null;
}

export interface RedisPubSubMessage {
  id: string;
  channel: string;
  payload: string;
  pattern?: string;
  timestamp: number;
}

export interface RedisSlowLogEntry {
  id: number;
  startedAt: number;
  durationUs: number;
  arguments: string[];
  clientAddress?: string | null;
  clientName?: string | null;
  nodeAddress?: string | null;
}

export interface RedisSlowLogResponse {
  totalCount: number;
  limit: number;
  entries: RedisSlowLogEntry[];
}

export type RedisPubSubEvent =
  | {
      kind: "message";
      sessionId: string;
      channel: string;
      payload: string;
      pattern?: string | null;
      timestamp: number;
    }
  | {
      kind: "closed";
      sessionId: string;
      reason?: string | null;
    };

export type PanelTab = "editor" | "ai" | "cli" | "pubsub" | "slowlog";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  command?: string; // suggested redis command
  tools?: string[];
  events?: AiAssistantEvent[];
  toolEvents?: AiToolEvent[];
}

export interface AiToolEvent {
  id: string;
  toolName: string;
  status: "running" | "success" | "error";
  detail?: string;
  timestamp: Date;
}

export interface AiAssistantEvent {
  id: string;
  type: string;
  detail?: string;
  timestamp: Date;
}

export interface PendingAiCommandConfirmation {
  toolCallId: string;
  toolName: string;
  command: string;
  reason?: string | null;
}

export interface CliEntry {
  id: string;
  type: "command" | "output" | "error";
  content: string;
  timestamp: Date;
  promptLabel?: string;
}
