import type { Message as AiContextMessage } from "@mariozechner/pi-ai";
import type {
  KeyValue,
  RedisConnection,
  RedisKey,
} from "../../types";
import type { AiSettings } from "../aiSettings";

export interface OpenAIAssistantRequest {
  settings: AiSettings;
  contextMessages: AiContextMessage[];
  userInput: string;
  activeConnection?: RedisConnection;
  selectedDb: number;
  selectedKey: RedisKey | null;
  keyValue: KeyValue | null;
  loadedKeys: RedisKey[];
  keysCount: number;
  signal?: AbortSignal;
  onToolActivity?: (toolName: string | null) => void;
}

export interface OpenAIAssistantResponse {
  content: string;
  command?: string;
  contextMessages: AiContextMessage[];
}

export type AssistantContextMessage = AiContextMessage;
