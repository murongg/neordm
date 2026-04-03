import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const keysSource = readFileSync(resolve("src-tauri/src/commands/keys.rs"), "utf8");
const storeSource = readFileSync(
  resolve("src/store/useRedisWorkspaceState.ts"),
  "utf8"
);

if (!keysSource.includes("const SMALL_DB_FAST_PATH_LIMIT: u64 = 10_000;")) {
  throw new Error("Backend must cap the small-db fast path at 10_000 keys.");
}

if (!keysSource.includes("connection.cluster.is_none()")) {
  throw new Error("Small-db fast path must reject cluster connections.");
}

if (!keysSource.includes("connection.sentinel.is_none()")) {
  throw new Error("Small-db fast path must reject sentinel connections.");
}

if (!keysSource.includes('redis::cmd("KEYS")')) {
  throw new Error("Fast path must use a full key-name fetch.");
}

if (!storeSource.includes('strategy === "direct-small-db-cold"')) {
  throw new Error("Store must gate the fast path behind the cold small-db strategy.");
}

if (!storeSource.includes(".catch(() => null)")) {
  throw new Error("DBSIZE lookup must fail open to the SCAN path.");
}

console.log("Auto key-list fast-path guard check passed.");
