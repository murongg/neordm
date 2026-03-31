import { Activity, Database, HardDrive, RefreshCw, Router, Users } from "lucide-react";
import { memo, useMemo, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { useI18n } from "../i18n";
import { getRedisConnectionEndpointLabel } from "../lib/redisConnection";
import { useRedisWorkspaceStore } from "../store/useRedisWorkspaceState";
import type { RedisOverviewMetrics } from "../types";

type OverviewCopy = {
  subtitle: string;
  noConnectionTitle: string;
  noConnectionDescription: string;
  loading: string;
  loadingDescription: string;
  refreshFailed: string;
  tryAgain: string;
  metricMemoryUsed: string;
  metricMemoryPeak: string;
  metricClients: string;
  metricOps: string;
  metricHitRate: string;
  metricFragmentation: string;
  detailsTitle: string;
  statsTitle: string;
  redisVersion: string;
  role: string;
  uptime: string;
  tcpPort: string;
  mode: string;
  keyspace: string;
  networkInput: string;
  networkOutput: string;
  expiredKeys: string;
  evictedKeys: string;
  blockedClients: string;
  keyspaceHits: string;
  keyspaceMisses: string;
  notAvailable: string;
};

const OVERVIEW_COPY: Record<"en" | "zh", OverviewCopy> = {
  en: {
    subtitle: "Redis instance snapshot",
    noConnectionTitle: "No active connection",
    noConnectionDescription:
      "Connect to a Redis server to view resource usage and instance health.",
    loading: "Loading overview",
    loadingDescription: "Reading INFO sections from the connected Redis instance.",
    refreshFailed: "Failed to refresh overview metrics.",
    tryAgain: "Try refreshing again after the connection is stable.",
    metricMemoryUsed: "Used Memory",
    metricMemoryPeak: "Peak Memory",
    metricClients: "Connected Clients",
    metricOps: "Ops / sec",
    metricHitRate: "Cache Hit Rate",
    metricFragmentation: "Fragmentation",
    detailsTitle: "Instance Details",
    statsTitle: "Supplemental Stats",
    redisVersion: "Redis Version",
    role: "Role",
    uptime: "Uptime",
    tcpPort: "TCP Port",
    mode: "Mode",
    keyspace: "Keyspace",
    networkInput: "Network In",
    networkOutput: "Network Out",
    expiredKeys: "Expired Keys",
    evictedKeys: "Evicted Keys",
    blockedClients: "Blocked Clients",
    keyspaceHits: "Keyspace Hits",
    keyspaceMisses: "Keyspace Misses",
    notAvailable: "N/A",
  },
  zh: {
    subtitle: "Redis 实例资源快照",
    noConnectionTitle: "当前没有可用连接",
    noConnectionDescription: "连接 Redis 后即可查看资源占用和实例健康状态。",
    loading: "正在加载概览",
    loadingDescription: "正在读取当前 Redis 实例的 INFO 指标。",
    refreshFailed: "刷新概览指标失败。",
    tryAgain: "请在连接稳定后再次尝试刷新。",
    metricMemoryUsed: "已用内存",
    metricMemoryPeak: "峰值内存",
    metricClients: "连接客户端",
    metricOps: "每秒操作数",
    metricHitRate: "缓存命中率",
    metricFragmentation: "内存碎片率",
    detailsTitle: "实例详情",
    statsTitle: "补充指标",
    redisVersion: "Redis 版本",
    role: "角色",
    uptime: "运行时长",
    tcpPort: "TCP 端口",
    mode: "连接模式",
    keyspace: "Keyspace 概览",
    networkInput: "网络输入",
    networkOutput: "网络输出",
    expiredKeys: "过期键数",
    evictedKeys: "淘汰键数",
    blockedClients: "阻塞客户端",
    keyspaceHits: "命中次数",
    keyspaceMisses: "未命中次数",
    notAvailable: "暂无",
  },
};

function formatNumber(value: number | null, localeTag: string, digits = 0) {
  if (value == null || !Number.isFinite(value)) {
    return "N/A";
  }

  return value.toLocaleString(localeTag, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatBytes(value: number | null, localeTag: string) {
  if (value == null || !Number.isFinite(value)) {
    return "N/A";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let nextValue = value;
  let unitIndex = 0;

  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024;
    unitIndex += 1;
  }

  const digits = nextValue >= 100 || unitIndex === 0 ? 0 : nextValue >= 10 ? 1 : 2;

  return `${nextValue.toLocaleString(localeTag, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} ${units[unitIndex]}`;
}

function formatPercent(value: number | null, localeTag: string) {
  if (value == null || !Number.isFinite(value)) {
    return "N/A";
  }

  return `${value.toLocaleString(localeTag, {
    minimumFractionDigits: value >= 10 ? 1 : 2,
    maximumFractionDigits: value >= 10 ? 1 : 2,
  })}%`;
}

function formatRatio(value: number | null, localeTag: string) {
  if (value == null || !Number.isFinite(value)) {
    return "N/A";
  }

  return `${value.toLocaleString(localeTag, {
    minimumFractionDigits: value >= 10 ? 1 : 2,
    maximumFractionDigits: value >= 10 ? 1 : 2,
  })}x`;
}

function formatDuration(value: number | null, localeTag: string) {
  if (value == null || value < 0) {
    return "N/A";
  }

  const days = Math.floor(value / 86_400);
  const hours = Math.floor((value % 86_400) / 3_600);
  const minutes = Math.floor((value % 3_600) / 60);

  if (days > 0) {
    return `${days.toLocaleString(localeTag)}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours.toLocaleString(localeTag)}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes.toLocaleString(localeTag)}m`;
  }

  return `${value.toLocaleString(localeTag)}s`;
}

function formatValue(value: string | number | null, fallback: string) {
  if (value == null || value === "") {
    return fallback;
  }

  return String(value);
}

function MetricCard({
  label,
  value,
  hint,
  accentClassName,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  accentClassName: string;
  icon: ReactNode;
}) {
  return (
    <article className="rounded-2xl border border-base-content/8 bg-base-200/70 p-4 shadow-[0_18px_40px_-30px_rgb(0_0_0_/_0.4)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-base-content/45">
            {label}
          </p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-base-content">
            {value}
          </p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${accentClassName}`}>
          {icon}
        </div>
      </div>
      {hint ? (
        <p className="mt-3 text-xs text-base-content/52">
          {hint}
        </p>
      ) : null}
    </article>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-base-content/6 py-3 last:border-b-0 last:pb-0 first:pt-0">
      <dt className="text-sm text-base-content/52">{label}</dt>
      <dd className="max-w-[60%] text-right text-sm font-medium text-base-content">
        {value}
      </dd>
    </div>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-md rounded-3xl border border-dashed border-base-content/14 bg-base-200/45 px-8 py-10 text-center shadow-[0_30px_60px_-45px_rgb(0_0_0_/_0.55)]">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-base-100 text-base-content/55">
          <Database size={22} />
        </div>
        <h2 className="mt-5 text-lg font-semibold text-base-content">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-base-content/55">{description}</p>
      </div>
    </div>
  );
}

function SkeletonPanel({ copy }: { copy: OverviewCopy }) {
  return (
    <div className="flex flex-1 flex-col gap-5 p-5 animate-pulse">
      <div className="h-20 rounded-3xl bg-base-200/70" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="h-32 rounded-2xl border border-base-content/6 bg-base-200/70"
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="h-72 rounded-2xl border border-base-content/6 bg-base-200/70" />
        <div className="h-72 rounded-2xl border border-base-content/6 bg-base-200/70" />
      </div>
      <span className="sr-only">{copy.loading}</span>
    </div>
  );
}

function buildMetricCards(
  overview: RedisOverviewMetrics,
  copy: OverviewCopy,
  localeTag: string
) {
  return [
    {
      label: copy.metricMemoryUsed,
      value: formatBytes(overview.memoryUsedBytes, localeTag),
      hint:
        overview.memoryRssBytes == null
          ? undefined
          : `RSS ${formatBytes(overview.memoryRssBytes, localeTag)}`,
      accentClassName: "bg-primary/14 text-primary",
      icon: <HardDrive size={18} />,
    },
    {
      label: copy.metricMemoryPeak,
      value: formatBytes(overview.memoryPeakBytes, localeTag),
      hint:
        overview.evictedKeys == null
          ? undefined
          : `${copy.evictedKeys} ${formatNumber(overview.evictedKeys, localeTag)}`,
      accentClassName: "bg-warning/15 text-warning",
      icon: <Database size={18} />,
    },
    {
      label: copy.metricClients,
      value: formatNumber(overview.connectedClients, localeTag),
      hint:
        overview.blockedClients == null
          ? undefined
          : `${copy.blockedClients} ${formatNumber(overview.blockedClients, localeTag)}`,
      accentClassName: "bg-success/15 text-success",
      icon: <Users size={18} />,
    },
    {
      label: copy.metricOps,
      value: formatNumber(overview.instantOpsPerSec, localeTag),
      hint:
        overview.expiredKeys == null
          ? undefined
          : `${copy.expiredKeys} ${formatNumber(overview.expiredKeys, localeTag)}`,
      accentClassName: "bg-info/16 text-info",
      icon: <Activity size={18} />,
    },
    {
      label: copy.metricHitRate,
      value: formatPercent(overview.cacheHitRate, localeTag),
      hint:
        overview.keyspaceHits == null || overview.keyspaceMisses == null
          ? undefined
          : `${formatNumber(overview.keyspaceHits, localeTag)} / ${formatNumber(
              overview.keyspaceMisses,
              localeTag
            )}`,
      accentClassName: "bg-secondary/16 text-secondary",
      icon: <Router size={18} />,
    },
    {
      label: copy.metricFragmentation,
      value: formatRatio(overview.memoryFragmentationRatio, localeTag),
      hint: overview.modeLabel,
      accentClassName: "bg-accent/16 text-accent",
      icon: <HardDrive size={18} />,
    },
  ];
}

export const RedisOverviewPanel = memo(function RedisOverviewPanel() {
  const { locale, localeTag, messages } = useI18n();
  const copy = OVERVIEW_COPY[locale === "zh" ? "zh" : "en"];
  const workspace = useRedisWorkspaceStore(
    useShallow((state) => ({
      activeConnectionId: state.activeConnectionId,
      connections: state.connections,
      isLoadingOverview: state.isLoadingOverview,
      overview: state.overview,
      overviewErrorMessage: state.overviewErrorMessage,
      refreshOverview: state.refreshOverview,
    }))
  );
  const activeConnection = useMemo(
    () =>
      workspace.connections.find(
        (connection) => connection.id === workspace.activeConnectionId
      ) ?? null,
    [workspace.activeConnectionId, workspace.connections]
  );
  const metricCards = useMemo(
    () =>
      workspace.overview
        ? buildMetricCards(workspace.overview, copy, localeTag)
        : [],
    [copy, localeTag, workspace.overview]
  );

  if (!activeConnection) {
    return (
      <EmptyState
        title={copy.noConnectionTitle}
        description={copy.noConnectionDescription}
      />
    );
  }

  if (workspace.isLoadingOverview && !workspace.overview) {
    return <SkeletonPanel copy={copy} />;
  }

  if (!workspace.overview) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-lg rounded-3xl border border-error/20 bg-error/6 px-8 py-10 text-center shadow-[0_24px_48px_-38px_rgb(239_68_68_/_0.45)]">
          <h2 className="text-lg font-semibold text-base-content">{copy.refreshFailed}</h2>
          <p className="mt-2 text-sm leading-6 text-base-content/58">
            {workspace.overviewErrorMessage || copy.tryAgain}
          </p>
          <button
            type="button"
            onClick={() => {
              void workspace.refreshOverview();
            }}
            className="btn btn-ghost btn-sm mt-5 rounded-xl"
          >
            <RefreshCw size={14} />
            {messages.common.refresh}
          </button>
        </div>
      </div>
    );
  }

  const overview = workspace.overview;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.08),transparent_28%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.08),transparent_26%)]">
      <div className="flex flex-col gap-5 p-5">
        <section className="rounded-[1.75rem] border border-base-content/8 bg-base-200/70 p-5 shadow-[0_24px_60px_-40px_rgb(0_0_0_/_0.55)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-2.5 w-2.5 rounded-full bg-success shadow-[0_0_16px_rgb(34_197_94_/_0.7)]" />
                <span className="text-[11px] font-mono uppercase tracking-[0.24em] text-base-content/45">
                  {messages.app.tabs.overview}
                </span>
              </div>
              <h1 className="mt-3 truncate text-2xl font-semibold tracking-tight text-base-content">
                {activeConnection.name}
              </h1>
              <p className="mt-2 text-sm text-base-content/58">{copy.subtitle}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-base-content/52">
                <span className="inline-block max-w-full truncate rounded-full bg-base-100 px-2.5 py-1 font-mono">
                  {getRedisConnectionEndpointLabel(activeConnection)}
                </span>
                <span className="rounded-full bg-base-100 px-2.5 py-1 font-mono">
                  {overview.modeLabel}
                </span>
                {overview.role ? (
                  <span className="rounded-full bg-base-100 px-2.5 py-1 font-mono">
                    {overview.role}
                  </span>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                void workspace.refreshOverview();
              }}
              className="btn btn-ghost btn-sm shrink-0 rounded-xl"
              disabled={workspace.isLoadingOverview}
            >
              <RefreshCw
                size={14}
                className={workspace.isLoadingOverview ? "animate-spin" : ""}
              />
              {messages.common.refresh}
            </button>
          </div>

          {workspace.overviewErrorMessage ? (
            <div className="mt-4 rounded-2xl border border-warning/20 bg-warning/8 px-4 py-3 text-sm text-base-content/72">
              {workspace.overviewErrorMessage}
            </div>
          ) : null}
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {metricCards.map((card) => (
            <MetricCard key={card.label} {...card} />
          ))}
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <article className="rounded-2xl border border-base-content/8 bg-base-200/70 p-5 shadow-[0_20px_48px_-40px_rgb(0_0_0_/_0.45)]">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-base-content/46">
              {copy.detailsTitle}
            </h2>
            <dl className="mt-5">
              <DetailRow
                label={copy.redisVersion}
                value={formatValue(overview.redisVersion, copy.notAvailable)}
              />
              <DetailRow
                label={copy.role}
                value={formatValue(overview.role, copy.notAvailable)}
              />
              <DetailRow
                label={copy.uptime}
                value={formatValue(
                  formatDuration(overview.uptimeSeconds, localeTag),
                  copy.notAvailable
                )}
              />
              <DetailRow
                label={copy.tcpPort}
                value={formatValue(overview.tcpPort, copy.notAvailable)}
              />
              <DetailRow label={copy.mode} value={overview.modeLabel} />
              <DetailRow
                label={copy.keyspace}
                value={formatValue(overview.keyspaceSummary, copy.notAvailable)}
              />
            </dl>
          </article>

          <article className="rounded-2xl border border-base-content/8 bg-base-200/70 p-5 shadow-[0_20px_48px_-40px_rgb(0_0_0_/_0.45)]">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-base-content/46">
              {copy.statsTitle}
            </h2>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <MetricCard
                label={copy.networkInput}
                value={formatBytes(overview.totalNetInputBytes, localeTag)}
                accentClassName="bg-base-100 text-base-content/70"
                icon={<Router size={18} />}
              />
              <MetricCard
                label={copy.networkOutput}
                value={formatBytes(overview.totalNetOutputBytes, localeTag)}
                accentClassName="bg-base-100 text-base-content/70"
                icon={<Router size={18} />}
              />
              <MetricCard
                label={copy.expiredKeys}
                value={formatNumber(overview.expiredKeys, localeTag)}
                accentClassName="bg-base-100 text-base-content/70"
                icon={<Activity size={18} />}
              />
              <MetricCard
                label={copy.evictedKeys}
                value={formatNumber(overview.evictedKeys, localeTag)}
                accentClassName="bg-base-100 text-base-content/70"
                icon={<Database size={18} />}
              />
              <MetricCard
                label={copy.keyspaceHits}
                value={formatNumber(overview.keyspaceHits, localeTag)}
                accentClassName="bg-base-100 text-base-content/70"
                icon={<Activity size={18} />}
              />
              <MetricCard
                label={copy.keyspaceMisses}
                value={formatNumber(overview.keyspaceMisses, localeTag)}
                accentClassName="bg-base-100 text-base-content/70"
                icon={<Activity size={18} />}
              />
            </div>
          </article>
        </section>
      </div>
    </div>
  );
});
