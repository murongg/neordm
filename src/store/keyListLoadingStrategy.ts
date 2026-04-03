import type { RedisConnection } from "../types";

export type KeyListStrategy = "direct-small-db-hot" | "direct-small-db-cold" | "direct-large-or-unknown";

export interface KeyListPerfHint {
  dbSizeSnapshots: number[];
  firstPaintDurationsMs: number[];
  fullLoadDurationsMs: number[];
  fastPathSuccesses: number;
  fastPathFailures: number;
}

export function getKeyListSessionKey(connectionId: string, db: number) {
  return `${connectionId}:${db}`;
}

export function resolveKeyListStrategy(input: {
  connection: Pick<RedisConnection, "mode">;
  dbSize: number | null;
  hasCache: boolean;
  perfHint?: KeyListPerfHint | null;
}): KeyListStrategy {
  const mode = input.connection.mode ?? "direct";

  if (mode !== "direct") {
    return "direct-large-or-unknown";
  }

  if (input.dbSize == null || input.dbSize > 10_000) {
    return "direct-large-or-unknown";
  }

  if (input.hasCache) {
    return "direct-small-db-hot";
  }

  if ((input.perfHint?.fastPathFailures ?? 0) > 0) {
    return "direct-large-or-unknown";
  }

  return "direct-small-db-cold";
}

export function pushPerfSample(samples: number[], nextValue: number, limit = 3) {
  return [...samples.slice(-(limit - 1)), nextValue];
}
