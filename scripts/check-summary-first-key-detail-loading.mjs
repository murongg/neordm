import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const storeSource = readFileSync(
  resolve("src/store/useRedisWorkspaceState.ts"),
  "utf8"
);
const redisSource = readFileSync(resolve("src/lib/redis.ts"), "utf8");
const valueEditorPanelSource = readFileSync(
  resolve("src/components/ValueEditorPanel.tsx"),
  "utf8"
);

const selectKeySection =
  storeSource.match(/selectKey: async[\s\S]*?createKey: async/s)?.[0] ?? "";

if (!storeSource.includes("loadKeySummary: async")) {
  throw new Error("Workspace store must expose loadKeySummary.");
}

if (!storeSource.includes("loadKeyValueContent: async")) {
  throw new Error("Workspace store must expose loadKeyValueContent.");
}

if (!selectKeySection.includes("await state.loadKeySummary(")) {
  throw new Error("selectKey must load summary before content.");
}

if (!selectKeySection.includes("void state.loadKeyValueContent(")) {
  throw new Error("selectKey must continue loading content asynchronously.");
}

if (!redisSource.includes("export async function getRedisKeySummary(")) {
  throw new Error("Missing getRedisKeySummary API wrapper.");
}

if (!redisSource.includes('invoke("get_redis_key_summary"')) {
  throw new Error("getRedisKeySummary must invoke backend summary command.");
}

if (!valueEditorPanelSource.includes("selectedKey={workspace.selectedKey}")) {
  throw new Error("ValueEditorPanel must pass selectedKey into ValueEditor.");
}

if (!valueEditorPanelSource.includes("isLoadingKeyValue={workspace.isLoadingKeyValue}")) {
  throw new Error("ValueEditorPanel must pass loading state into ValueEditor.");
}

console.log("Summary-first key detail loading check passed.");
