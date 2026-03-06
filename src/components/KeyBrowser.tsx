import { useState, useMemo } from "react";
import {
  Search,
  RefreshCw,
  ChevronDown,
  Hash,
  List,
  Layers,
  AlignLeft,
  BarChart2,
  Radio,
  Braces,
} from "lucide-react";
import type { RedisConnection, RedisKey, RedisKeyType } from "../types";
import { useI18n } from "../i18n";
import { EmptyConnectionsIllustration } from "./EmptyConnectionsIllustration";

interface KeyBrowserProps {
  connection?: RedisConnection;
  selectedDb: number;
  onSelectDb: (db: number) => void;
  isRefreshing: boolean;
  onRefresh: () => void;
  keySeparator: string;
  keys: RedisKey[];
  selectedKey: RedisKey | null;
  onSelectKey: (key: RedisKey) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

interface KeyTreeGroupNode {
  kind: "group";
  id: string;
  label: string;
  depth: number;
  keyCount: number;
  children: KeyTreeNode[];
}

interface KeyTreeLeafNode {
  kind: "key";
  redisKey: RedisKey;
  label: string;
  depth: number;
}

type KeyTreeNode = KeyTreeGroupNode | KeyTreeLeafNode;

const TYPE_CONFIG: Record<
  RedisKeyType,
  { icon: React.ReactNode; label: string; badge: string }
> = {
  string: {
    icon: <AlignLeft size={11} />,
    label: "string",
    badge: "badge-info",
  },
  hash: {
    icon: <Hash size={11} />,
    label: "hash",
    badge: "badge-secondary",
  },
  list: {
    icon: <List size={11} />,
    label: "list",
    badge: "badge-accent",
  },
  set: {
    icon: <Layers size={11} />,
    label: "set",
    badge: "badge-warning",
  },
  zset: {
    icon: <BarChart2 size={11} />,
    label: "zset",
    badge: "badge-error",
  },
  stream: {
    icon: <Radio size={11} />,
    label: "stream",
    badge: "badge-primary",
  },
  json: {
    icon: <Braces size={11} />,
    label: "json",
    badge: "badge-success",
  },
};

function formatTTL(ttl: number): string {
  if (ttl === -1) return "";
  if (ttl < 60) return `${ttl}s`;
  if (ttl < 3600) return `${Math.floor(ttl / 60)}m`;
  if (ttl < 86400) return `${Math.floor(ttl / 3600)}h`;
  return `${Math.floor(ttl / 86400)}d`;
}

interface TreeGroupBuilder {
  id: string;
  label: string;
  depth: number;
  keyCount: number;
  groups: Map<string, TreeGroupBuilder>;
  keys: Array<{ redisKey: RedisKey; label: string }>;
}

function createGroupBuilder(id: string, label: string, depth: number): TreeGroupBuilder {
  return {
    id,
    label,
    depth,
    keyCount: 0,
    groups: new Map(),
    keys: [],
  };
}

function buildTree(keys: RedisKey[], separator: string): KeyTreeNode[] {
  if (!separator) {
    return keys.map((redisKey) => ({
      kind: "key",
      redisKey,
      label: redisKey.key,
      depth: 0,
    }));
  }

  const root = createGroupBuilder("__root__", "__root__", -1);

  keys.forEach((redisKey) => {
    const parts = redisKey.key.split(separator).filter((part) => part.length > 0);

    if (parts.length <= 1) {
      root.keys.push({
        redisKey,
        label: redisKey.key,
      });
      return;
    }

    let current = root;

    parts.slice(0, -1).forEach((segment, index) => {
      const groupId = parts.slice(0, index + 1).join(separator);
      let nextGroup = current.groups.get(segment);

      if (!nextGroup) {
        nextGroup = createGroupBuilder(groupId, segment, index);
        current.groups.set(segment, nextGroup);
      }

      nextGroup.keyCount += 1;
      current = nextGroup;
    });

    current.keys.push({
      redisKey,
      label: parts[parts.length - 1] ?? redisKey.key,
    });
  });

  const serialize = (group: TreeGroupBuilder): KeyTreeNode[] => {
    const childGroups = Array.from(group.groups.values())
      .sort((left, right) => left.label.localeCompare(right.label))
      .map<KeyTreeNode>((childGroup) => ({
        kind: "group",
        id: childGroup.id,
        label: childGroup.label,
        depth: childGroup.depth,
        keyCount: childGroup.keyCount,
        children: serialize(childGroup),
      }));

    const childKeys = group.keys
      .slice()
      .sort((left, right) => left.label.localeCompare(right.label))
      .map<KeyTreeNode>(({ redisKey, label }) => ({
        kind: "key",
        redisKey,
        label,
        depth: group.depth + 1,
      }));

    return [...childGroups, ...childKeys];
  };

  return serialize(root);
}

export function KeyBrowser({
  connection,
  selectedDb,
  onSelectDb,
  isRefreshing,
  onRefresh,
  keySeparator,
  keys,
  selectedKey,
  onSelectKey,
  searchQuery,
  onSearchChange,
}: KeyBrowserProps) {
  const { messages } = useI18n();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const hasConnection = Boolean(connection);

  const filtered = useMemo(() => {
    const q = searchQuery.replace(/\*/g, "").toLowerCase();
    if (!q) return keys;
    return keys.filter((k) => k.key.toLowerCase().includes(q));
  }, [keys, searchQuery]);

  const tree = useMemo(
    () => buildTree(filtered, keySeparator),
    [filtered, keySeparator]
  );

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const typeConfig = TYPE_CONFIG;

  return (
    <div className="flex flex-col w-64 bg-base-200 border-r border-base-100/50 h-full shrink-0">
      {/* Header */}
      <div data-tauri-drag-region className="px-3 border-b border-base-100/50 shrink-0 select-none" style={{ paddingTop: "10px", paddingBottom: "10px" }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-mono font-semibold text-base-content/70 uppercase tracking-wider">
              {messages.keyBrowser.title}
            </span>
            <span className="badge badge-xs badge-ghost font-mono">
              {filtered.length}
            </span>
          </div>
          <button
            onClick={onRefresh}
            disabled={!hasConnection || isRefreshing}
            className={`btn btn-ghost btn-xs w-6 h-6 p-0 ${hasConnection && !isRefreshing ? "cursor-pointer" : "cursor-not-allowed opacity-40"}`}
            aria-label={messages.keyBrowser.refresh}
          >
            <RefreshCw
              size={11}
              className={isRefreshing ? "animate-spin" : ""}
            />
          </button>
        </div>

        {/* DB selector */}
        <select
          value={selectedDb}
          onChange={(e) => onSelectDb(Number(e.target.value))}
          disabled={!hasConnection}
          className={`select select-xs w-full bg-base-300 border-base-100/50 font-mono text-xs mb-2 ${hasConnection ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
        >
          {Array.from({ length: 16 }, (_, i) => (
            <option key={i} value={i}>
              db{i} {i === 0 ? messages.keyBrowser.activeDb : ""}
            </option>
          ))}
        </select>

        {/* Search */}
        <label className="input input-xs flex items-center gap-1.5 bg-base-300 border-base-100/50">
          <Search size={11} className="text-base-content/40 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            disabled={!hasConnection}
            placeholder={messages.keyBrowser.filterPlaceholder}
            className="grow font-mono text-xs bg-transparent outline-none user-select-text"
          />
        </label>
      </div>

      {/* Key list */}
      <div className="flex-1 overflow-y-auto py-1">
        {!hasConnection ? (
          <div className="flex h-full flex-col items-center justify-center px-4 py-8 text-center">
            <EmptyConnectionsIllustration />
            <h3 className="mt-5 text-sm text-base-content/90">
              {messages.app.emptyState.title}
            </h3>
          </div>
        ) : (
          <>
            {tree.map((node) => (
              <KeyTreeItem
                key={node.kind === "group" ? node.id : node.redisKey.key}
                node={node}
                expandedGroups={expandedGroups}
                onToggleGroup={toggleGroup}
                selectedKey={selectedKey}
                onSelectKey={onSelectKey}
                typeConfig={typeConfig}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function KeyTreeItem({
  node,
  expandedGroups,
  onToggleGroup,
  selectedKey,
  onSelectKey,
  typeConfig,
}: {
  node: KeyTreeNode;
  expandedGroups: Set<string>;
  onToggleGroup: (group: string) => void;
  selectedKey: RedisKey | null;
  onSelectKey: (key: RedisKey) => void;
  typeConfig: typeof TYPE_CONFIG;
}) {
  if (node.kind === "group") {
    const isExpanded = expandedGroups.has(node.id);

    return (
      <div>
        <button
          onClick={() => onToggleGroup(node.id)}
          className="flex items-center gap-1.5 w-full px-3 py-1.5 hover:bg-base-100/40 transition-colors duration-150 cursor-pointer group"
          style={{ paddingLeft: `${12 + node.depth * 12}px` }}
        >
          <ChevronDown
            size={11}
            className={`text-base-content/40 transition-transform duration-200 shrink-0 ${
              isExpanded ? "" : "-rotate-90"
            }`}
          />
          <span className="text-xs font-mono text-base-content/60 truncate group-hover:text-base-content/80">
            {node.label}
          </span>
          <span className="ml-auto badge badge-xs badge-ghost font-mono text-[9px] shrink-0">
            {node.keyCount}
          </span>
        </button>
        {isExpanded && (
          <div>
            {node.children.map((childNode) => (
              <KeyTreeItem
                key={
                  childNode.kind === "group"
                    ? childNode.id
                    : childNode.redisKey.key
                }
                node={childNode}
                expandedGroups={expandedGroups}
                onToggleGroup={onToggleGroup}
                selectedKey={selectedKey}
                onSelectKey={onSelectKey}
                typeConfig={typeConfig}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <KeyRow
      redisKey={node.redisKey}
      label={node.label}
      depth={node.depth}
      isSelected={selectedKey?.key === node.redisKey.key}
      onClick={() => onSelectKey(node.redisKey)}
      typeConfig={typeConfig}
    />
  );
}

function KeyRow({
  redisKey,
  label,
  depth,
  isSelected,
  onClick,
  typeConfig,
}: {
  redisKey: RedisKey;
  label: string;
  depth: number;
  isSelected: boolean;
  onClick: () => void;
  typeConfig: typeof TYPE_CONFIG;
}) {
  const cfg = typeConfig[redisKey.type];
  const ttl = formatTTL(redisKey.ttl);

  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-2 w-full px-3 py-1.5 cursor-pointer transition-colors duration-150 text-left
        ${
          isSelected
            ? "bg-success/10 text-success"
            : "hover:bg-base-100/40 text-base-content/70 hover:text-base-content"
        }
      `}
      style={{ paddingLeft: `${12 + depth * 12}px` }}
    >
      <span
        className={`shrink-0 ${isSelected ? "text-success" : "text-base-content/30"}`}
      >
        {cfg.icon}
      </span>
      <span className="text-xs font-mono truncate flex-1 min-w-0">
        {label}
      </span>
      {ttl && (
        <span className="text-[9px] text-warning/70 font-mono shrink-0">
          {ttl}
        </span>
      )}
    </button>
  );
}
