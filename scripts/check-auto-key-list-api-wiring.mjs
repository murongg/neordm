import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const redisSource = readFileSync(resolve("src/lib/redis.ts"), "utf8");
const strategySource = readFileSync(
  resolve("src/store/keyListLoadingStrategy.ts"),
  "utf8"
);
const commandsSource = readFileSync(resolve("src-tauri/src/commands/mod.rs"), "utf8");
const tauriSource = readFileSync(resolve("src-tauri/src/lib.rs"), "utf8");

if (!commandsSource.includes("get_redis_db_size")) {
  throw new Error("commands/mod.rs must export get_redis_db_size.");
}

if (!commandsSource.includes("list_redis_key_names_fast")) {
  throw new Error("commands/mod.rs must export list_redis_key_names_fast.");
}

if (!tauriSource.includes("get_redis_db_size")) {
  throw new Error("Tauri invoke handler must register get_redis_db_size.");
}

if (!tauriSource.includes("list_redis_key_names_fast")) {
  throw new Error("Tauri invoke handler must register list_redis_key_names_fast.");
}

if (!redisSource.includes("export async function getRedisDbSize(")) {
  throw new Error("Missing getRedisDbSize wrapper.");
}

if (!redisSource.includes('"get_redis_db_size"')) {
  throw new Error("getRedisDbSize must invoke get_redis_db_size.");
}

if (!redisSource.includes("export async function listRedisKeyNamesFast(")) {
  throw new Error("Missing listRedisKeyNamesFast wrapper.");
}

if (!redisSource.includes('"list_redis_key_names_fast"')) {
  throw new Error("listRedisKeyNamesFast must invoke list_redis_key_names_fast.");
}

if (!strategySource.includes('export type KeyListStrategy = "direct-small-db-hot"')) {
  throw new Error("Strategy helper must export KeyListStrategy.");
}

if (!strategySource.includes("export function resolveKeyListStrategy(")) {
  throw new Error("Strategy helper must export resolveKeyListStrategy.");
}

console.log("Auto key-list API wiring check passed.");
