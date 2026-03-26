import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const redisSource = readFileSync(resolve("src/lib/redis.ts"), "utf8");
const storeSource = readFileSync(
  resolve("src/store/useRedisWorkspaceState.ts"),
  "utf8"
);
const keyBrowserSource = readFileSync(
  resolve("src/components/KeyBrowser.tsx"),
  "utf8"
);
const keyBrowserPanelSource = readFileSync(
  resolve("src/components/KeyBrowserPanel.tsx"),
  "utf8"
);
const keysCommandSource = readFileSync(
  resolve("src-tauri/src/commands/keys.rs"),
  "utf8"
);
const commandsModSource = readFileSync(
  resolve("src-tauri/src/commands/mod.rs"),
  "utf8"
);
const tauriLibSource = readFileSync(resolve("src-tauri/src/lib.rs"), "utf8");

if (!keysCommandSource.includes("pub async fn get_redis_key_type(")) {
  throw new Error("Backend must expose get_redis_key_type.");
}

if (!commandsModSource.includes("get_redis_key_type")) {
  throw new Error("commands/mod.rs must export get_redis_key_type.");
}

if (!tauriLibSource.includes("get_redis_key_type")) {
  throw new Error("Tauri invoke handler must register get_redis_key_type.");
}

if (!redisSource.includes("export async function getRedisKeyType(")) {
  throw new Error("Missing getRedisKeyType frontend wrapper.");
}

if (!redisSource.includes('"get_redis_key_type"')) {
  throw new Error("getRedisKeyType must invoke backend type command.");
}

if (!storeSource.includes("loadKeyType: async")) {
  throw new Error("Workspace store must expose loadKeyType.");
}

if (!storeSource.includes("getRedisKeyType(")) {
  throw new Error("loadKeyType must use getRedisKeyType.");
}

if (!keyBrowserPanelSource.includes("loadKeyType: state.loadKeyType")) {
  throw new Error("KeyBrowserPanel must read loadKeyType from the workspace store.");
}

if (!keyBrowserPanelSource.includes("onLoadKeyType={(key) =>")) {
  throw new Error("KeyBrowserPanel must bind loadKeyType to the active connection and db.");
}

if (!keyBrowserSource.includes("onLoadKeyType: (key: RedisKey) => Promise<void>;")) {
  throw new Error("KeyBrowser props must accept onLoadKeyType.");
}

if (!keyBrowserSource.includes("virtualRows")) {
  throw new Error("KeyBrowser must inspect virtualRows for visible keys.");
}

if (!keyBrowserSource.includes("row.kind === \"key\" && row.redisKey.type == null")) {
  throw new Error("KeyBrowser must target visible keys without a loaded type.");
}

if (!keyBrowserSource.includes("void onLoadKeyType(redisKey);")) {
  throw new Error("KeyBrowser must trigger type loading for visible keys.");
}

console.log("Visible key type loading check passed.");
