import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Bot,
  Edit3,
  Hash,
  Plus,
  RefreshCw,
  Rss,
  Search,
  Server,
  Settings,
  Terminal,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useI18n } from "../i18n";
import { getRedisErrorMessage } from "../lib/redis";
import { getRedisConnectionEndpointLabel } from "../lib/redisConnection";
import { useModalTransition } from "../hooks/useModalTransition";
import { useRedisWorkspaceStore } from "../store/useRedisWorkspaceState";
import { useToast } from "./ToastProvider";

interface CommandPaletteProps {
  onClose: () => void;
  onOpenSettings: () => void;
}

type CommandPaletteGroup = "actions" | "connections" | "keys";

interface CommandPaletteItem {
  id: string;
  group: CommandPaletteGroup;
  title: string;
  subtitle?: string;
  icon: ReactNode;
  searchText: string;
  onSelect: () => Promise<void> | void;
}

function buildSearchText(parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

export function CommandPalette({
  onClose,
  onOpenSettings,
}: CommandPaletteProps) {
  const { locale, messages } = useI18n();
  const { isVisible, requestClose, handleBackdropClick } =
    useModalTransition(onClose);
  const { showToast } = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const workspace = useRedisWorkspaceStore(
    useShallow((state) => ({
      activeConnectionId: state.activeConnectionId,
      connections: state.connections,
      hasMoreKeys: state.hasMoreKeys,
      keys: state.keys,
      loadMoreKeys: state.loadMoreKeys,
      openNewConnectionModal: state.openNewConnectionModal,
      panelTab: state.panelTab,
      refreshKeys: state.refreshKeys,
      selectConnection: state.selectConnection,
      selectKey: state.selectKey,
      setPanelTab: state.setPanelTab,
    }))
  );

  const labels = useMemo(
    () =>
      locale === "zh"
        ? {
            placeholder: "输入命令、连接名或 key...",
            actions: "操作",
            connections: "连接",
            keys: "Keys",
            loadMoreKeys: "继续加载 Keys",
            newConnection: "新建连接",
            refreshKeys: "刷新 Keys",
            settings: "打开设置",
            noResults: "没有匹配项",
            hint: "Enter 执行 · ↑↓ 导航 · Esc 关闭",
            active: "当前",
          }
        : {
            placeholder: "Search commands, connections, or keys...",
            actions: "Actions",
            connections: "Connections",
            keys: "Keys",
            loadMoreKeys: "Load more keys",
            newConnection: "New connection",
            refreshKeys: "Refresh keys",
            settings: "Open settings",
            noResults: "No matches",
            hint: "Enter to run, arrows to navigate, Esc to close",
            active: "Active",
          },
    [locale]
  );

  const activeConnection = useMemo(
    () =>
      workspace.connections.find(
        (connection) => connection.id === workspace.activeConnectionId
      ),
    [workspace.activeConnectionId, workspace.connections]
  );

  const actionItems = useMemo<CommandPaletteItem[]>(() => {
    const items: CommandPaletteItem[] = [
      {
        id: "action:new-connection",
        group: "actions",
        title: labels.newConnection,
        subtitle: messages.sidebar.newConnection,
        icon: <Plus size={14} />,
        searchText: buildSearchText([
          labels.newConnection,
          messages.sidebar.newConnection,
          "create connection",
        ]),
        onSelect: () => {
          workspace.openNewConnectionModal();
        },
      },
      {
        id: "action:settings",
        group: "actions",
        title: labels.settings,
        subtitle: messages.common.settings,
        icon: <Settings size={14} />,
        searchText: buildSearchText([
          labels.settings,
          messages.common.settings,
        ]),
        onSelect: () => {
          onOpenSettings();
        },
      },
      {
        id: "action:panel-editor",
        group: "actions",
        title: messages.app.tabs.editor,
        subtitle: "Panel",
        icon: <Edit3 size={14} />,
        searchText: buildSearchText([messages.app.tabs.editor, "panel editor"]),
        onSelect: () => {
          workspace.setPanelTab("editor");
        },
      },
      {
        id: "action:panel-ai",
        group: "actions",
        title: messages.app.tabs.ai,
        subtitle: "Panel",
        icon: <Bot size={14} />,
        searchText: buildSearchText([messages.app.tabs.ai, "panel ai"]),
        onSelect: () => {
          workspace.setPanelTab("ai");
        },
      },
      {
        id: "action:panel-cli",
        group: "actions",
        title: messages.app.tabs.cli,
        subtitle: "Panel",
        icon: <Terminal size={14} />,
        searchText: buildSearchText([messages.app.tabs.cli, "panel cli"]),
        onSelect: () => {
          workspace.setPanelTab("cli");
        },
      },
      {
        id: "action:panel-pubsub",
        group: "actions",
        title: messages.app.tabs.pubsub,
        subtitle: "Panel",
        icon: <Rss size={14} />,
        searchText: buildSearchText([messages.app.tabs.pubsub, "panel pubsub"]),
        onSelect: () => {
          workspace.setPanelTab("pubsub");
        },
      },
    ];

    if (activeConnection) {
      items.splice(1, 0, {
        id: "action:refresh-keys",
        group: "actions",
        title: labels.refreshKeys,
        subtitle: activeConnection.name,
        icon: <RefreshCw size={14} />,
        searchText: buildSearchText([
          labels.refreshKeys,
          activeConnection.name,
          "refresh scan",
        ]),
        onSelect: () => workspace.refreshKeys(),
      });
    }

    if (activeConnection && workspace.hasMoreKeys) {
      items.splice(2, 0, {
        id: "action:load-more-keys",
        group: "actions",
        title: labels.loadMoreKeys,
        subtitle: activeConnection.name,
        icon: <Search size={14} />,
        searchText: buildSearchText([
          labels.loadMoreKeys,
          activeConnection.name,
          "scan next page",
        ]),
        onSelect: () => workspace.loadMoreKeys(),
      });
    }

    return items;
  }, [activeConnection, labels.loadMoreKeys, labels.newConnection, labels.refreshKeys, labels.settings, messages.app.tabs.ai, messages.app.tabs.cli, messages.app.tabs.editor, messages.app.tabs.pubsub, messages.common.settings, messages.sidebar.newConnection, onOpenSettings, workspace]);

  const connectionItems = useMemo<CommandPaletteItem[]>(
    () =>
      workspace.connections.map((connection) => ({
        id: `connection:${connection.id}`,
        group: "connections",
        title: connection.name,
        subtitle: `${getRedisConnectionEndpointLabel(connection)}${
          connection.id === workspace.activeConnectionId
            ? ` · ${labels.active}`
            : ""
        }`,
        icon: <Server size={14} />,
        searchText: buildSearchText([
          connection.name,
          getRedisConnectionEndpointLabel(connection),
          connection.mode,
          connection.id === workspace.activeConnectionId ? labels.active : "",
        ]),
        onSelect: () => workspace.selectConnection(connection.id),
      })),
    [labels.active, workspace.activeConnectionId, workspace.connections, workspace.selectConnection]
  );

  const keyItems = useMemo<CommandPaletteItem[]>(
    () =>
      workspace.keys.map((key) => ({
        id: `key:${key.key}`,
        group: "keys",
        title: key.key,
        subtitle: `${key.type}${
          typeof key.ttl === "number" && key.ttl >= 0 ? ` · ttl ${key.ttl}` : ""
        }${key.nodeAddress ? ` · ${key.nodeAddress}` : ""}`,
        icon: <Hash size={14} />,
        searchText: buildSearchText([
          key.key,
          key.type,
          key.nodeAddress,
          typeof key.slot === "number" ? String(key.slot) : "",
        ]),
        onSelect: () => workspace.selectKey(key),
      })),
    [workspace.keys, workspace.selectKey]
  );

  const queryTerms = useMemo(
    () =>
      deferredQuery
        .toLowerCase()
        .trim()
        .split(/\s+/)
        .filter(Boolean),
    [deferredQuery]
  );

  const filterItems = useCallback(
    (items: CommandPaletteItem[]) => {
      if (!queryTerms.length) {
        return items;
      }

      return items.filter((item) =>
        queryTerms.every((term) => item.searchText.includes(term))
      );
    },
    [queryTerms]
  );

  const visibleActionItems = useMemo(
    () => filterItems(actionItems),
    [actionItems, filterItems]
  );
  const visibleConnectionItems = useMemo(
    () => filterItems(connectionItems),
    [connectionItems, filterItems]
  );
  const visibleKeyItems = useMemo(
    () => filterItems(keyItems).slice(0, 60),
    [filterItems, keyItems]
  );

  const sections = useMemo(
    () =>
      [
        {
          group: "actions" as const,
          label: labels.actions,
          items: visibleActionItems,
        },
        {
          group: "connections" as const,
          label: labels.connections,
          items: visibleConnectionItems,
        },
        {
          group: "keys" as const,
          label: labels.keys,
          items: visibleKeyItems,
        },
      ].filter((section) => section.items.length > 0),
    [
      labels.actions,
      labels.connections,
      labels.keys,
      visibleActionItems,
      visibleConnectionItems,
      visibleKeyItems,
    ]
  );

  const visibleItems = useMemo(
    () => sections.flatMap((section) => section.items),
    [sections]
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActiveIndex((currentIndex) =>
      visibleItems.length === 0
        ? 0
        : Math.min(currentIndex, visibleItems.length - 1)
    );
  }, [visibleItems.length]);

  const executeItem = useCallback(
    async (item: CommandPaletteItem) => {
      try {
        requestClose();
        await item.onSelect();
      } catch (error) {
        showToast({
          message: getRedisErrorMessage(error),
          tone: "error",
          duration: 1800,
        });
      }
    },
    [requestClose, showToast]
  );

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((currentIndex) =>
          visibleItems.length === 0
            ? 0
            : Math.min(currentIndex + 1, visibleItems.length - 1)
        );
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((currentIndex) =>
          visibleItems.length === 0 ? 0 : Math.max(currentIndex - 1, 0)
        );
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const item = visibleItems[activeIndex];

        if (item) {
          void executeItem(item);
        }
      }
    },
    [activeIndex, executeItem, visibleItems]
  );

  return (
    <div
      onClick={handleBackdropClick}
      className={`fixed inset-0 z-[80] flex items-start justify-center bg-black/55 px-4 pt-[12vh] backdrop-blur-sm transition-opacity duration-200 ease-out motion-reduce:transition-none ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        className={`w-full max-w-2xl overflow-hidden rounded-2xl border border-base-content/10 bg-base-200 shadow-2xl transition-all duration-200 ease-out motion-reduce:transition-none ${
          isVisible
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-2 scale-[0.985] opacity-0"
        }`}
      >
        <div className="border-b border-base-content/8 p-3">
          <label className="input flex h-11 w-full items-center gap-2 border-base-content/8 bg-base-100/80">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-base-content/35">
              <Search size={14} />
            </span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(event) => {
                const nextValue = event.target.value;

                startTransition(() => {
                  setQuery(nextValue);
                });
                setActiveIndex(0);
              }}
              onKeyDown={handleInputKeyDown}
              placeholder={labels.placeholder}
              className="h-full min-w-0 flex-1 bg-transparent font-mono text-sm outline-none"
              autoFocus
            />
          </label>
        </div>

        <div className="max-h-[56vh] overflow-y-auto px-2 py-2">
          {sections.length === 0 ? (
            <div className="px-3 py-10 text-center text-sm font-mono text-base-content/45">
              {labels.noResults}
            </div>
          ) : (
            sections.map((section) => {
              let sectionStartIndex = 0;

              for (const previousSection of sections) {
                if (previousSection.group === section.group) {
                  break;
                }

                sectionStartIndex += previousSection.items.length;
              }

              return (
                <div key={section.group} className="mb-3 last:mb-0">
                  <div className="px-2 pb-1 text-[10px] font-mono uppercase tracking-[0.16em] text-base-content/35">
                    {section.label}
                  </div>
                  <div className="space-y-1">
                    {section.items.map((item, index) => {
                      const itemIndex = sectionStartIndex + index;
                      const isActive = itemIndex === activeIndex;

                      return (
                        <button
                          key={item.id}
                          type="button"
                          onMouseEnter={() => {
                            setActiveIndex(itemIndex);
                          }}
                          onClick={() => {
                            void executeItem(item);
                          }}
                          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors duration-150 ${
                            isActive
                              ? "bg-primary/10 text-primary"
                              : "text-base-content/75 hover:bg-base-100/70 hover:text-base-content"
                          }`}
                        >
                          <span
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                              isActive
                                ? "bg-primary/12 text-primary"
                                : "bg-base-100 text-base-content/45"
                            }`}
                          >
                            {item.icon}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-mono">
                              {item.title}
                            </span>
                            {item.subtitle ? (
                              <span
                                className={`block truncate text-[11px] ${
                                  isActive
                                    ? "text-primary/80"
                                    : "text-base-content/45"
                                }`}
                              >
                                {item.subtitle}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="border-t border-base-content/8 px-3 py-2 text-[11px] font-mono text-base-content/35">
          {labels.hint}
        </div>
      </div>
    </div>
  );
}
