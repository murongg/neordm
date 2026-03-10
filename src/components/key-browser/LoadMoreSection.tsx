interface LoadMoreSectionProps {
  hasMore: boolean;
  isLoadingMore: boolean;
  loadedCount: number;
  loadMoreLabel: string;
  loadingMoreLabel: string;
  stopLoadingLabel: string;
  loadedSummaryLabel: string;
  onLoadMore: () => void;
  onStopLoadingMore: () => void;
}

export function LoadMoreSection({
  hasMore,
  isLoadingMore,
  loadedCount,
  loadMoreLabel,
  loadingMoreLabel,
  stopLoadingLabel,
  loadedSummaryLabel,
  onLoadMore,
  onStopLoadingMore,
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
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={isLoadingMore ? onStopLoadingMore : onLoadMore}
              className="btn btn-ghost btn-xs h-7 px-2 font-mono text-[10px]"
            >
              {isLoadingMore ? stopLoadingLabel : loadMoreLabel}
            </button>
            {isLoadingMore ? (
              <span className="text-[10px] font-mono text-base-content/40">
                {loadingMoreLabel}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
