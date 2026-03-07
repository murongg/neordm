export type RedisKeyType = "string" | "hash" | "list" | "set" | "zset" | "stream" | "json";

export interface RedisConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  password?: string;
  db: number;
  tls: boolean;
  status: "connected" | "disconnected" | "connecting" | "error";
  color: string;
}

export interface RedisKey {
  key: string;
  type: RedisKeyType;
  ttl: number; // -1 = no expiry, -2 = expired
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

export interface KeyValue {
  key: string;
  type: RedisKeyType;
  ttl: number;
  value:
    | string
    | Record<string, string>
    | string[]
    | ZSetMember[]
    | null;
}

export type PanelTab = "editor" | "ai" | "cli";

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
