import { LazyStore } from "@tauri-apps/plugin-store";
import type { RedisConnection } from "../types";

const CONNECTION_STORE_PATH = "connections.json";
const CONNECTIONS_KEY = "connections";

type PersistedRedisConnection = Omit<RedisConnection, "status">;

const connectionStore = new LazyStore(CONNECTION_STORE_PATH);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizePersistedConnection(
  value: unknown
): PersistedRedisConnection | null {
  if (!isRecord(value)) return null;

  const {
    id,
    name,
    host,
    port,
    password,
    db,
    tls,
    color,
  } = value;

  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof host !== "string" ||
    typeof port !== "number" ||
    typeof db !== "number" ||
    typeof tls !== "boolean" ||
    typeof color !== "string"
  ) {
    return null;
  }

  if (password !== undefined && typeof password !== "string") {
    return null;
  }

  return {
    id,
    name,
    host,
    port,
    password,
    db,
    tls,
    color,
  };
}

function toPersistedConnection(
  connection: RedisConnection
): PersistedRedisConnection {
  const { status: _status, ...persistedConnection } = connection;
  return persistedConnection;
}

export async function loadStoredConnections(): Promise<RedisConnection[]> {
  const storedConnections = await connectionStore.get<unknown>(CONNECTIONS_KEY);

  if (!Array.isArray(storedConnections)) {
    return [];
  }

  return storedConnections
    .map(normalizePersistedConnection)
    .filter((connection): connection is PersistedRedisConnection => connection !== null)
    .map((connection) => ({
      ...connection,
      status: "disconnected" as const,
    }));
}

export async function persistConnections(
  connections: RedisConnection[]
): Promise<void> {
  await connectionStore.set(
    CONNECTIONS_KEY,
    connections.map(toPersistedConnection)
  );
}
