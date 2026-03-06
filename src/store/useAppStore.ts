import { useState, useCallback, useEffect } from "react";
import type {
  RedisConnection,
  RedisKey,
  KeyValue,
  PanelTab,
  ChatMessage,
  CliEntry,
} from "../types";
import { useI18n, type Messages } from "../i18n";

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

export function useAppStore() {
  const { messages, format } = useI18n();
  const [connections, setConnections] =
    useState<RedisConnection[]>(DEMO_CONNECTIONS);
  const [activeConnectionId, setActiveConnectionId] = useState<string>("1");
  const [selectedDb, setSelectedDb] = useState<number>(0);
  const [keys] = useState<RedisKey[]>(DEMO_KEYS);
  const [selectedKey, setSelectedKey] = useState<RedisKey | null>(null);
  const [keyValue, setKeyValue] = useState<KeyValue | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("*");
  const [panelTab, setPanelTab] = useState<PanelTab>("editor");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() =>
    createDemoChat(messages)
  );
  const [cliHistory, setCliHistory] = useState<CliEntry[]>(() =>
    createInitialCliHistory(messages, format)
  );
  const [showConnectionModal, setShowConnectionModal] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const activeConnection = connections.find((connection) => {
    return connection.id === activeConnectionId;
  });

  useEffect(() => {
    setChatMessages((previous) => {
      if (
        previous.length === 1 &&
        previous[0]?.id === "1" &&
        previous[0]?.role === "assistant"
      ) {
        return createDemoChat(messages);
      }

      return previous;
    });
  }, [messages]);

  useEffect(() => {
    setCliHistory((previous) => {
      if (
        previous.length === 1 &&
        previous[0]?.id === "1" &&
        previous[0]?.type === "output"
      ) {
        return createInitialCliHistory(messages, format);
      }

      return previous;
    });
  }, [format, messages]);

  const selectKey = useCallback((key: RedisKey) => {
    setSelectedKey(key);
    setKeyValue(getMockValue(key));
    setPanelTab("editor");
  }, []);

  const sendChatMessage = useCallback(
    (content: string) => {
      const userMessage: ChatMessage = {
        id: Date.now().toString(),
        role: "user",
        content,
        timestamp: new Date(),
      };

      setChatMessages((previous) => [...previous, userMessage]);

      setTimeout(() => {
        const assistantMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: generateAIResponse(content, selectedKey, messages, format),
          command: generateSuggestedCommand(content, selectedKey),
          timestamp: new Date(),
        };

        setChatMessages((previous) => [...previous, assistantMessage]);
      }, 800);
    },
    [format, messages, selectedKey]
  );

  const runCliCommand = useCallback((cmd: string) => {
    const entry: CliEntry = {
      id: Date.now().toString(),
      type: "command",
      content: cmd,
      timestamp: new Date(),
    };

    setCliHistory((previous) => [...previous, entry]);

    setTimeout(() => {
      const output: CliEntry = {
        id: (Date.now() + 1).toString(),
        type: "output",
        content: simulateRedisOutput(cmd),
        timestamp: new Date(),
      };

      setCliHistory((previous) => [...previous, output]);
    }, 100);
  }, []);

  const addConnection = useCallback(
    (connection: Omit<RedisConnection, "id" | "status">) => {
      const newConnection: RedisConnection = {
        ...connection,
        id: Date.now().toString(),
        status: "connecting",
      };

      setConnections((previous) => [...previous, newConnection]);

      setTimeout(() => {
        setConnections((previous) =>
          previous.map((current) =>
            current.id === newConnection.id
              ? { ...current, status: "connected" }
              : current
          )
        );
      }, 1200);
    },
    []
  );

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

function createDemoChat(messages: Messages): ChatMessage[] {
  return [
    {
      id: "1",
      role: "assistant",
      content: messages.store.greeting,
      timestamp: new Date(Date.now() - 60000),
    },
  ];
}

function createInitialCliHistory(
  messages: Messages,
  format: (template: string, values?: Record<string, string | number>) => string
): CliEntry[] {
  return [
    {
      id: "1",
      type: "output",
      content: format(messages.cli.connectedTo, {
        hostPort: "127.0.0.1:6379",
      }),
      timestamp: new Date(),
    },
  ];
}

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
        value: [
          "session:abc123",
          "session:def456",
          "session:ghi789",
          "session:jkl012",
        ],
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
        value: key.key.includes("lock")
          ? "1"
          : key.key.includes("session")
          ? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxMDAxIn0.abc123"
          : JSON.stringify({ status: "ok", ts: Date.now() }),
      };
  }
}

function generateAIResponse(
  input: string,
  key: RedisKey | null,
  messages: Messages,
  format: (template: string, values?: Record<string, string | number>) => string
): string {
  if (containsKeyword(input, ["ttl", "expir", "过期", "失效"])) {
    if (!key) {
      return messages.store.selectKeyFirst;
    }

    const ttlText =
      key.ttl === -1 ? messages.valueEditor.noExpiry : `${key.ttl}s`;

    return [
      format(messages.store.ttlDetails, {
        key: key.key,
        ttl: ttlText,
      }),
      format(messages.store.ttlSetHint, { key: key.key }),
      format(messages.store.ttlClearHint, { key: key.key }),
    ].join(" ");
  }

  if (containsKeyword(input, ["delete", "del", "删除"])) {
    if (!key) {
      return messages.store.selectKeyDelete;
    }

    return [
      format(messages.store.deleteKey, { key: key.key }),
      messages.store.deleteWarning,
    ].join(" ");
  }

  if (containsKeyword(input, ["count", "how many", "数量", "多少"])) {
    return messages.store.countResponse;
  }

  if (containsKeyword(input, ["slow", "performance", "慢", "性能"])) {
    return messages.store.performanceResponse;
  }

  return messages.store.fallback;
}

function generateSuggestedCommand(
  input: string,
  key: RedisKey | null
): string | undefined {
  if (containsKeyword(input, ["ttl", "过期"]) && key) return `TTL ${key.key}`;
  if (containsKeyword(input, ["delete", "del", "删除"]) && key) {
    return `DEL ${key.key}`;
  }
  if (containsKeyword(input, ["count", "how many", "数量", "多少"])) {
    return "DBSIZE";
  }
  if (containsKeyword(input, ["slow", "performance", "慢", "性能"])) {
    return "SLOWLOG GET 10";
  }

  return undefined;
}

function containsKeyword(input: string, keywords: string[]) {
  const normalized = input.toLowerCase();

  return keywords.some((keyword) => normalized.includes(keyword));
}

function simulateRedisOutput(cmd: string): string {
  const parts = cmd.trim().split(/\s+/);
  const command = parts[0]?.toUpperCase();

  switch (command) {
    case "PING":
      return "PONG";
    case "DBSIZE":
      return "(integer) 15";
    case "INFO":
      return "# Server\nredis_version:7.2.3\nredis_mode:standalone\nos:Linux\n# Keyspace\ndb0:keys=15,expires=6,avg_ttl=3600000";
    case "SET":
      return "OK";
    case "GET":
      return `"${parts[2] || "value"}"`;
    case "DEL":
      return "(integer) 1";
    case "TTL":
      return "(integer) 3600";
    case "KEYS":
      return `1) "${parts[1] || "*"}"`;
    case "FLUSHDB":
      return "OK";
    default:
      return `(error) ERR unknown command '${parts[0]}'`;
  }
}
