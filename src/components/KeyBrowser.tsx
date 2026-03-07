import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Search,
  RefreshCw,
  ChevronDown,
  LoaderCircle,
  Hash,
  List,
  ListChevronsDownUp,
  ListChevronsUpDown,
  Layers,
  AlignLeft,
  BarChart2,
  Radio,
  Braces,
} from "lucide-react";
import type { RedisConnection, RedisKey, RedisKeyType } from "../types";
import { useI18n } from "../i18n";
import { EmptyConnectionsIllustration } from "./EmptyConnectionsIllustration";
import { getRedisErrorMessage } from "../lib/redis";

interface KeyBrowserProps {
  connection?: RedisConnection;
  selectedDb: number;
  onSelectDb: (db: number) => void;
  isRefreshing: boolean;
  onRefresh: () => void;
  keySeparator: string;
  showKeyType: boolean;
  showTtl: boolean;
  keys: RedisKey[];
  selectedKey: RedisKey | null;
  onSelectKey: (key: RedisKey) => void;
  onRenameKey: (key: RedisKey, nextKeyName: string) => Promise<RedisKey | void>;
  onRenameGroup: (
    groupId: string,
    nextGroupId: string,
    separator: string
  ) => Promise<Array<{ oldKey: string; newKey: string }>>;
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

function createGroupBuilder(
  id: string,
  label: string,
  depth: number
): TreeGroupBuilder {
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
    const parts = redisKey.key
      .split(separator)
      .filter((part) => part.length > 0);

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

function getParentGroupIds(key: string, separator: string) {
  if (!separator) return [];

  const parts = key.split(separator).filter((part) => part.length > 0);

  if (parts.length <= 1) return [];

  return parts
    .slice(0, -1)
    .map((_, index) => parts.slice(0, index + 1).join(separator));
}

function getRenameTarget(key: string, separator: string) {
  if (!separator) {
    return {
      draftValue: key,
      nextFullKey: (nextSegment: string) => nextSegment,
      isScopedSegment: false,
    };
  }

  const parts = key.split(separator).filter((part) => part.length > 0);

  if (parts.length <= 1) {
    return {
      draftValue: key,
      nextFullKey: (nextSegment: string) => nextSegment,
      isScopedSegment: false,
    };
  }

  const lastSeparatorIndex = key.lastIndexOf(separator);

  if (lastSeparatorIndex === -1) {
    return {
      draftValue: key,
      nextFullKey: (nextSegment: string) => nextSegment,
      isScopedSegment: false,
    };
  }

  const prefix = key.slice(0, lastSeparatorIndex + separator.length);
  const currentSegment = key.slice(lastSeparatorIndex + separator.length);

  return {
    draftValue: currentSegment,
    nextFullKey: (nextSegment: string) => `${prefix}${nextSegment}`,
    isScopedSegment: true,
  };
}

function getGroupRenameTarget(groupId: string, label: string, separator: string) {
  if (!separator) {
    return {
      draftValue: label,
      nextGroupId: (nextSegment: string) => nextSegment,
    };
  }

  const lastSeparatorIndex = groupId.lastIndexOf(separator);

  if (lastSeparatorIndex === -1) {
    return {
      draftValue: label,
      nextGroupId: (nextSegment: string) => nextSegment,
    };
  }

  const prefix = groupId.slice(0, lastSeparatorIndex + separator.length);

  return {
    draftValue: label,
    nextGroupId: (nextSegment: string) => `${prefix}${nextSegment}`,
  };
}

function isKeyInGroup(key: string, groupId: string, separator: string) {
  return key.startsWith(`${groupId}${separator}`);
}

function renameGroupedKey(
  key: string,
  groupId: string,
  nextGroupId: string
) {
  return `${nextGroupId}${key.slice(groupId.length)}`;
}

function collectGroupIds(node: KeyTreeGroupNode): string[] {
  return [
    node.id,
    ...node.children.flatMap((childNode) =>
      childNode.kind === "group" ? collectGroupIds(childNode) : []
    ),
  ];
}

function collectTreeGroupIds(nodes: KeyTreeNode[]): string[] {
  return nodes.flatMap((node) =>
    node.kind === "group" ? collectGroupIds(node) : []
  );
}

function hasGroupId(nodes: KeyTreeNode[], groupId: string): boolean {
  return nodes.some((node) => {
    if (node.kind !== "group") return false;
    if (node.id === groupId) return true;
    return hasGroupId(node.children, groupId);
  });
}

function placeInputCursorAtEnd(input: HTMLInputElement | null) {
  if (!input) return;

  const end = input.value.length;
  input.setSelectionRange(end, end);
  input.scrollLeft = input.scrollWidth;
}

export function KeyBrowser({
  connection,
  selectedDb,
  onSelectDb,
  isRefreshing,
  onRefresh,
  keySeparator,
  showKeyType,
  showTtl,
  keys,
  selectedKey,
  onSelectKey,
  onRenameKey,
  onRenameGroup,
  searchQuery,
  onSearchChange,
}: KeyBrowserProps) {
  const { messages } = useI18n();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingKeyName, setEditingKeyName] = useState<string | null>(null);
  const [pendingSelectedKeyName, setPendingSelectedKeyName] = useState<
    string | null
  >(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [groupMotionIds, setGroupMotionIds] = useState<Record<string, string>>(
    {}
  );
  const [keyMotionIds, setKeyMotionIds] = useState<Record<string, string>>({});
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const motionElementsRef = useRef<Map<string, HTMLElement>>(new Map());
  const previousPositionsRef = useRef<Map<string, number>>(new Map());
  const motionCleanupTimersRef = useRef<Map<string, number>>(new Map());
  const pendingKeySelectTimerRef = useRef<number | null>(null);
  const pendingReorderAnimationRef = useRef(false);
  const pendingRenameKeysRef = useRef<{
    oldKey: string;
    newKey: string;
  } | null>(null);
  const hasConnection = Boolean(connection);

  const filtered = useMemo(() => {
    const q = searchQuery.replace(/\*/g, "").toLowerCase();
    if (!q) return keys;
    return keys.filter((keyItem) => keyItem.key.toLowerCase().includes(q));
  }, [keys, searchQuery]);

  const tree = useMemo(
    () => buildTree(filtered, keySeparator),
    [filtered, keySeparator]
  );
  const visibleGroupIds = useMemo(() => collectTreeGroupIds(tree), [tree]);
  const hasVisibleGroups = visibleGroupIds.length > 0;
  const hasExpandedVisibleGroups = useMemo(
    () => visibleGroupIds.some((groupId) => expandedGroups.has(groupId)),
    [expandedGroups, visibleGroupIds]
  );
  const areAllVisibleGroupsExpanded = useMemo(
    () =>
      hasVisibleGroups &&
      visibleGroupIds.every((groupId) => expandedGroups.has(groupId)),
    [expandedGroups, hasVisibleGroups, visibleGroupIds]
  );

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const setMotionElement = useCallback(
    (id: string, element: HTMLElement | null) => {
      const current = motionElementsRef.current;
      const activeTimer = motionCleanupTimersRef.current.get(id);

      if (!element) {
        if (activeTimer) {
          window.clearTimeout(activeTimer);
          motionCleanupTimersRef.current.delete(id);
        }
        current.delete(id);
        return;
      }

      current.set(id, element);
    },
    []
  );

  const getKeyMotionId = useCallback(
    (key: string) => {
      const pendingRename = pendingRenameKeysRef.current;

      if (pendingRename?.newKey === key) {
        return (
          keyMotionIds[key] ??
          keyMotionIds[pendingRename.oldKey] ??
          pendingRename.oldKey
        );
      }

      return keyMotionIds[key] ?? key;
    },
    [keyMotionIds]
  );

  const getGroupMotionId = useCallback(
    (groupId: string) => groupMotionIds[groupId] ?? groupId,
    [groupMotionIds]
  );

  const clearPendingKeySelection = useCallback(() => {
    if (pendingKeySelectTimerRef.current) {
      window.clearTimeout(pendingKeySelectTimerRef.current);
      pendingKeySelectTimerRef.current = null;
    }

    setPendingSelectedKeyName(null);
  }, []);

  const cancelRename = useCallback(() => {
    clearPendingKeySelection();
    setEditingGroupId(null);
    setEditingKeyName(null);
    setRenameDraft("");
    setRenameError("");
    setIsRenaming(false);
  }, [clearPendingKeySelection]);

  const expandAllGroups = useCallback(() => {
    if (!visibleGroupIds.length) return;

    setExpandedGroups((prev) => {
      const next = new Set(prev);
      visibleGroupIds.forEach((groupId) => {
        next.add(groupId);
      });
      return next;
    });
  }, [visibleGroupIds]);

  const collapseAllGroups = useCallback(() => {
    if (!hasExpandedVisibleGroups) return;

    cancelRename();
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      visibleGroupIds.forEach((groupId) => {
        next.delete(groupId);
      });
      return next;
    });
  }, [cancelRename, hasExpandedVisibleGroups, visibleGroupIds]);

  const toggleAllGroups = useCallback(() => {
    if (areAllVisibleGroupsExpanded) {
      collapseAllGroups();
      return;
    }

    expandAllGroups();
  }, [
    areAllVisibleGroupsExpanded,
    collapseAllGroups,
    expandAllGroups,
  ]);

  const startRename = useCallback((redisKey: RedisKey) => {
    const renameTarget = getRenameTarget(redisKey.key, keySeparator);

    clearPendingKeySelection();
    setEditingGroupId(null);
    setEditingKeyName(redisKey.key);
    setRenameDraft(renameTarget.draftValue);
    setRenameError("");
    setIsRenaming(false);
  }, [clearPendingKeySelection, keySeparator]);

  const startGroupRename = useCallback(
    (group: KeyTreeGroupNode) => {
      const renameTarget = getGroupRenameTarget(
        group.id,
        group.label,
        keySeparator
      );

      clearPendingKeySelection();
      setEditingKeyName(null);
      setEditingGroupId(group.id);
      setRenameDraft(renameTarget.draftValue);
      setRenameError("");
      setIsRenaming(false);
    },
    [clearPendingKeySelection, keySeparator]
  );

  const handleRenameDraftChange = useCallback((value: string) => {
    setRenameDraft(value);
    setRenameError("");
  }, []);

  const submitRename = useCallback(
    async (redisKey: RedisKey) => {
      if (isRenaming) return;

      const renameTarget = getRenameTarget(redisKey.key, keySeparator);

      if (!renameDraft.length) {
        setRenameError("Key name cannot be empty");
        requestAnimationFrame(() => {
          renameInputRef.current?.focus({ preventScroll: true });
          renameInputRef.current?.select();
        });
        return;
      }

      if (
        renameTarget.isScopedSegment &&
        keySeparator &&
        renameDraft.includes(keySeparator)
      ) {
        setRenameError(`Key segment cannot include "${keySeparator}"`);
        requestAnimationFrame(() => {
          renameInputRef.current?.focus({ preventScroll: true });
          renameInputRef.current?.select();
        });
        return;
      }

      const nextKeyName = renameTarget.nextFullKey(renameDraft);

      if (nextKeyName === redisKey.key) {
        cancelRename();
        return;
      }

      setIsRenaming(true);
      setRenameError("");
      pendingRenameKeysRef.current = {
        oldKey: redisKey.key,
        newKey: nextKeyName,
      };

      try {
        await onRenameKey(redisKey, nextKeyName);
        pendingReorderAnimationRef.current = true;
        setKeyMotionIds((previous) => {
          const motionId = previous[redisKey.key] ?? redisKey.key;
          const next = { ...previous };

          delete next[redisKey.key];
          next[nextKeyName] = motionId;

          return next;
        });

        setExpandedGroups((prev) => {
          const next = new Set(prev);

          getParentGroupIds(nextKeyName, keySeparator).forEach((groupId) => {
            next.add(groupId);
          });

          return next;
        });

        cancelRename();
      } catch (error) {
        pendingRenameKeysRef.current = null;
        setRenameError(getRedisErrorMessage(error));
        requestAnimationFrame(() => {
          renameInputRef.current?.focus({ preventScroll: true });
          renameInputRef.current?.select();
        });
      } finally {
        setIsRenaming(false);
      }
    },
    [cancelRename, isRenaming, keySeparator, onRenameKey, renameDraft]
  );

  const submitGroupRename = useCallback(
    async (group: KeyTreeGroupNode) => {
      if (isRenaming) return;

      const renameTarget = getGroupRenameTarget(
        group.id,
        group.label,
        keySeparator
      );

      if (!renameDraft.length) {
        setRenameError("Group name cannot be empty");
        requestAnimationFrame(() => {
          renameInputRef.current?.focus({ preventScroll: true });
          renameInputRef.current?.select();
        });
        return;
      }

      if (keySeparator && renameDraft.includes(keySeparator)) {
        setRenameError(`Group segment cannot include "${keySeparator}"`);
        requestAnimationFrame(() => {
          renameInputRef.current?.focus({ preventScroll: true });
          renameInputRef.current?.select();
        });
        return;
      }

      const nextGroupId = renameTarget.nextGroupId(renameDraft);

      if (nextGroupId === group.id) {
        cancelRename();
        return;
      }

      const affectedGroupIds = collectGroupIds(group);
      const renamedGroupIdMap = new Map(
        affectedGroupIds.map((groupId) => [
          groupId,
          `${nextGroupId}${groupId.slice(group.id.length)}`,
        ])
      );

      const affectedKeyPairs = keys
        .filter((keyItem) => isKeyInGroup(keyItem.key, group.id, keySeparator))
        .map((keyItem) => ({
          oldKey: keyItem.key,
          newKey: renameGroupedKey(keyItem.key, group.id, nextGroupId),
        }));

      setIsRenaming(true);
      setRenameError("");

      try {
        const renamedPairs = await onRenameGroup(
          group.id,
          nextGroupId,
          keySeparator
        );

        pendingReorderAnimationRef.current = true;

        setKeyMotionIds((previous) => {
          const next = { ...previous };

          affectedKeyPairs.forEach(({ oldKey, newKey }) => {
            const motionId = previous[oldKey] ?? oldKey;
            delete next[oldKey];
            next[newKey] = motionId;
          });

          return next;
        });

        setGroupMotionIds((previous) => {
          const next = { ...previous };

          renamedGroupIdMap.forEach((newId, oldId) => {
            const motionId = previous[oldId] ?? oldId;
            delete next[oldId];
            next[newId] = motionId;
          });

          return next;
        });

        if (renamedPairs.length) {
          setExpandedGroups((previous) => {
            const next = new Set<string>();

            previous.forEach((groupId) => {
              if (groupId === group.id || groupId.startsWith(`${group.id}${keySeparator}`)) {
                const renamedGroupId = renamedGroupIdMap.get(groupId);

                if (renamedGroupId) {
                  next.add(renamedGroupId);
                }

                return;
              }

              next.add(groupId);
            });

            getParentGroupIds(nextGroupId, keySeparator).forEach((groupId) => {
              next.add(groupId);
            });

            next.add(nextGroupId);

            return next;
          });
        }

        cancelRename();
      } catch (error) {
        setRenameError(getRedisErrorMessage(error));
        requestAnimationFrame(() => {
          renameInputRef.current?.focus({ preventScroll: true });
          renameInputRef.current?.select();
        });
      } finally {
        setIsRenaming(false);
      }
    },
    [cancelRename, isRenaming, keySeparator, keys, onRenameGroup, renameDraft]
  );

  useEffect(() => {
    if (!editingKeyName) return;

    if (keys.some((keyItem) => keyItem.key === editingKeyName)) return;

    cancelRename();
  }, [cancelRename, editingKeyName, keys]);

  useEffect(() => {
    if (selectedKey?.key !== pendingSelectedKeyName) return;

    setPendingSelectedKeyName(null);
  }, [pendingSelectedKeyName, selectedKey?.key]);

  useEffect(() => {
    if (!editingGroupId) return;

    if (hasGroupId(tree, editingGroupId)) return;

    cancelRename();
  }, [cancelRename, editingGroupId, tree]);

  useEffect(() => {
    setKeyMotionIds((previous) => {
      const validKeys = new Set(keys.map((keyItem) => keyItem.key));
      let didChange = false;
      const next: Record<string, string> = {};

      Object.entries(previous).forEach(([key, motionId]) => {
        if (validKeys.has(key)) {
          next[key] = motionId;
          return;
        }

        didChange = true;
      });

      return didChange ? next : previous;
    });
  }, [keys]);

  useEffect(() => {
    setGroupMotionIds((previous) => {
      const validGroupIds = new Set(collectTreeGroupIds(tree));
      let didChange = false;
      const next: Record<string, string> = {};

      Object.entries(previous).forEach(([groupId, motionId]) => {
        if (validGroupIds.has(groupId)) {
          next[groupId] = motionId;
          return;
        }

        didChange = true;
      });

      return didChange ? next : previous;
    });
  }, [tree]);

  useLayoutEffect(() => {
    const nextPositions = new Map<string, number>();

    motionElementsRef.current.forEach((element, id) => {
      nextPositions.set(id, element.getBoundingClientRect().top);
    });

    const shouldAnimate = pendingReorderAnimationRef.current;
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    if (shouldAnimate && !prefersReducedMotion) {
      nextPositions.forEach((nextTop, id) => {
        const previousTop = previousPositionsRef.current.get(id);
        const element = motionElementsRef.current.get(id);

        if (!element || previousTop === undefined) return;

        const deltaY = previousTop - nextTop;

        if (Math.abs(deltaY) < 1) return;

        const activeTimer = motionCleanupTimersRef.current.get(id);

        if (activeTimer) {
          window.clearTimeout(activeTimer);
        }

        element.style.transition = "none";
        element.style.transform = `translateY(${deltaY}px)`;
        element.style.willChange = "transform";

        void element.getBoundingClientRect();

        requestAnimationFrame(() => {
          const target = motionElementsRef.current.get(id);

          if (!target) return;

          target.style.transition = "transform 180ms linear";
          target.style.transform = "translateY(0)";

          const cleanupTimer = window.setTimeout(() => {
            const currentElement = motionElementsRef.current.get(id);

            if (!currentElement) return;

            currentElement.style.transition = "";
            currentElement.style.transform = "";
            currentElement.style.willChange = "";
            motionCleanupTimersRef.current.delete(id);
          }, 220);

          motionCleanupTimersRef.current.set(id, cleanupTimer);
        });
      });
    }

    previousPositionsRef.current = nextPositions;
    pendingReorderAnimationRef.current = false;
    pendingRenameKeysRef.current = null;
  }, [expandedGroups, groupMotionIds, keyMotionIds, tree]);

  useEffect(() => {
    return () => {
      if (pendingKeySelectTimerRef.current) {
        window.clearTimeout(pendingKeySelectTimerRef.current);
      }

      motionCleanupTimersRef.current.forEach((timer) => {
        window.clearTimeout(timer);
      });
      motionCleanupTimersRef.current.clear();
    };
  }, []);

  useLayoutEffect(() => {
    if (!editingKeyName && !editingGroupId) return;

    const input = renameInputRef.current;
    if (!input) return;

    placeInputCursorAtEnd(input);
  }, [editingGroupId, editingKeyName]);

  const handleKeyClick = useCallback(
    (key: RedisKey) => {
      if (editingKeyName === key.key) return;

      if (selectedKey?.key === key.key) {
        clearPendingKeySelection();
        void onSelectKey(key);
        return;
      }

      clearPendingKeySelection();
      setPendingSelectedKeyName(key.key);

      pendingKeySelectTimerRef.current = window.setTimeout(() => {
        pendingKeySelectTimerRef.current = null;
        void onSelectKey(key);
      }, 180);
    },
    [clearPendingKeySelection, editingKeyName, onSelectKey, selectedKey?.key]
  );

  const activeSelectedKeyName =
    editingKeyName ?? pendingSelectedKeyName ?? selectedKey?.key ?? null;

  const typeConfig = TYPE_CONFIG;

  return (
    <div className="flex flex-col w-64 bg-base-200 border-r border-base-100/50 h-full shrink-0">
      <div
        data-tauri-drag-region
        className="px-3 border-b border-base-100/50 shrink-0 select-none"
        style={{ paddingTop: "10px", paddingBottom: "10px" }}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-mono font-semibold text-base-content/70 uppercase tracking-wider">
              {messages.keyBrowser.title}
            </span>
            <span className="badge badge-xs badge-ghost font-mono">
              {filtered.length}
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={toggleAllGroups}
              disabled={!hasConnection || !hasVisibleGroups}
              className={`btn btn-ghost btn-xs h-6 w-6 p-0 text-base-content/60 hover:bg-base-100/60 hover:text-base-content/90 ${
                hasConnection && hasVisibleGroups
                  ? "cursor-pointer"
                  : "cursor-not-allowed opacity-40"
              }`}
              aria-label={
                areAllVisibleGroupsExpanded
                  ? messages.keyBrowser.collapseAll
                  : messages.keyBrowser.expandAll
              }
              title={
                areAllVisibleGroupsExpanded
                  ? messages.keyBrowser.collapseAll
                  : messages.keyBrowser.expandAll
              }
            >
              {areAllVisibleGroupsExpanded ? (
                <ListChevronsUpDown size={12} strokeWidth={2.25} />
              ) : (
                <ListChevronsDownUp size={12} strokeWidth={2.25} />
              )}
            </button>
            <button
              onClick={onRefresh}
              disabled={!hasConnection || isRefreshing}
              className={`btn btn-ghost btn-xs h-6 w-6 p-0 ${
                hasConnection && !isRefreshing
                  ? "cursor-pointer"
                  : "cursor-not-allowed opacity-40"
              }`}
              aria-label={messages.keyBrowser.refresh}
              title={messages.keyBrowser.refresh}
            >
              <RefreshCw size={11} className={isRefreshing ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        <select
          value={selectedDb}
          onChange={(event) => onSelectDb(Number(event.target.value))}
          disabled={!hasConnection}
          className={`select select-xs w-full bg-base-300 border-base-100/50 font-mono text-xs mb-2 ${
            hasConnection ? "cursor-pointer" : "cursor-not-allowed opacity-60"
          }`}
        >
          {Array.from({ length: 16 }, (_, index) => (
            <option key={index} value={index}>
              db{index} {index === 0 ? messages.keyBrowser.activeDb : ""}
            </option>
          ))}
        </select>

        <label className="input input-xs flex items-center gap-1.5 bg-base-300 border-base-100/50">
          <Search size={11} className="text-base-content/40 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            disabled={!hasConnection}
            placeholder={messages.keyBrowser.filterPlaceholder}
            className="grow font-mono text-xs bg-transparent outline-none user-select-text"
          />
        </label>
      </div>

      <div
        className="flex-1 overflow-y-auto py-1"
        style={{ scrollbarGutter: "stable" }}
      >
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
                key={
                  node.kind === "group"
                    ? `group:${getGroupMotionId(node.id)}`
                    : `key:${getKeyMotionId(node.redisKey.key)}`
                }
                node={node}
                expandedGroups={expandedGroups}
                onToggleGroup={toggleGroup}
                selectedKeyName={activeSelectedKeyName}
                onSelectKey={handleKeyClick}
                getGroupMotionId={getGroupMotionId}
                getKeyMotionId={getKeyMotionId}
                setMotionElement={setMotionElement}
                editingGroupId={editingGroupId}
                editingKeyName={editingKeyName}
                renameDraft={renameDraft}
                renameError={renameError}
                isRenaming={isRenaming}
                renameInputRef={renameInputRef}
                onStartRename={startRename}
                onStartGroupRename={startGroupRename}
                onRenameDraftChange={handleRenameDraftChange}
                onCancelRename={cancelRename}
                onSubmitRename={submitRename}
                onSubmitGroupRename={submitGroupRename}
                showKeyType={showKeyType}
                showTtl={showTtl}
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
  selectedKeyName,
  onSelectKey,
  getGroupMotionId,
  getKeyMotionId,
  setMotionElement,
  editingGroupId,
  editingKeyName,
  renameDraft,
  renameError,
  isRenaming,
  renameInputRef,
  onStartRename,
  onStartGroupRename,
  onRenameDraftChange,
  onCancelRename,
  onSubmitRename,
  onSubmitGroupRename,
  showKeyType,
  showTtl,
  typeConfig,
}: {
  node: KeyTreeNode;
  expandedGroups: Set<string>;
  onToggleGroup: (group: string) => void;
  selectedKeyName: string | null;
  onSelectKey: (key: RedisKey) => void;
  getGroupMotionId: (groupId: string) => string;
  getKeyMotionId: (key: string) => string;
  setMotionElement: (id: string, element: HTMLElement | null) => void;
  editingGroupId: string | null;
  editingKeyName: string | null;
  renameDraft: string;
  renameError: string;
  isRenaming: boolean;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  onStartRename: (key: RedisKey) => void;
  onStartGroupRename: (group: KeyTreeGroupNode) => void;
  onRenameDraftChange: (value: string) => void;
  onCancelRename: () => void;
  onSubmitRename: (key: RedisKey) => Promise<void>;
  onSubmitGroupRename: (group: KeyTreeGroupNode) => Promise<void>;
  showKeyType: boolean;
  showTtl: boolean;
  typeConfig: typeof TYPE_CONFIG;
}) {
  if (node.kind === "group") {
    const isExpanded = expandedGroups.has(node.id);
    const motionId = `group:${getGroupMotionId(node.id)}`;

    return (
      <div>
        <GroupRow
          motionId={motionId}
          setMotionElement={setMotionElement}
          group={node}
          isExpanded={isExpanded}
          isEditing={editingGroupId === node.id}
          renameDraft={renameDraft}
          renameError={renameError}
          isRenaming={isRenaming}
          renameInputRef={renameInputRef}
          onToggle={() => onToggleGroup(node.id)}
          onStartRename={() => onStartGroupRename(node)}
          onRenameDraftChange={onRenameDraftChange}
          onCancelRename={onCancelRename}
          onSubmitRename={() => onSubmitGroupRename(node)}
        />
        {isExpanded && (
          <div>
            {node.children.map((childNode) => (
              <KeyTreeItem
                key={
                  childNode.kind === "group"
                    ? `group:${getGroupMotionId(childNode.id)}`
                    : `key:${getKeyMotionId(childNode.redisKey.key)}`
                }
                node={childNode}
                expandedGroups={expandedGroups}
                onToggleGroup={onToggleGroup}
                selectedKeyName={selectedKeyName}
                onSelectKey={onSelectKey}
                getGroupMotionId={getGroupMotionId}
                getKeyMotionId={getKeyMotionId}
                setMotionElement={setMotionElement}
                editingGroupId={editingGroupId}
                editingKeyName={editingKeyName}
                renameDraft={renameDraft}
                renameError={renameError}
                isRenaming={isRenaming}
                renameInputRef={renameInputRef}
                onStartRename={onStartRename}
                onStartGroupRename={onStartGroupRename}
                onRenameDraftChange={onRenameDraftChange}
                onCancelRename={onCancelRename}
                onSubmitRename={onSubmitRename}
                onSubmitGroupRename={onSubmitGroupRename}
                showKeyType={showKeyType}
                showTtl={showTtl}
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
      motionId={`key:${getKeyMotionId(node.redisKey.key)}`}
      setMotionElement={setMotionElement}
      redisKey={node.redisKey}
      label={node.label}
      depth={node.depth}
      isSelected={selectedKeyName === node.redisKey.key}
      isEditing={editingKeyName === node.redisKey.key}
      renameDraft={renameDraft}
      renameError={renameError}
      isRenaming={isRenaming}
      renameInputRef={renameInputRef}
      onStartRename={() => onStartRename(node.redisKey)}
      onRenameDraftChange={onRenameDraftChange}
      onCancelRename={onCancelRename}
      onSubmitRename={() => onSubmitRename(node.redisKey)}
      onClick={() => onSelectKey(node.redisKey)}
      showKeyType={showKeyType}
      showTtl={showTtl}
      typeConfig={typeConfig}
    />
  );
}

function GroupRow({
  motionId,
  setMotionElement,
  group,
  isExpanded,
  isEditing,
  renameDraft,
  renameError,
  isRenaming,
  renameInputRef,
  onToggle,
  onStartRename,
  onRenameDraftChange,
  onCancelRename,
  onSubmitRename,
}: {
  motionId: string;
  setMotionElement: (id: string, element: HTMLElement | null) => void;
  group: KeyTreeGroupNode;
  isExpanded: boolean;
  isEditing: boolean;
  renameDraft: string;
  renameError: string;
  isRenaming: boolean;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  onToggle: () => void;
  onStartRename: () => void;
  onRenameDraftChange: (value: string) => void;
  onCancelRename: () => void;
  onSubmitRename: () => Promise<void>;
}) {
  const isRowRenaming = isEditing && isRenaming;
  const countSlot = (
    <span className="ml-auto flex h-5 shrink-0 items-center justify-end">
      <span
        className={`relative inline-flex h-4 min-w-7 items-center justify-center overflow-hidden rounded-full px-1.5 text-[9px] font-mono tabular-nums transition-colors duration-150 ${
          isEditing
            ? "bg-base-content/6 text-base-content/45"
            : "bg-base-content/6 text-base-content/60"
        }`}
      >
        <span className={isRowRenaming ? "opacity-0" : ""}>{group.keyCount}</span>
        {isRowRenaming ? (
          <span className="absolute inset-0 flex items-center justify-center">
            <LoaderCircle size={11} className="animate-spin" />
          </span>
        ) : null}
      </span>
    </span>
  );
  if (isEditing) {
    return (
      <div
        ref={(element) => setMotionElement(motionId, element)}
        className="flex h-8 w-full items-center gap-1.5 px-3 py-1.5 text-left bg-base-100/40 text-base-content/80 transition-colors duration-150"
        style={{ paddingLeft: `${12 + group.depth * 12}px` }}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-base-content/40">
          <ChevronDown
            size={11}
            className={`shrink-0 transition-transform duration-200 ${
              isExpanded ? "" : "-rotate-90"
            }`}
          />
        </span>
        <div className="flex h-5 min-w-0 flex-1 items-center">
          <input
            ref={renameInputRef}
            type="text"
            value={renameDraft}
            disabled={isRowRenaming}
            onChange={(event) => onRenameDraftChange(event.target.value)}
            onBlur={() => {
              void onSubmitRename();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void onSubmitRename();
              }

              if (event.key === "Escape") {
                event.preventDefault();
                onCancelRename();
              }
            }}
            onFocus={(event) => {
              placeInputCursorAtEnd(event.currentTarget);
            }}
            aria-invalid={Boolean(renameError)}
            title={renameError || group.label}
            className={`relative translate-y-[-0.5px] block h-4 w-full min-w-0 appearance-none border-0 bg-transparent px-0 text-xs leading-4 font-mono outline-none ${
              renameError ? "text-error" : "text-base-content/70"
            }`}
            spellCheck={false}
            autoFocus
          />
        </div>
        {countSlot}
      </div>
    );
  }

  return (
    <div
      ref={(element) => setMotionElement(motionId, element)}
      className="flex h-8 w-full items-center gap-1.5 px-3 py-1.5 text-left hover:bg-base-100/40 transition-colors duration-150 group"
      style={{ paddingLeft: `${12 + group.depth * 12}px` }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-base-content/40 transition-colors duration-150 hover:text-base-content/70 cursor-pointer"
        aria-label={isExpanded ? "Collapse group" : "Expand group"}
      >
        <ChevronDown
          size={11}
          className={`shrink-0 transition-transform duration-200 ${
            isExpanded ? "" : "-rotate-90"
          }`}
        />
      </button>
      <button
        type="button"
        onClick={(event) => {
          if (event.detail === 1) {
            onToggle();
          }
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onStartRename();
        }}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left cursor-pointer"
        title={group.id}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-left text-xs font-mono text-base-content/60 group-hover:text-base-content/80">
            {group.label}
          </span>
        </span>
        {countSlot}
      </button>
    </div>
  );
}

function KeyRow({
  motionId,
  setMotionElement,
  redisKey,
  label,
  depth,
  isSelected,
  isEditing,
  renameDraft,
  renameError,
  isRenaming,
  renameInputRef,
  onStartRename,
  onRenameDraftChange,
  onCancelRename,
  onSubmitRename,
  onClick,
  showKeyType,
  showTtl,
  typeConfig,
}: {
  motionId: string;
  setMotionElement: (id: string, element: HTMLElement | null) => void;
  redisKey: RedisKey;
  label: string;
  depth: number;
  isSelected: boolean;
  isEditing: boolean;
  renameDraft: string;
  renameError: string;
  isRenaming: boolean;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  onStartRename: () => void;
  onRenameDraftChange: (value: string) => void;
  onCancelRename: () => void;
  onSubmitRename: () => Promise<void>;
  onClick: () => void;
  showKeyType: boolean;
  showTtl: boolean;
  typeConfig: typeof TYPE_CONFIG;
}) {
  const cfg = typeConfig[redisKey.type];
  const ttl = formatTTL(redisKey.ttl);
  const isRowRenaming = isEditing && isRenaming;
  const rightSlot = isRowRenaming || showKeyType || (showTtl && ttl) ? (
    <span className="flex min-w-0 shrink-0 items-center justify-end gap-1.5">
      {isRowRenaming ? (
        <LoaderCircle
          size={11}
          className="animate-spin text-base-content/40"
        />
      ) : (
        <>
          {showKeyType ? (
            <span
              className={`badge badge-xs border-0 font-mono lowercase ${cfg.badge}`}
            >
              {cfg.label}
            </span>
          ) : null}
          {showTtl && ttl ? (
            <span className="text-right text-[9px] font-mono tabular-nums text-warning/70">
              {ttl}
            </span>
          ) : null}
        </>
      )}
    </span>
  ) : null;

  if (isEditing) {
    return (
      <div
        ref={(element) => setMotionElement(motionId, element)}
        className={`
          flex h-8 items-center gap-2 w-full px-3 py-1.5 text-left transition-colors duration-150
          ${
            isSelected
              ? "bg-success/10 text-success"
              : "bg-base-100/40 text-base-content/80"
          }
        `}
        style={{ paddingLeft: `${12 + depth * 12}px` }}
      >
        <span
          className={`shrink-0 ${
            isSelected ? "text-success" : "text-base-content/30"
          }`}
        >
          {cfg.icon}
        </span>
        <div className="flex h-5 flex-1 min-w-0 items-center">
          <input
            ref={renameInputRef}
            type="text"
            value={renameDraft}
            disabled={isRowRenaming}
            onChange={(event) => onRenameDraftChange(event.target.value)}
            onBlur={() => {
              void onSubmitRename();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void onSubmitRename();
              }

              if (event.key === "Escape") {
                event.preventDefault();
                onCancelRename();
              }
            }}
            onFocus={(event) => {
              placeInputCursorAtEnd(event.currentTarget);
            }}
            aria-invalid={Boolean(renameError)}
            title={renameError || redisKey.key}
            className={`relative translate-y-[-0.5px] block h-4 w-full min-w-0 appearance-none border-0 bg-transparent px-0 text-xs leading-4 font-mono outline-none ${
              renameError ? "text-error" : "text-current"
            }`}
            spellCheck={false}
            autoFocus
          />
        </div>
        {rightSlot}
      </div>
    );
  }

  return (
    <button
      ref={(element) => setMotionElement(motionId, element)}
      onClick={(event) => {
        if (event.detail === 1) {
          onClick();
        }
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onStartRename();
      }}
      title={redisKey.key}
      className={`
        flex h-8 items-center gap-2 w-full px-3 py-1.5 cursor-pointer transition-colors duration-150 text-left
        ${
          isSelected
            ? "bg-success/10 text-success"
            : "hover:bg-base-100/40 text-base-content/70 hover:text-base-content"
        }
      `}
      style={{ paddingLeft: `${12 + depth * 12}px` }}
    >
      <span
        className={`shrink-0 ${
          isSelected ? "text-success" : "text-base-content/30"
        }`}
      >
        {cfg.icon}
      </span>
      <span className="flex h-5 flex-1 min-w-0 items-center">
        <span className="block w-full truncate text-xs font-mono">
          {label}
        </span>
      </span>
      {rightSlot}
    </button>
  );
}
