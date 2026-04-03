import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const storeSource = readFileSync(
  resolve("src/store/useRedisWorkspaceState.ts"),
  "utf8"
);

if (!storeSource.includes("keyListStrategySessions: {}")) {
  throw new Error("Store must initialize keyListStrategySessions.");
}

if (!storeSource.includes("keyListCaches: {}")) {
  throw new Error("Store must initialize keyListCaches.");
}

if (!storeSource.includes("keyListPerfHints: {}")) {
  throw new Error("Store must initialize keyListPerfHints.");
}

if (!storeSource.includes("getRedisDbSize(")) {
  throw new Error("loadKeys must request DB size.");
}

if (!storeSource.includes("resolveKeyListStrategy(")) {
  throw new Error("loadKeys must resolve a key-list strategy.");
}

if (!storeSource.includes("listRedisKeyNamesFast(")) {
  throw new Error("loadKeys must support the fast path.");
}

if (!storeSource.includes("scanRedisKeysPage(")) {
  throw new Error("loadKeys must retain the SCAN fallback.");
}

if (!storeSource.includes("const cachedKeys = state.keyListCaches[sessionKey]?.keys")) {
  throw new Error("loadKeys must be able to paint cached keys first.");
}

console.log("Auto key-list store behavior check passed.");
