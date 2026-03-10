interface LoadMoreSectionProps {
  hasMore: boolean;
  isLoadingMore: boolean;
  loadedCount: number;
  loadMoreLabel: string;
  loadingMoreLabel: string;
  loadedSummaryLabel: string;
  onLoadMore: () => void;
}

export function LoadMoreSection({
  hasMore,
  isLoadingMore,
  loadedCount,
  loadMoreLabel,
  loadingMoreLabel,
  loadedSummaryLabel,
  onLoadMore,
}: LoadMoreSectionProps) {
  if (!loadedCount && !hasMore) {
    return null;
  }

  return (
    <div className="px-3 pb-3 pt-2">
      <div className="flex items-center justify-between rounded-xl border border-base-content/8 bg-base-100/40 px-3 py-2">
        <span className="text-[10px] font-mono text-base-content/45">
          {loadedSummaryLabel}
        </span>
        {hasMore ? (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="btn btn-ghost btn-xs h-7 px-2 font-mono text-[10px]"
          >
            {isLoadingMore ? loadingMoreLabel : loadMoreLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
