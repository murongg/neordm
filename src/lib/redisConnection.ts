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

export function parseRedisConnectionUrl(
  connectionUrl: string
): ParsedRedisConnectionUrl {
  const normalizedUrl = connectionUrl.trim();

  if (!normalizedUrl) {
    throw new Error("Redis URL cannot be empty");
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(normalizedUrl);
  } catch {
    throw new Error("Invalid Redis URL");
  }

  if (parsedUrl.protocol !== "redis:" && parsedUrl.protocol !== "rediss:") {
    throw new Error("Redis URL must start with redis:// or rediss://");
  }

  const host = parsedUrl.hostname.trim();

  if (!host.length) {
    throw new Error("Redis URL is missing a host");
  }

  const port = parsedUrl.port
    ? Number.parseInt(parsedUrl.port, 10)
    : DEFAULT_REDIS_PORT;

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("Redis URL port must be between 1 and 65535");
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
    throw new Error("Redis URL database must be a non-negative integer");
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
