import {
  memo,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { ChevronDown, LoaderCircle } from "lucide-react";
import { useI18n } from "../../i18n";
import type { RedisKey, RedisKeyType } from "../../types";

export interface KeyTypeConfig {
  icon: ReactNode;
  label: string;
  badge: string;
}

interface GroupRowProps<Group> {
  motionId: string;
  setMotionElement: (id: string, element: HTMLElement | null) => void;
  group: Group & {
    id: string;
    label: string;
    depth: number;
    keyCount: number;
  };
  isExpanded: boolean;
  isEditing: boolean;
  renameDraft: string;
  renameError: string;
  isRenaming: boolean;
  renameInputRef: RefObject<HTMLInputElement | null>;
  onToggle: () => void;
  onStartRename: () => void;
  onRenameDraftChange: (value: string) => void;
  onCancelRename: () => void;
  onSubmitRename: () => Promise<void>;
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  placeInputCursorAtEnd: (input: HTMLInputElement | null) => void;
}

function GroupRow<Group>({
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
  onContextMenu,
  placeInputCursorAtEnd,
}: GroupRowProps<Group>) {
  const { messages } = useI18n();
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
        aria-label={
          isExpanded
            ? messages.ui.tree.collapseGroup
            : messages.ui.tree.expandGroup
        }
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
        onContextMenu={onContextMenu}
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

interface KeyRowProps {
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
  renameInputRef: RefObject<HTMLInputElement | null>;
  onStartRename: () => void;
  onRenameDraftChange: (value: string) => void;
  onCancelRename: () => void;
  onSubmitRename: () => Promise<void>;
  onClick: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  showKeyType: boolean;
  showTtl: boolean;
  typeConfig: Record<RedisKeyType, KeyTypeConfig>;
  formatTtl: (ttl: number) => string;
  placeInputCursorAtEnd: (input: HTMLInputElement | null) => void;
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
  onContextMenu,
  showKeyType,
  showTtl,
  typeConfig,
  formatTtl,
  placeInputCursorAtEnd,
}: KeyRowProps) {
  const cfg = typeConfig[redisKey.type];
  const ttl = formatTtl(redisKey.ttl);
  const isRowRenaming = isEditing && isRenaming;
  const rowTitle = [
    redisKey.key,
    typeof redisKey.slot === "number" ? `slot ${redisKey.slot}` : "",
    redisKey.nodeAddress ? redisKey.nodeAddress : "",
  ]
    .filter(Boolean)
    .join("\n");
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
              ? "bg-primary/10 text-primary"
              : "bg-base-100/40 text-base-content/80"
          }
        `}
        style={{ paddingLeft: `${12 + depth * 12}px` }}
      >
        <span
          className={`shrink-0 ${
            isSelected ? "text-primary" : "text-base-content/30"
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
            title={renameError || rowTitle}
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
    <div
      ref={(element) => setMotionElement(motionId, element)}
      className={`
        flex h-8 w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-150
        ${
          isSelected
            ? "bg-primary/10 text-primary"
            : "hover:bg-base-100/40 text-base-content/70 hover:text-base-content"
        }
      `}
      style={{ paddingLeft: `${12 + depth * 12}px` }}
    >
      <button
        type="button"
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
        onContextMenu={onContextMenu}
        title={rowTitle}
        className="flex min-w-0 flex-1 items-center gap-2 text-left cursor-pointer"
      >
        <span
          className={`shrink-0 ${
            isSelected ? "text-primary" : "text-base-content/30"
          }`}
        >
          {cfg.icon}
        </span>
        <span className="flex h-5 min-w-0 flex-1 items-center">
          <span className="block w-full truncate text-xs font-mono">
            {label}
          </span>
        </span>
        {rightSlot}
      </button>
    </div>
  );
}

type MemoGroupRowProps = Parameters<typeof GroupRow>[0];

function areGroupRowPropsEqual(
  previous: MemoGroupRowProps,
  next: MemoGroupRowProps
) {
  return (
    previous.motionId === next.motionId &&
    previous.group === next.group &&
    previous.isExpanded === next.isExpanded &&
    previous.isEditing === next.isEditing &&
    previous.renameDraft === next.renameDraft &&
    previous.renameError === next.renameError &&
    previous.isRenaming === next.isRenaming
  );
}

function areKeyRowPropsEqual(previous: KeyRowProps, next: KeyRowProps) {
  return (
    previous.motionId === next.motionId &&
    previous.redisKey === next.redisKey &&
    previous.label === next.label &&
    previous.depth === next.depth &&
    previous.isSelected === next.isSelected &&
    previous.isEditing === next.isEditing &&
    previous.renameDraft === next.renameDraft &&
    previous.renameError === next.renameError &&
    previous.isRenaming === next.isRenaming &&
    previous.showKeyType === next.showKeyType &&
    previous.showTtl === next.showTtl
  );
}

export const MemoGroupRow = memo(GroupRow, areGroupRowPropsEqual) as <
  Group,
>(
  props: GroupRowProps<Group>
) => ReactNode;
export const MemoKeyRow = memo(KeyRow, areKeyRowPropsEqual);
