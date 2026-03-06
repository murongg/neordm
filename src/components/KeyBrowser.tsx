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

interface KeyBrowserProps {
  connection?: RedisConnection;
  selectedDb: number;
  onSelectDb: (db: number) => void;
  keys: RedisKey[];
  selectedKey: RedisKey | null;
  onSelectKey: (key: RedisKey) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

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

// Build a tree from flat key list
function buildTree(keys: RedisKey[], separator = ":") {
  const grouped: Record<string, RedisKey[]> = {};
  const singles: RedisKey[] = [];

  keys.forEach((k) => {
    const parts = k.key.split(separator);
    if (parts.length > 1) {
      const prefix = parts[0];
      if (!grouped[prefix]) grouped[prefix] = [];
      grouped[prefix].push(k);
    } else {
      singles.push(k);
    }
  });
  return { grouped, singles };
}

export function KeyBrowser({
  connection,
  selectedDb,
  onSelectDb,
  keys,
  selectedKey,
  onSelectKey,
  searchQuery,
  onSearchChange,
}: KeyBrowserProps) {
  void connection; // reserved for future connection-aware filtering
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(["user", "cache", "queue", "leaderboard"])
  );
  const [isRefreshing, setIsRefreshing] = useState(false);

  const filtered = useMemo(() => {
    const q = searchQuery.replace(/\*/g, "").toLowerCase();
    if (!q) return keys;
    return keys.filter((k) => k.key.toLowerCase().includes(q));
  }, [keys, searchQuery]);

  const { grouped, singles } = useMemo(() => buildTree(filtered), [filtered]);

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 800);
  };

  const typeConfig = TYPE_CONFIG;

  return (
    <div className="flex flex-col w-64 bg-base-200 border-r border-base-100/50 h-full shrink-0">
      {/* Header */}
      <div data-tauri-drag-region className="px-3 border-b border-base-100/50 shrink-0 select-none" style={{ paddingTop: "10px", paddingBottom: "10px" }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-mono font-semibold text-base-content/70 uppercase tracking-wider">
              Keys
            </span>
            <span className="badge badge-xs badge-ghost font-mono">
              {filtered.length}
            </span>
          </div>
          <button
            onClick={handleRefresh}
            className="btn btn-ghost btn-xs w-6 h-6 p-0 cursor-pointer"
            aria-label="Refresh"
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
          className="select select-xs w-full bg-base-300 border-base-100/50 font-mono text-xs cursor-pointer mb-2"
        >
          {Array.from({ length: 16 }, (_, i) => (
            <option key={i} value={i}>
              db{i} {i === 0 ? "(active)" : ""}
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
            placeholder="Filter keys..."
            className="grow font-mono text-xs bg-transparent outline-none user-select-text"
          />
        </label>
      </div>

      {/* Key list */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* Grouped keys */}
        {Object.entries(grouped).map(([group, groupKeys]) => {
          const isExpanded = expandedGroups.has(group);
          return (
            <div key={group}>
              <button
                onClick={() => toggleGroup(group)}
                className="flex items-center gap-1.5 w-full px-3 py-1.5 hover:bg-base-100/40 transition-colors duration-150 cursor-pointer group"
              >
                <ChevronDown
                  size={11}
                  className={`text-base-content/40 transition-transform duration-200 shrink-0 ${
                    isExpanded ? "" : "-rotate-90"
                  }`}
                />
                <span className="text-xs font-mono text-base-content/60 truncate group-hover:text-base-content/80">
                  {group}
                </span>
                <span className="ml-auto badge badge-xs badge-ghost font-mono text-[9px] shrink-0">
                  {groupKeys.length}
                </span>
              </button>
              {isExpanded && (
                <div>
                  {groupKeys.map((key) => (
                    <KeyRow
                      key={key.key}
                      redisKey={key}
                      isSelected={selectedKey?.key === key.key}
                      onClick={() => onSelectKey(key)}
                      typeConfig={typeConfig}
                      indent
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {/* Ungrouped keys */}
        {singles.map((key) => (
          <KeyRow
            key={key.key}
            redisKey={key}
            isSelected={selectedKey?.key === key.key}
            onClick={() => onSelectKey(key)}
            typeConfig={typeConfig}
          />
        ))}
      </div>
    </div>
  );
}

function KeyRow({
  redisKey,
  isSelected,
  onClick,
  typeConfig,
  indent = false,
}: {
  redisKey: RedisKey;
  isSelected: boolean;
  onClick: () => void;
  typeConfig: typeof TYPE_CONFIG;
  indent?: boolean;
}) {
  const cfg = typeConfig[redisKey.type];
  const ttl = formatTTL(redisKey.ttl);
  const parts = redisKey.key.split(":");
  const displayName = indent ? parts.slice(1).join(":") : redisKey.key;

  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-2 w-full px-3 py-1.5 cursor-pointer transition-colors duration-150 text-left
        ${indent ? "pl-6" : ""}
        ${
          isSelected
            ? "bg-success/10 text-success"
            : "hover:bg-base-100/40 text-base-content/70 hover:text-base-content"
        }
      `}
    >
      <span
        className={`shrink-0 ${isSelected ? "text-success" : "text-base-content/30"}`}
      >
        {cfg.icon}
      </span>
      <span className="text-xs font-mono truncate flex-1 min-w-0">
        {displayName}
      </span>
      {ttl && (
        <span className="text-[9px] text-warning/70 font-mono shrink-0">
          {ttl}
        </span>
      )}
    </button>
  );
}
