import { LazyStore } from "@tauri-apps/plugin-store";
import type {
  RedisClusterConfig,
  RedisConnection,
  RedisSentinelConfig,
  RedisSshTunnel,
} from "../types";

const CONNECTION_STORE_PATH = "connections.json";
const CONNECTIONS_KEY = "connections";

type PersistedRedisConnection = Omit<RedisConnection, "status">;

const connectionStore = new LazyStore(CONNECTION_STORE_PATH);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizePersistedSshTunnel(value: unknown): RedisSshTunnel | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const {
    host,
    port,
    username,
    password,
    privateKeyPath,
    passphrase,
  } = value;

  if (
    typeof host !== "string" ||
    typeof port !== "number" ||
    typeof username !== "string"
  ) {
    return undefined;
  }

  if (password !== undefined && typeof password !== "string") {
    return undefined;
  }

  if (privateKeyPath !== undefined && typeof privateKeyPath !== "string") {
    return undefined;
  }

  if (passphrase !== undefined && typeof passphrase !== "string") {
    return undefined;
  }

  return {
    host,
    port,
    username,
    password,
    privateKeyPath,
    passphrase,
  };
}

function normalizePersistedSentinel(value: unknown): RedisSentinelConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const { masterName, nodes, username, password, tls } = value;

  if (typeof masterName !== "string" || !Array.isArray(nodes)) {
    return undefined;
  }

  const normalizedNodes = nodes
    .map((node) => {
      if (!isRecord(node)) {
        return null;
      }

      const { host, port } = node;

      if (typeof host !== "string" || typeof port !== "number") {
        return null;
      }

      return {
        host,
        port,
      };
    })
    .filter((node): node is { host: string; port: number } => node !== null);

  if (!normalizedNodes.length) {
    return undefined;
  }

  if (username !== undefined && typeof username !== "string") {
    return undefined;
  }

  if (password !== undefined && typeof password !== "string") {
    return undefined;
  }

  if (tls !== undefined && typeof tls !== "boolean") {
    return undefined;
  }

  return {
    masterName,
    nodes: normalizedNodes,
    username,
    password,
    tls,
  };
}

function normalizePersistedCluster(value: unknown): RedisClusterConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const { nodes } = value;

  if (!Array.isArray(nodes)) {
    return undefined;
  }

  const normalizedNodes = nodes
    .map((node) => {
      if (!isRecord(node)) {
        return null;
      }

      const { host, port } = node;

      if (typeof host !== "string" || typeof port !== "number") {
        return null;
      }

      return {
        host,
        port,
      };
    })
    .filter((node): node is { host: string; port: number } => node !== null);

  if (!normalizedNodes.length) {
    return undefined;
  }

  return {
    nodes: normalizedNodes,
  };
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
    mode,
    sentinel,
    cluster,
    username,
    password,
    db,
    tls,
    sshTunnel,
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

  if (username !== undefined && typeof username !== "string") {
    return null;
  }

  if (
    mode !== undefined &&
    mode !== "direct" &&
    mode !== "sentinel" &&
    mode !== "cluster"
  ) {
    return null;
  }

  const normalizedSentinel = normalizePersistedSentinel(sentinel);
  const normalizedCluster = normalizePersistedCluster(cluster);

  return {
    id,
    name,
    host,
    port,
    mode:
      mode === "cluster" || (mode === undefined && normalizedCluster)
        ? "cluster"
        : mode === "sentinel" || (mode === undefined && normalizedSentinel)
          ? "sentinel"
          : "direct",
    sentinel: normalizedSentinel,
    cluster: normalizedCluster,
    username,
    password,
    db,
    tls,
    sshTunnel: normalizePersistedSshTunnel(sshTunnel),
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
  connections: RedisConnection[],
  options?: { savePasswords?: boolean }
): Promise<void> {
  const savePasswords = options?.savePasswords ?? true;

  await connectionStore.set(
    CONNECTIONS_KEY,
    connections.map((connection) => {
      const persistedConnection = toPersistedConnection(connection);

      if (savePasswords) {
        return persistedConnection;
      }

      const { password: _password, sshTunnel, ...sanitizedConnection } =
        persistedConnection;

      return {
        ...sanitizedConnection,
        sentinel: sanitizedConnection.sentinel
          ? {
              ...sanitizedConnection.sentinel,
              password: undefined,
            }
          : undefined,
        sshTunnel: sshTunnel
          ? {
              ...sshTunnel,
              password: undefined,
              passphrase: undefined,
            }
          : undefined,
      };
    })
  );
  await connectionStore.save();
}
