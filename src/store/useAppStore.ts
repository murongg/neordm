import { useCallback, useState } from "react";
import type {
  RedisConnection,
  RedisKey,
  KeyValue,
  PanelTab,
  ChatMessage,
  CliEntry,
} from "../types";

export function useAppStore() {
  const [connections, setConnections] = useState<RedisConnection[]>([]);
  const [activeConnectionId, setActiveConnectionId] = useState<string>("");
  const [selectedDb, setSelectedDb] = useState<number>(0);
  const [keys] = useState<RedisKey[]>([]);
  const [selectedKey, setSelectedKey] = useState<RedisKey | null>(null);
  const [keyValue, setKeyValue] = useState<KeyValue | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [panelTab, setPanelTab] = useState<PanelTab>("editor");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [cliHistory, setCliHistory] = useState<CliEntry[]>([]);
  const [showConnectionModal, setShowConnectionModal] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const activeConnection = connections.find(
    (connection) => connection.id === activeConnectionId
  );

  const selectKey = useCallback((key: RedisKey) => {
    setSelectedKey(key);
    setKeyValue(null);
    setPanelTab("editor");
  }, []);

  const sendChatMessage = useCallback((content: string) => {
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content,
      timestamp: new Date(),
    };

    setChatMessages((previous) => [...previous, userMessage]);
  }, []);

  const runCliCommand = useCallback((cmd: string) => {
    const entry: CliEntry = {
      id: Date.now().toString(),
      type: "command",
      content: cmd,
      timestamp: new Date(),
    };

    setCliHistory((previous) => [...previous, entry]);
  }, []);

  const addConnection = useCallback(
    (connection: Omit<RedisConnection, "id" | "status">) => {
      const newConnection: RedisConnection = {
        ...connection,
        id: Date.now().toString(),
        status: "disconnected",
      };

      setConnections((previous) => [...previous, newConnection]);
      setActiveConnectionId(newConnection.id);
      setSelectedDb(newConnection.db);
      setSelectedKey(null);
      setKeyValue(null);
      setSearchQuery("");
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
