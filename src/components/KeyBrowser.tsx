import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  Search,
  Copy,
  RefreshCw,
  Plus,
  LoaderCircle,
  TriangleAlert,
  Hash,
  List,
  ListChevronsDownUp,
  ListChevronsUpDown,
  Layers,
  AlignLeft,
  BarChart2,
  Radio,
  Braces,
  Server,
  Trash2,
} from "lucide-react";
import type {
  RedisClusterTopologyNode,
  RedisConnection,
  RedisKey,
  RedisKeyType,
} from "../types";
import { useI18n } from "../i18n";
import { EmptyConnectionsIllustration } from "./EmptyConnectionsIllustration";
import {
  getRedisClusterTopology,
  getRedisErrorMessage,
  type RedisKeyCreateInput,
} from "../lib/redis";
import { CreateKeyModal } from "./CreateKeyModal";
import { LoadMoreSection } from "./key-browser/LoadMoreSection";
import {
  MemoGroupRow,
  MemoKeyRow,
  type KeyTypeConfig,
} from "./key-browser/TreeRows";
import { useToast } from "./ToastProvider";

interface KeyBrowserProps {
  connection?: RedisConnection;
  selectedDb: number;
  onSelectDb: (db: number) => void;
  isRefreshing: boolean;
  hasMoreKeys: boolean;
  isLoadingMoreKeys: boolean;
  onRefresh: () => void;
  onClearSelection: () => void;
  onLoadMoreKeys: () => Promise<void>;
  onCancelLoadMoreKeys: () => void;
  onCreateKey: (input: RedisKeyCreateInput) => Promise<RedisKey>;
  confirmBeforeDelete: boolean;
  defaultTtl: string;
  keySeparator: string;
  showKeyType: boolean;
  showTtl: boolean;
  keys: RedisKey[];
  selectedKey: RedisKey | null;
  onSelectKey: (key: RedisKey) => void;
  onDeleteKey: (key: RedisKey) => Promise<void>;
  onDeleteGroup: (groupId: string, separator: string) => Promise<number>;
  onRenameKey: (key: RedisKey, nextKeyName: string) => Promise<RedisKey | void>;
  onRenameGroup: (
    groupId: string,
    nextGroupId: string,
    separator: string
  ) => Promise<Array<{ oldKey: string; newKey: string }>>;
  searchQuery: string;
  selectedClusterNodeAddress: string | null;
  onSelectClusterNode: (nodeAddress: string | null) => Promise<void>;
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

type VisibleTreeRow =
  | {
      kind: "group";
      key: string;
      motionId: string;
      group: KeyTreeGroupNode;
      isExpanded: boolean;
    }
  | {
      kind: "key";
      key: string;
      motionId: string;
      redisKey: RedisKey;
      label: string;
      depth: number;
    };

const KEY_BROWSER_REORDER_ANIMATION_LIMIT = 240;
const KEY_BROWSER_ROW_HEIGHT = 32;
const KEY_BROWSER_VIRTUAL_OVERSCAN = 10;

function replaceTemplate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : `{${key}}`
  );
}

type ContextMenuTarget =
  | {
      kind: "key";
      redisKey: RedisKey;
    }
  | {
      kind: "group";
      group: KeyTreeGroupNode;
    };

interface KeyContextMenuState {
  target: ContextMenuTarget;
  x: number;
  y: number;
}

function getChildKeyPrefix(groupId: string, separator: string) {
  return separator ? `${groupId}${separator}` : `${groupId}`;
}

function getContextMenuCopyValue(target: ContextMenuTarget) {
  return target.kind === "group" ? target.group.id : target.redisKey.key;
}

const TYPE_CONFIG: Record<RedisKeyType, KeyTypeConfig> = {
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
    badge: "badge-primary",
  },
};

function formatTTL(ttl: number): string {
  if (ttl === -1) return "";
  if (ttl < 60) return `${ttl}s`;
  if (ttl < 3600) return `${Math.floor(ttl / 60)}m`;
  if (ttl < 86400) return `${Math.floor(ttl / 3600)}h`;
  return `${Math.floor(ttl / 86400)}d`;
}

function formatClusterSlotRanges(
  slotRanges: RedisClusterTopologyNode["slotRanges"]
) {
  return slotRanges.map((range) => `${range.start}-${range.end}`).join(", ");
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

function flattenVisibleTreeRows(
  nodes: KeyTreeNode[],
  expandedGroups: Set<string>,
  getGroupMotionId: (groupId: string) => string,
  getKeyMotionId: (key: string) => string
): VisibleTreeRow[] {
  const rows: VisibleTreeRow[] = [];

  const visit = (currentNodes: KeyTreeNode[]) => {
    currentNodes.forEach((node) => {
      if (node.kind === "group") {
        const isExpanded = expandedGroups.has(node.id);

        rows.push({
          kind: "group",
          key: `group:${getGroupMotionId(node.id)}`,
          motionId: `group:${getGroupMotionId(node.id)}`,
          group: node,
          isExpanded,
        });

        if (isExpanded) {
          visit(node.children);
        }

        return;
      }

      rows.push({
        kind: "key",
        key: `key:${getKeyMotionId(node.redisKey.key)}`,
        motionId: `key:${getKeyMotionId(node.redisKey.key)}`,
        redisKey: node.redisKey,
        label: node.label,
        depth: node.depth,
      });
    });
  };

  visit(nodes);

  return rows;
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

function getAncestorGroupIds(key: string, separator: string) {
  if (!separator) {
    return [];
  }

  const segments = key.split(separator);

  if (segments.length <= 1) {
    return [];
  }

  const groupIds: string[] = [];
  let currentGroupId = segments[0] ?? "";

  for (let index = 1; index < segments.length; index += 1) {
    groupIds.push(currentGroupId);
    currentGroupId = `${currentGroupId}${separator}${segments[index]}`;
  }

  return groupIds;
}

function getContextMenuTargetId(target: ContextMenuTarget) {
  return target.kind === "key"
    ? `key:${target.redisKey.key}`
    : `group:${target.group.id}`;
}

export function KeyBrowser({
  connection,
  selectedDb,
  onSelectDb,
  isRefreshing,
  hasMoreKeys,
  isLoadingMoreKeys,
  onRefresh,
  onClearSelection,
  onLoadMoreKeys,
  onCancelLoadMoreKeys,
  onCreateKey,
  confirmBeforeDelete,
  defaultTtl,
  keySeparator,
  showKeyType,
  showTtl,
  keys,
  selectedKey,
  onSelectKey,
  onDeleteKey,
  onDeleteGroup,
  onRenameKey,
  onRenameGroup,
  searchQuery,
  selectedClusterNodeAddress,
  onSelectClusterNode,
  onSearchChange,
}: KeyBrowserProps) {
  const { messages } = useI18n();
  const { showToast } = useToast();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingKeyName, setEditingKeyName] = useState<string | null>(null);
  const [pendingSelectedKeyName, setPendingSelectedKeyName] = useState<
    string | null
  >(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createInitialKeyName, setCreateInitialKeyName] = useState("");
  const [renderedKeyContextMenu, setRenderedKeyContextMenu] =
    useState<KeyContextMenuState | null>(null);
  const [isKeyContextMenuVisible, setIsKeyContextMenuVisible] = useState(false);
  const [clusterTopology, setClusterTopology] = useState<RedisClusterTopologyNode[]>(
    []
  );
  const [isLoadingClusterTopology, setIsLoadingClusterTopology] = useState(false);
  const [clusterTopologyError, setClusterTopologyError] = useState<string | null>(
    null
  );
  const [deletingContextTargetId, setDeletingContextTargetId] = useState<
    string | null
  >(null);
  const [groupMotionIds, setGroupMotionIds] = useState<Record<string, string>>(
    {}
  );
  const [keyMotionIds, setKeyMotionIds] = useState<Record<string, string>>({});
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const motionElementsRef = useRef<Map<string, HTMLElement>>(new Map());
  const previousPositionsRef = useRef<Map<string, number>>(new Map());
  const motionCleanupTimersRef = useRef<Map<string, number>>(new Map());
  const pendingKeySelectTimerRef = useRef<number | null>(null);
  const scrollMetricsFrameRef = useRef<number | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const keyContextMenuRef = useRef<HTMLDivElement | null>(null);
  const keyContextMenuEnterFrameRef = useRef<number | null>(null);
  const keyContextMenuCloseTimerRef = useRef<number | null>(null);
  const pendingReorderAnimationRef = useRef(false);
  const pendingRenameKeysRef = useRef<{
    oldKey: string;
    newKey: string;
  } | null>(null);
  const hasConnection = Boolean(connection);
  const isClusterConnection = connection?.mode === "cluster";
  const [scrollMetrics, setScrollMetrics] = useState({
    scrollTop: 0,
    viewportHeight: 0,
  });
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const closeCreateForm = useCallback(() => {
    setIsCreateOpen(false);
    setCreateInitialKeyName("");
  }, []);
  const openCreateForm = useCallback((initialKeyName = "") => {
    setCreateInitialKeyName(initialKeyName);
    setIsCreateOpen(true);
    setEditingGroupId(null);
    setEditingKeyName(null);
  }, []);
  const closeKeyContextMenu = useCallback(() => {
    if (!renderedKeyContextMenu) {
      return;
    }

    if (keyContextMenuCloseTimerRef.current !== null) {
      return;
    }

    setIsKeyContextMenuVisible(false);
    keyContextMenuCloseTimerRef.current = window.setTimeout(() => {
      keyContextMenuCloseTimerRef.current = null;
      setRenderedKeyContextMenu(null);
    }, 150);
  }, [renderedKeyContextMenu]);
  const refreshClusterTopology = useCallback(async () => {
    if (!connection || connection.mode !== "cluster") {
      setClusterTopology([]);
      setClusterTopologyError(null);
      setIsLoadingClusterTopology(false);
      return;
    }

    setIsLoadingClusterTopology(true);
    setClusterTopologyError(null);

    try {
      const topology = await getRedisClusterTopology({
        ...connection,
        db: 0,
      });

      setClusterTopology(topology);
    } catch (error) {
      setClusterTopology([]);
      setClusterTopologyError(getRedisErrorMessage(error));
    } finally {
      setIsLoadingClusterTopology(false);
    }
  }, [connection]);

  useEffect(() => {
    if (!isClusterConnection) {
      setClusterTopology([]);
      setClusterTopologyError(null);
      setIsLoadingClusterTopology(false);
      return;
    }

    void refreshClusterTopology();
  }, [isClusterConnection, refreshClusterTopology]);

  useEffect(() => {
    if (
      !selectedClusterNodeAddress ||
      clusterTopology.some((node) => node.address === selectedClusterNodeAddress)
    ) {
      return;
    }

    void onSelectClusterNode(null);
  }, [clusterTopology, onSelectClusterNode, selectedClusterNodeAddress]);

  const filtered = useMemo(() => {
    const q = deferredSearchQuery.replace(/\*/g, "").toLowerCase();
    if (!q) return keys;
    return keys.filter((keyItem) => keyItem.key.toLowerCase().includes(q));
  }, [deferredSearchQuery, keys]);
  const availableDbIndexes = useMemo(
    () =>
      connection?.mode === "cluster"
        ? [0]
        : Array.from({ length: Math.max(256, selectedDb + 1) }, (_, index) => index),
    [connection?.mode, selectedDb]
  );
  const activeClusterTopologyNode = useMemo(
    () =>
      selectedClusterNodeAddress
        ? clusterTopology.find((node) => node.address === selectedClusterNodeAddress) ??
          null
        : null,
    [clusterTopology, selectedClusterNodeAddress]
  );

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
  const visibleRows = useMemo(
    () =>
      flattenVisibleTreeRows(
        tree,
        expandedGroups,
        getGroupMotionId,
        getKeyMotionId
      ),
    [expandedGroups, getGroupMotionId, getKeyMotionId, tree]
  );
  const enableReorderAnimations =
    visibleRows.length <= KEY_BROWSER_REORDER_ANIMATION_LIMIT;
  const updateScrollMetrics = useCallback(() => {
    const container = scrollContainerRef.current;

    if (!container) {
      return;
    }

    const nextScrollTop = container.scrollTop;
    const nextViewportHeight = container.clientHeight;

    setScrollMetrics((previous) => {
      if (
        previous.scrollTop === nextScrollTop &&
        previous.viewportHeight === nextViewportHeight
      ) {
        return previous;
      }

      return {
        scrollTop: nextScrollTop,
        viewportHeight: nextViewportHeight,
      };
    });
  }, []);
  const handleScroll = useCallback(() => {
    if (scrollMetricsFrameRef.current !== null) {
      return;
    }

    scrollMetricsFrameRef.current = window.requestAnimationFrame(() => {
      scrollMetricsFrameRef.current = null;
      updateScrollMetrics();
    });
  }, [updateScrollMetrics]);
  const setMotionElement = useCallback(
    (id: string, element: HTMLElement | null) => {
      const current = motionElementsRef.current;
      const activeTimer = motionCleanupTimersRef.current.get(id);

      if (!enableReorderAnimations) {
        if (activeTimer) {
          window.clearTimeout(activeTimer);
          motionCleanupTimersRef.current.delete(id);
        }
        current.delete(id);
        return;
      }

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
    [enableReorderAnimations]
  );
  const totalRows = visibleRows.length;
  const viewportHeight = scrollMetrics.viewportHeight || 480;
  const maxVisibleStartIndex = Math.max(0, totalRows - 1);
  const rawVisibleStartIndex =
    Math.floor(scrollMetrics.scrollTop / KEY_BROWSER_ROW_HEIGHT) -
    KEY_BROWSER_VIRTUAL_OVERSCAN;
  const visibleStartIndex = Math.min(
    maxVisibleStartIndex,
    Math.max(0, rawVisibleStartIndex)
  );
  const rawVisibleEndIndex =
    Math.ceil(
      (scrollMetrics.scrollTop + viewportHeight) / KEY_BROWSER_ROW_HEIGHT
    ) + KEY_BROWSER_VIRTUAL_OVERSCAN;
  const visibleEndIndex =
    totalRows === 0
      ? 0
      : Math.min(totalRows, Math.max(visibleStartIndex + 1, rawVisibleEndIndex));
  const topSpacerHeight = visibleStartIndex * KEY_BROWSER_ROW_HEIGHT;
  const bottomSpacerHeight = Math.max(
    0,
    (totalRows - visibleEndIndex) * KEY_BROWSER_ROW_HEIGHT
  );
  const virtualRows = visibleRows.slice(visibleStartIndex, visibleEndIndex);

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

  const handleCreatedKey = useCallback(
    (createdKey: RedisKey) => {
      const ancestorGroupIds = getAncestorGroupIds(createdKey.key, keySeparator);

      if (ancestorGroupIds.length) {
        setExpandedGroups((previous) => {
          const next = new Set(previous);
          ancestorGroupIds.forEach((groupId) => next.add(groupId));
          return next;
        });
      }

      closeCreateForm();
    },
    [closeCreateForm, keySeparator]
  );

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
        setRenameError(messages.keyBrowser.keyNameRequired);
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
        setRenameError(
          replaceTemplate(messages.ui.errors.keySegmentSeparatorInvalid, {
            separator: keySeparator,
          })
        );
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
    [
      cancelRename,
      isRenaming,
      keySeparator,
      messages.keyBrowser.keyNameRequired,
      messages.ui.errors.keySegmentSeparatorInvalid,
      onRenameKey,
      renameDraft,
    ]
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
        setRenameError(messages.ui.errors.groupNameRequired);
        requestAnimationFrame(() => {
          renameInputRef.current?.focus({ preventScroll: true });
          renameInputRef.current?.select();
        });
        return;
      }

      if (keySeparator && renameDraft.includes(keySeparator)) {
        setRenameError(
          replaceTemplate(messages.ui.errors.groupSegmentSeparatorInvalid, {
            separator: keySeparator,
          })
        );
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
    [
      cancelRename,
      isRenaming,
      keySeparator,
      keys,
      messages.ui.errors.groupNameRequired,
      messages.ui.errors.groupSegmentSeparatorInvalid,
      onRenameGroup,
      renameDraft,
    ]
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
    if (!enableReorderAnimations) {
      motionCleanupTimersRef.current.forEach((timer) => {
        window.clearTimeout(timer);
      });
      motionCleanupTimersRef.current.clear();
      motionElementsRef.current.forEach((element) => {
        element.style.transition = "";
        element.style.transform = "";
        element.style.willChange = "";
      });
      previousPositionsRef.current = new Map();
      pendingReorderAnimationRef.current = false;
      pendingRenameKeysRef.current = null;
      return;
    }

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
  }, [
    enableReorderAnimations,
    expandedGroups,
    groupMotionIds,
    keyMotionIds,
    tree,
  ]);

  useLayoutEffect(() => {
    updateScrollMetrics();

    const container = scrollContainerRef.current;

    if (!container || typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      updateScrollMetrics();
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [updateScrollMetrics]);

  useLayoutEffect(() => {
    updateScrollMetrics();
  }, [totalRows, updateScrollMetrics]);

  useLayoutEffect(() => {
    if (!renderedKeyContextMenu) {
      return;
    }

    const handleMouseDown = (event: MouseEvent) => {
      if (keyContextMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      closeKeyContextMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeKeyContextMenu();
      }
    };

    document.addEventListener("mousedown", handleMouseDown, true);
    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [closeKeyContextMenu, renderedKeyContextMenu]);

  useEffect(() => {
    return () => {
      if (pendingKeySelectTimerRef.current) {
        window.clearTimeout(pendingKeySelectTimerRef.current);
      }

      if (scrollMetricsFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollMetricsFrameRef.current);
      }

      motionCleanupTimersRef.current.forEach((timer) => {
        window.clearTimeout(timer);
      });
      motionCleanupTimersRef.current.clear();

      if (keyContextMenuEnterFrameRef.current !== null) {
        window.cancelAnimationFrame(keyContextMenuEnterFrameRef.current);
      }

      if (keyContextMenuCloseTimerRef.current !== null) {
        window.clearTimeout(keyContextMenuCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!renderedKeyContextMenu) {
      return;
    }

    const contextMenuTarget = renderedKeyContextMenu.target;

    if (
      contextMenuTarget.kind === "key" &&
      keys.some((item) => item.key === contextMenuTarget.redisKey.key)
    ) {
      return;
    }

    if (contextMenuTarget.kind === "group" && hasGroupId(tree, contextMenuTarget.group.id)) {
      return;
    }

    closeKeyContextMenu();
  }, [closeKeyContextMenu, keys, renderedKeyContextMenu, tree]);

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
  const openKeyContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, key: RedisKey) => {
      event.preventDefault();
      event.stopPropagation();

      const menuWidth = 176;
      const menuHeight = 52;
      const padding = 8;
      const nextContextMenu = {
        target: {
          kind: "key" as const,
          redisKey: key,
        },
        x: Math.max(
          padding,
          Math.min(event.clientX, window.innerWidth - menuWidth - padding)
        ),
        y: Math.max(
          padding,
          Math.min(event.clientY, window.innerHeight - menuHeight - padding)
        ),
      };

      setEditingGroupId(null);
      setEditingKeyName(null);
      setRenderedKeyContextMenu(nextContextMenu);

      if (keyContextMenuCloseTimerRef.current !== null) {
        window.clearTimeout(keyContextMenuCloseTimerRef.current);
        keyContextMenuCloseTimerRef.current = null;
      }

      if (keyContextMenuEnterFrameRef.current !== null) {
        window.cancelAnimationFrame(keyContextMenuEnterFrameRef.current);
      }

      setIsKeyContextMenuVisible(false);
      keyContextMenuEnterFrameRef.current = window.requestAnimationFrame(() => {
        keyContextMenuEnterFrameRef.current = null;
        setIsKeyContextMenuVisible(true);
      });
    },
    []
  );
  const openGroupContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, group: KeyTreeGroupNode) => {
      event.preventDefault();
      event.stopPropagation();

      const menuWidth = 200;
      const menuHeight = 52;
      const padding = 8;
      const nextContextMenu = {
        target: {
          kind: "group" as const,
          group,
        },
        x: Math.max(
          padding,
          Math.min(event.clientX, window.innerWidth - menuWidth - padding)
        ),
        y: Math.max(
          padding,
          Math.min(event.clientY, window.innerHeight - menuHeight - padding)
        ),
      };

      setEditingGroupId(null);
      setEditingKeyName(null);
      setRenderedKeyContextMenu(nextContextMenu);

      if (keyContextMenuCloseTimerRef.current !== null) {
        window.clearTimeout(keyContextMenuCloseTimerRef.current);
        keyContextMenuCloseTimerRef.current = null;
      }

      if (keyContextMenuEnterFrameRef.current !== null) {
        window.cancelAnimationFrame(keyContextMenuEnterFrameRef.current);
      }

      setIsKeyContextMenuVisible(false);
      keyContextMenuEnterFrameRef.current = window.requestAnimationFrame(() => {
        keyContextMenuEnterFrameRef.current = null;
        setIsKeyContextMenuVisible(true);
      });
    },
    []
  );
  const handleDeleteFromContextMenu = useCallback(async () => {
    const target = renderedKeyContextMenu?.target;
    const targetId = target ? getContextMenuTargetId(target) : null;

    if (!target || (targetId && deletingContextTargetId === targetId)) {
      return;
    }

    if (confirmBeforeDelete) {
      const confirmed = await confirm(
        target.kind === "key"
          ? replaceTemplate(messages.valueEditor.confirmDeleteKey, {
              key: target.redisKey.key,
            })
          : replaceTemplate(messages.keyBrowser.confirmDeleteGroup, {
              group: target.group.id,
            }),
        {
          title: messages.ui.appName,
          kind: "warning",
          okLabel: messages.common.delete,
          cancelLabel: messages.common.cancel,
        }
      );

      if (!confirmed) {
        return;
      }
    }

    setDeletingContextTargetId(targetId);

    try {
      if (target.kind === "key") {
        await onDeleteKey(target.redisKey);
      } else {
        await onDeleteGroup(target.group.id, keySeparator);
      }
      closeKeyContextMenu();
    } catch (error) {
      showToast({
        message: getRedisErrorMessage(error),
        tone: "error",
        duration: 1800,
      });
    } finally {
      setDeletingContextTargetId(null);
    }
  }, [
    closeKeyContextMenu,
    confirmBeforeDelete,
    deletingContextTargetId,
    keySeparator,
    messages.common.cancel,
    messages.common.delete,
    messages.keyBrowser.confirmDeleteGroup,
    messages.valueEditor.confirmDeleteKey,
    onDeleteGroup,
    onDeleteKey,
    renderedKeyContextMenu,
    showToast,
  ]);
  const handleRefresh = useCallback(async () => {
    await onRefresh();

    if (isClusterConnection) {
      await refreshClusterTopology();
    }
  }, [isClusterConnection, onRefresh, refreshClusterTopology]);
  const handleLoadMore = useCallback(async () => {
    try {
      await onLoadMoreKeys();
    } catch (error) {
      showToast({
        message: getRedisErrorMessage(error),
        tone: "error",
        duration: 1800,
      });
    }
  }, [onLoadMoreKeys, showToast]);
  const handleCancelLoadMore = useCallback(() => {
    onCancelLoadMoreKeys();
  }, [onCancelLoadMoreKeys]);
  const handleRefreshFromContextMenu = useCallback(async () => {
    closeKeyContextMenu();

    try {
      await handleRefresh();
    } catch (error) {
      showToast({
        message: getRedisErrorMessage(error),
        tone: "error",
        duration: 1800,
      });
    }
  }, [closeKeyContextMenu, handleRefresh, showToast]);
  const handleCreateChildKeyFromContextMenu = useCallback(() => {
    if (renderedKeyContextMenu?.target.kind !== "group") {
      return;
    }

    const initialKeyName = getChildKeyPrefix(
      renderedKeyContextMenu.target.group.id,
      keySeparator
    );

    closeKeyContextMenu();
    openCreateForm(initialKeyName);
  }, [closeKeyContextMenu, keySeparator, openCreateForm, renderedKeyContextMenu]);
  const handleCopyFromContextMenu = useCallback(async () => {
    if (!renderedKeyContextMenu) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        getContextMenuCopyValue(renderedKeyContextMenu.target)
      );
      closeKeyContextMenu();
      showToast({
        message: messages.common.copied,
        tone: "success",
      });
    } catch (error) {
      showToast({
        message:
          error instanceof Error ? error.message : getRedisErrorMessage(error),
        tone: "error",
        duration: 1800,
      });
    }
  }, [closeKeyContextMenu, messages.common.copied, renderedKeyContextMenu, showToast]);
  const handleBlankAreaClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const target = event.target;

      if (!(target instanceof HTMLElement)) {
        return;
      }

      const clickedBlankArea =
        target === event.currentTarget ||
        target.closest("[data-key-browser-blank='true']") !== null;

      if (!clickedBlankArea || !selectedKey) {
        return;
      }

      clearPendingKeySelection();
      onClearSelection();
    },
    [clearPendingKeySelection, onClearSelection, selectedKey]
  );

  const activeSelectedKeyName =
    editingKeyName ?? pendingSelectedKeyName ?? selectedKey?.key ?? null;

  const typeConfig = TYPE_CONFIG;

  useEffect(() => {
    if (
      !hasConnection ||
      !hasMoreKeys ||
      isRefreshing ||
      isLoadingMoreKeys
    ) {
      return;
    }

    const totalContentHeight = totalRows * KEY_BROWSER_ROW_HEIGHT;
    const distanceToBottom =
      totalContentHeight -
      (scrollMetrics.scrollTop + (scrollMetrics.viewportHeight || 0));

    if (distanceToBottom > KEY_BROWSER_ROW_HEIGHT * 6) {
      return;
    }

    void handleLoadMore();
  }, [
    handleLoadMore,
    hasConnection,
    hasMoreKeys,
    isLoadingMoreKeys,
    isRefreshing,
    scrollMetrics.scrollTop,
    scrollMetrics.viewportHeight,
    totalRows,
  ]);

  return (
    <>
      <div className="flex flex-col w-64 bg-base-200 border-r border-base-100/50 h-full shrink-0">
        <div
          data-tauri-drag-region
          className="relative px-3 border-b border-base-100/50 shrink-0 select-none"
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
              onClick={() => openCreateForm()}
              disabled={!hasConnection}
              className={`btn btn-ghost btn-xs h-6 w-6 p-0 text-base-content/60 hover:bg-base-100/60 hover:text-base-content/90 ${
                hasConnection
                  ? "cursor-pointer"
                  : "cursor-not-allowed opacity-40"
              }`}
              aria-label={messages.keyBrowser.create}
              title={messages.keyBrowser.create}
            >
              <Plus size={12} strokeWidth={2.25} />
            </button>
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
              onClick={() => {
                void handleRefresh();
              }}
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
          disabled={!hasConnection || connection?.mode === "cluster"}
          className={`select select-xs w-full bg-base-300 border-base-100/50 font-mono text-xs mb-2 ${
            hasConnection && connection?.mode !== "cluster"
              ? "cursor-pointer"
              : "cursor-not-allowed opacity-60"
          }`}
        >
          {availableDbIndexes.map((index) => (
            <option key={index} value={index}>
              db{index} {index === selectedDb ? messages.keyBrowser.activeDb : ""}
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

        {isClusterConnection ? (
          <div className="mt-2 rounded-xl border border-base-100/60 bg-base-300/70 p-1.5">
            <div className="mb-1 flex items-center justify-between gap-2 px-0.5">
              <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-base-content/55">
                <Server size={10} />
                {messages.keyBrowser.clusterView}
              </span>
              <span
                className="text-[9px] font-mono text-base-content/40"
                title={
                  activeClusterTopologyNode
                    ? `${activeClusterTopologyNode.address} · ${formatClusterSlotRanges(
                        activeClusterTopologyNode.slotRanges
                      )}`
                    : undefined
                }
              >
                {activeClusterTopologyNode
                  ? activeClusterTopologyNode.address
                  : String(clusterTopology.length)}
              </span>
            </div>

            {clusterTopologyError ? (
              <div
                className="flex items-center gap-1 rounded-lg border border-warning/20 bg-warning/8 px-2 py-1 text-[10px] text-warning/80"
                title={clusterTopologyError}
              >
                <TriangleAlert size={10} />
                <span className="truncate">
                  {messages.keyBrowser.clusterTopologyUnavailable}
                </span>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => {
                  void onSelectClusterNode(null);
                }}
                disabled={!hasConnection || isRefreshing}
                className={`flex h-7 items-center gap-1 rounded-lg border px-2 text-[10px] font-mono transition-colors duration-150 ${
                  selectedClusterNodeAddress === null
                    ? "border-primary/25 bg-primary/10 text-primary"
                    : "border-base-content/8 bg-base-200/80 text-base-content/65 hover:bg-base-100"
                } ${
                  hasConnection && !isRefreshing
                    ? "cursor-pointer"
                    : "cursor-not-allowed opacity-50"
                }`}
                title={messages.keyBrowser.allNodes}
              >
                {isLoadingClusterTopology ? (
                  <LoaderCircle size={10} className="animate-spin" />
                ) : (
                  <Server size={10} />
                )}
                <span>{messages.keyBrowser.allNodes}</span>
              </button>

              {clusterTopology.map((node) => (
                <button
                  key={node.address}
                  type="button"
                  onClick={() => {
                    void onSelectClusterNode(node.address);
                  }}
                  disabled={!hasConnection || isRefreshing}
                  className={`flex h-7 min-w-0 max-w-full items-center gap-1 rounded-lg border px-2 text-[10px] font-mono transition-colors duration-150 ${
                    selectedClusterNodeAddress === node.address
                      ? "border-primary/25 bg-primary/10 text-primary"
                      : "border-base-content/8 bg-base-200/80 text-base-content/65 hover:bg-base-100"
                  } ${
                    hasConnection && !isRefreshing
                      ? "cursor-pointer"
                      : "cursor-not-allowed opacity-50"
                  }`}
                  title={`${node.address} · ${formatClusterSlotRanges(
                    node.slotRanges
                  )}`}
                >
                  <Server size={10} />
                  <span className="max-w-[108px] truncate">{node.address}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div
        ref={scrollContainerRef}
        onClick={handleBlankAreaClick}
        onScroll={handleScroll}
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
        ) : isRefreshing && keys.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-base-200">
              <LoaderCircle size={18} className="animate-spin text-base-content/55" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-mono text-base-content/70">
                {messages.keyBrowser.loading}
              </p>
              <p className="text-[11px] font-mono text-base-content/40">
                {connection?.name}
              </p>
            </div>
          </div>
        ) : (
          <>
            {isRefreshing ? (
              <div className="px-3 pb-2 pt-1">
                <div className="flex items-center gap-2 rounded-xl border border-base-content/8 bg-base-100/50 px-3 py-2">
                  <LoaderCircle size={12} className="animate-spin text-base-content/45" />
                  <span className="text-[10px] font-mono text-base-content/45">
                    {messages.keyBrowser.refreshing}
                  </span>
                </div>
              </div>
            ) : null}
            {topSpacerHeight > 0 ? (
              <div
                data-key-browser-blank="true"
                style={{ height: topSpacerHeight }}
                aria-hidden="true"
              />
            ) : null}
            {virtualRows.map((row) =>
              row.kind === "group" ? (
                <MemoGroupRow
                  key={row.key}
                  motionId={row.motionId}
                  setMotionElement={setMotionElement}
                  group={row.group}
                  isExpanded={row.isExpanded}
                  isEditing={editingGroupId === row.group.id}
                  renameDraft={renameDraft}
                  renameError={renameError}
                  isRenaming={isRenaming}
                  renameInputRef={renameInputRef}
                  onToggle={() => toggleGroup(row.group.id)}
                  onStartRename={() => startGroupRename(row.group)}
                  onRenameDraftChange={handleRenameDraftChange}
                  onCancelRename={cancelRename}
                  onSubmitRename={() => submitGroupRename(row.group)}
                  onContextMenu={(event) =>
                    openGroupContextMenu(event, row.group)
                  }
                  placeInputCursorAtEnd={placeInputCursorAtEnd}
                />
              ) : (
                <MemoKeyRow
                  key={row.key}
                  motionId={row.motionId}
                  setMotionElement={setMotionElement}
                  redisKey={row.redisKey}
                  label={row.label}
                  depth={row.depth}
                  isSelected={activeSelectedKeyName === row.redisKey.key}
                  isEditing={editingKeyName === row.redisKey.key}
                  renameDraft={renameDraft}
                  renameError={renameError}
                  isRenaming={isRenaming}
                  renameInputRef={renameInputRef}
                  onStartRename={() => startRename(row.redisKey)}
                  onRenameDraftChange={handleRenameDraftChange}
                  onCancelRename={cancelRename}
                  onSubmitRename={() => submitRename(row.redisKey)}
                  onClick={() => handleKeyClick(row.redisKey)}
                  onContextMenu={(event) =>
                    openKeyContextMenu(event, row.redisKey)
                  }
                  showKeyType={showKeyType}
                  showTtl={showTtl}
                  typeConfig={typeConfig}
                  formatTtl={formatTTL}
                  placeInputCursorAtEnd={placeInputCursorAtEnd}
                />
              )
            )}
            {bottomSpacerHeight > 0 ? (
              <div
                data-key-browser-blank="true"
                style={{ height: bottomSpacerHeight }}
                aria-hidden="true"
              />
            ) : null}
            <LoadMoreSection
              hasMore={hasMoreKeys}
              isLoadingMore={isLoadingMoreKeys}
              loadedCount={keys.length}
              loadMoreLabel={messages.keyBrowser.loadMore}
              loadingMoreLabel={messages.keyBrowser.loadingMore}
              stopLoadingLabel={messages.keyBrowser.stopLoading}
              loadedSummaryLabel={replaceTemplate(
                messages.keyBrowser.loadedSummary,
                { count: keys.length }
              )}
              onLoadMore={() => {
                void handleLoadMore();
              }}
              onStopLoadingMore={handleCancelLoadMore}
            />
          </>
        )}
      </div>
      </div>
      {isCreateOpen ? (
        <CreateKeyModal
          defaultTtl={defaultTtl}
          initialKeyName={createInitialKeyName}
          onClose={closeCreateForm}
          onCreateKey={onCreateKey}
          onCreated={handleCreatedKey}
        />
      ) : null}
      {renderedKeyContextMenu ? (
        <div
          ref={keyContextMenuRef}
          role="menu"
          style={{
            left: renderedKeyContextMenu.x,
            top: renderedKeyContextMenu.y,
          }}
          className={`fixed z-[70] max-w-[calc(100vw-1rem)] w-11 rounded-xl border border-base-content/10 bg-base-200/95 p-1 shadow-[0_16px_36px_-24px_rgba(0,0,0,0.55)] backdrop-blur-xl origin-top-left transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none ${
            isKeyContextMenuVisible
              ? "translate-y-0 scale-100 opacity-100"
              : "-translate-y-1 scale-95 opacity-0 pointer-events-none"
          }`}
        >
          <div className="flex flex-col items-center gap-0.5">
            {renderedKeyContextMenu.target.kind === "group" ? (
              <>
                <button
                  role="menuitem"
                  onClick={handleCreateChildKeyFromContextMenu}
                  aria-label={messages.keyBrowser.create}
                  title={`${messages.keyBrowser.create} · ${getChildKeyPrefix(
                    renderedKeyContextMenu.target.group.id,
                    keySeparator
                  )}`}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-base-content/80 transition-colors duration-150 hover:bg-base-100/80"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Plus size={12} />
                  </span>
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    void handleRefreshFromContextMenu();
                  }}
                  disabled={isRefreshing}
                  aria-label={messages.common.refresh}
                  title={`${messages.common.refresh} · DB ${selectedDb}`}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-base-content/80 transition-colors duration-150 hover:bg-base-100/80 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-base-content/6">
                    <RefreshCw
                      size={12}
                      className={isRefreshing ? "animate-spin" : ""}
                    />
                  </span>
                </button>
              </>
            ) : null}
            <button
              role="menuitem"
              onClick={() => {
                void handleCopyFromContextMenu();
              }}
              aria-label={messages.common.copy}
              title={`${messages.common.copy} · ${getContextMenuCopyValue(
                renderedKeyContextMenu.target
              )}`}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-base-content/80 transition-colors duration-150 hover:bg-base-100/80"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-base-content/6">
                <Copy size={12} />
              </span>
            </button>
            <div className="my-0.5 h-px w-7 bg-base-content/6" />
            <button
              role="menuitem"
              onClick={() => {
                void handleDeleteFromContextMenu();
              }}
              disabled={
                deletingContextTargetId ===
                getContextMenuTargetId(renderedKeyContextMenu.target)
              }
              title={
                `${
                  renderedKeyContextMenu.target.kind === "group"
                    ? messages.common.delete
                    : messages.valueEditor.deleteKey
                } · ${
                  renderedKeyContextMenu.target.kind === "group"
                    ? renderedKeyContextMenu.target.group.id
                    : renderedKeyContextMenu.target.redisKey.key
                }`
              }
              aria-label={
                renderedKeyContextMenu.target.kind === "group"
                  ? messages.common.delete
                  : messages.valueEditor.deleteKey
              }
              className="flex h-9 w-9 items-center justify-center rounded-lg text-error transition-colors duration-150 hover:bg-error/8 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-error/10">
                <Trash2 size={12} />
              </span>
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
