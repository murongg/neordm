import type { RedisConnection } from "../types";
import { formatMessageTemplate, getCurrentMessages } from "../i18n";

export interface ParsedRedisConnectionUrl {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db: number;
  tls: boolean;
}

const DEFAULT_REDIS_PORT = 6379;
const DEFAULT_REDIS_DB = 0;

export function formatRedisAddress(host: string, port: number) {
  return `${host}:${port}`;
}

export function getRedisConnectionEndpointLabel(
  connection: Pick<
    RedisConnection,
    "host" | "port" | "mode" | "sentinel" | "cluster"
  >
) {
  const messages = getCurrentMessages();

  if (connection.mode === "cluster" && connection.cluster?.nodes?.length) {
    return formatMessageTemplate(messages.ui.connection.clusterNodesLabel, {
      count: connection.cluster.nodes.length,
    });
  }

  if (connection.mode === "sentinel" && connection.sentinel?.masterName?.trim()) {
    return `sentinel/${connection.sentinel.masterName.trim()}`;
  }

  return formatRedisAddress(connection.host, connection.port);
}

export function getRedisConnectionDefaultName(
  connection: Pick<
    RedisConnection,
    "host" | "port" | "mode" | "sentinel" | "cluster"
  >
) {
  const messages = getCurrentMessages();

  if (connection.mode === "cluster" && connection.cluster?.nodes?.length) {
    return formatMessageTemplate(messages.ui.connection.clusterDefaultName, {
      count: connection.cluster.nodes.length,
    });
  }

  if (connection.mode === "sentinel" && connection.sentinel?.masterName?.trim()) {
    return formatMessageTemplate(messages.ui.connection.sentinelDefaultName, {
      name: connection.sentinel.masterName.trim(),
    });
  }

  return formatRedisAddress(connection.host, connection.port);
}

export function parseRedisConnectionUrl(
  connectionUrl: string
): ParsedRedisConnectionUrl {
  const errors = getCurrentMessages().ui.errors;
  const normalizedUrl = connectionUrl.trim();

  if (!normalizedUrl) {
    throw new Error(errors.redisUrlEmpty);
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(normalizedUrl);
  } catch {
    throw new Error(errors.invalidRedisUrl);
  }

  if (parsedUrl.protocol !== "redis:" && parsedUrl.protocol !== "rediss:") {
    throw new Error(errors.redisUrlProtocol);
  }

  const host = parsedUrl.hostname.trim();

  if (!host.length) {
    throw new Error(errors.redisUrlHostMissing);
  }

  const port = parsedUrl.port
    ? Number.parseInt(parsedUrl.port, 10)
    : DEFAULT_REDIS_PORT;

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(errors.redisUrlPortInvalid);
  }

  const dbSegment = parsedUrl.pathname.replace(/^\/+/, "");
  const db = dbSegment.length
    ? Number.parseInt(dbSegment, 10)
    : DEFAULT_REDIS_DB;

  if (
    (dbSegment.length > 0 && !/^\d+$/.test(dbSegment)) ||
    !Number.isInteger(db) ||
    db < 0
  ) {
    throw new Error(errors.redisUrlDbInvalid);
  }

  const username = parsedUrl.username
    ? decodeURIComponent(parsedUrl.username).trim()
    : "";
  const password = parsedUrl.password
    ? decodeURIComponent(parsedUrl.password)
    : "";

  return {
    host,
    port,
    username: username || undefined,
    password: password || undefined,
    db,
    tls: parsedUrl.protocol === "rediss:",
  };
}
