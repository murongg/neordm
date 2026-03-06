import { useState, useCallback } from "react";
import type {
  RedisConnection,
  RedisKey,
  KeyValue,
  PanelTab,
  ChatMessage,
  CliEntry,
} from "../types";

// Demo data
const DEMO_CONNECTIONS: RedisConnection[] = [
  {
    id: "1",
    name: "Local Dev",
    host: "127.0.0.1",
    port: 6379,
    db: 0,
    tls: false,
    status: "connected",
    color: "#22c55e",
  },
  {
    id: "2",
    name: "Staging",
    host: "redis-staging.example.com",
    port: 6380,
    db: 0,
    tls: true,
    status: "disconnected",
    color: "#f59e0b",
  },
  {
    id: "3",
    name: "Production",
    host: "redis-prod.example.com",
    port: 6379,
    db: 0,
    tls: true,
    status: "disconnected",
    color: "#ef4444",
  },
];

const DEMO_KEYS: RedisKey[] = [
  { key: "user:1001:profile", type: "hash", ttl: -1 },
  { key: "user:1001:sessions", type: "set", ttl: 86400 },
  { key: "user:1002:profile", type: "hash", ttl: -1 },
  { key: "cache:homepage:v3", type: "string", ttl: 300 },
  { key: "cache:products:list", type: "string", ttl: 600 },
  { key: "queue:email:pending", type: "list", ttl: -1 },
  { key: "queue:notifications", type: "list", ttl: -1 },
  { key: "leaderboard:global", type: "zset", ttl: -1 },
  { key: "leaderboard:weekly", type: "zset", ttl: 604800 },
  { key: "config:feature-flags", type: "hash", ttl: -1 },
  { key: "stats:daily:2024-01-15", type: "hash", ttl: 2592000 },
  { key: "session:abc123def456", type: "string", ttl: 1800 },
  { key: "lock:payment:processing", type: "string", ttl: 30 },
  { key: "tags:popular", type: "set", ttl: -1 },
  { key: "events:stream", type: "stream", ttl: -1 },
];

const DEMO_CHAT: ChatMessage[] = [
  {
    id: "1",
    role: "assistant",
    content:
      "Hi! I'm your Redis AI assistant. I can help you query, analyze, and manage your Redis data. What would you like to do?",
    timestamp: new Date(Date.now() - 60000),
  },
];

export function useAppStore() {
  const [connections, setConnections] =
    useState<RedisConnection[]>(DEMO_CONNECTIONS);
  const [activeConnectionId, setActiveConnectionId] = useState<string>("1");
  const [selectedDb, setSelectedDb] = useState<number>(0);
  const [keys] = useState<RedisKey[]>(DEMO_KEYS);
  const [selectedKey, setSelectedKey] = useState<RedisKey | null>(null);
  const [keyValue, setKeyValue] = useState<KeyValue | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("*");
  const [panelTab, setPanelTab] = useState<PanelTab>("editor");
  const [chatMessages, setChatMessages] =
    useState<ChatMessage[]>(DEMO_CHAT);
  const [cliHistory, setCliHistory] = useState<CliEntry[]>([
    {
      id: "1",
      type: "output",
      content: "Connected to 127.0.0.1:6379",
      timestamp: new Date(),
    },
  ]);
  const [showConnectionModal, setShowConnectionModal] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const activeConnection = connections.find(
    (c) => c.id === activeConnectionId
  );

  const selectKey = useCallback((key: RedisKey) => {
    setSelectedKey(key);
    // Simulate loading value
    const mockValue = getMockValue(key);
    setKeyValue(mockValue);
    setPanelTab("editor");
  }, []);

  const sendChatMessage = useCallback(
    (content: string) => {
      const userMsg: ChatMessage = {
        id: Date.now().toString(),
        role: "user",
        content,
        timestamp: new Date(),
      };
      setChatMessages((prev) => [...prev, userMsg]);

      // Simulate AI response
      setTimeout(() => {
        const aiMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: generateAIResponse(content, selectedKey),
          command: generateSuggestedCommand(content, selectedKey),
          timestamp: new Date(),
        };
        setChatMessages((prev) => [...prev, aiMsg]);
      }, 800);
    },
    [selectedKey]
  );

  const runCliCommand = useCallback((cmd: string) => {
    const entry: CliEntry = {
      id: Date.now().toString(),
      type: "command",
      content: cmd,
      timestamp: new Date(),
    };
    setCliHistory((prev) => [...prev, entry]);

    // Simulate output
    setTimeout(() => {
      const output: CliEntry = {
        id: (Date.now() + 1).toString(),
        type: "output",
        content: simulateRedisOutput(cmd),
        timestamp: new Date(),
      };
      setCliHistory((prev) => [...prev, output]);
    }, 100);
  }, []);

  const addConnection = useCallback((conn: Omit<RedisConnection, "id" | "status">) => {
    const newConn: RedisConnection = {
      ...conn,
      id: Date.now().toString(),
      status: "connecting",
    };
    setConnections((prev) => [...prev, newConn]);
    setTimeout(() => {
      setConnections((prev) =>
        prev.map((c) =>
          c.id === newConn.id ? { ...c, status: "connected" } : c
        )
      );
    }, 1200);
  }, []);

  return {
    connections,
    activeConnectionId,
    setActiveConnectionId,
    activeConnection,
    selectedDb,
    setSelectedDb,
    keys,
    selectedKey,
    selectKey,
    keyValue,
    searchQuery,
    setSearchQuery,
    panelTab,
    setPanelTab,
    chatMessages,
    sendChatMessage,
    cliHistory,
    runCliCommand,
    showConnectionModal,
    setShowConnectionModal,
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    addConnection,
  };
}

// Helpers
function getMockValue(key: RedisKey): KeyValue {
  switch (key.type) {
    case "hash":
      return {
        key: key.key,
        type: "hash",
        ttl: key.ttl,
        value: {
          id: "1001",
          name: "Alice Chen",
          email: "alice@example.com",
          role: "admin",
          createdAt: "2024-01-10T09:00:00Z",
          lastLogin: "2024-01-15T14:32:00Z",
        },
      };
    case "list":
      return {
        key: key.key,
        type: "list",
        ttl: key.ttl,
        value: [
          '{"to":"bob@example.com","subject":"Welcome","status":"pending"}',
          '{"to":"carol@example.com","subject":"Reset Password","status":"pending"}',
          '{"to":"dave@example.com","subject":"Invoice #1042","status":"pending"}',
          '{"to":"eve@example.com","subject":"Subscription Renewal","status":"queued"}',
        ],
      };
    case "set":
      return {
        key: key.key,
        type: "set",
        ttl: key.ttl,
        value: ["session:abc123", "session:def456", "session:ghi789", "session:jkl012"],
      };
    case "zset":
      return {
        key: key.key,
        type: "zset",
        ttl: key.ttl,
        value: [
          { score: 98420, member: "user:alice" },
          { score: 87350, member: "user:bob" },
          { score: 76200, member: "user:carol" },
          { score: 65100, member: "user:dave" },
          { score: 54900, member: "user:eve" },
        ],
      };
    default:
      return {
        key: key.key,
        type: "string",
        ttl: key.ttl,
        value:
          key.key.includes("lock")
            ? "1"
            : key.key.includes("session")
            ? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxMDAxIn0.abc123"
            : JSON.stringify({ status: "ok", ts: Date.now() }),
      };
  }
}

function generateAIResponse(input: string, key: RedisKey | null): string {
  const lower = input.toLowerCase();
  if (lower.includes("ttl") || lower.includes("expir")) {
    return key
      ? `The key \`${key.key}\` has TTL: **${key.ttl === -1 ? "No expiry" : key.ttl + "s"}**. Use \`EXPIRE ${key.key} <seconds>\` to set expiry, or \`PERSIST ${key.key}\` to remove it.`
      : "Select a key first, then I can tell you its TTL details.";
  }
  if (lower.includes("delete") || lower.includes("del")) {
    return key
      ? `To delete \`${key.key}\`, run:\n\`\`\`\nDEL ${key.key}\n\`\`\`\n⚠️ This is irreversible. Make sure you want to delete it.`
      : "Which key would you like to delete? Select one from the key browser.";
  }
  if (lower.includes("count") || lower.includes("how many")) {
    return "Run `DBSIZE` to get the total number of keys, or use `SCAN 0 MATCH user:* COUNT 100` to count keys matching a pattern.";
  }
  if (lower.includes("slow") || lower.includes("performance")) {
    return "Check your slow log with `SLOWLOG GET 10`. Commands taking >10ms are logged. You can also run `INFO stats` for throughput metrics.";
  }
  return `I can help with Redis operations! Try asking me to:\n- Explain a key's value\n- Suggest commands for data patterns\n- Optimize your Redis usage\n- Help with TTL management`;
}

function generateSuggestedCommand(input: string, key: RedisKey | null): string | undefined {
  const lower = input.toLowerCase();
  if (lower.includes("ttl") && key) return `TTL ${key.key}`;
  if (lower.includes("delete") && key) return `DEL ${key.key}`;
  if (lower.includes("count")) return "DBSIZE";
  if (lower.includes("slow")) return "SLOWLOG GET 10";
  return undefined;
}

function simulateRedisOutput(cmd: string): string {
  const parts = cmd.trim().split(/\s+/);
  const command = parts[0]?.toUpperCase();
  switch (command) {
    case "PING": return "PONG";
    case "DBSIZE": return "(integer) 15";
    case "INFO": return "# Server\nredis_version:7.2.3\nredis_mode:standalone\nos:Linux\n# Keyspace\ndb0:keys=15,expires=6,avg_ttl=3600000";
    case "SET": return "OK";
    case "GET": return `"${parts[2] || "value"}"`;
    case "DEL": return "(integer) 1";
    case "TTL": return "(integer) 3600";
    case "KEYS": return `1) "${parts[1] || "*"}"`;
    case "FLUSHDB": return "OK";
    default: return `(error) ERR unknown command '${parts[0]}'`;
  }
}
