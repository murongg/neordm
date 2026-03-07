import type { Message as AiContextMessage } from "@mariozechner/pi-ai";
import type {
  AiAssistantEvent,
  AiToolEvent,
  KeyValue,
  PendingAiCommandConfirmation,
  RedisConnection,
  RedisKey,
} from "../../types";
import type { AiSettings } from "../aiSettings";

export interface AssistantToolResultDetails {
  didMutateRedis?: boolean;
  executedCommand?: string;
}

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
  onToolEvent?: (event: AiToolEvent) => void;
  onAssistantEvent?: (event: AiAssistantEvent) => void;
  confirmDangerousCommand?: (
    confirmation: PendingAiCommandConfirmation
  ) => Promise<boolean>;
}

export interface OpenAIAssistantResponse {
  content: string;
  command?: string;
  tools?: string[];
  events?: AiAssistantEvent[];
  toolEvents?: AiToolEvent[];
  didMutateRedis?: boolean;
  contextMessages: AiContextMessage[];
}

export type AssistantContextMessage = AiContextMessage;
