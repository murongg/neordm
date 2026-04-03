import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const keysSource = readFileSync(resolve("src-tauri/src/commands/keys.rs"), "utf8");
const storeSource = readFileSync(
  resolve("src/store/useRedisWorkspaceState.ts"),
  "utf8"
);

const scanDirectSection =
  keysSource.match(/async fn scan_direct_keys_page[\s\S]*?Ok\(RedisKeysScanPageResponse/s)?.[0] ??
  "";
const scanClusterSection =
  keysSource.match(/async fn scan_cluster_keys_page[\s\S]*?Ok\(RedisKeysScanPageResponse/s)?.[0] ??
  "";
const loadKeyValueSection =
  storeSource.match(/loadKeyValueContent: async[\s\S]*?loadMoreKeyValue: async/s)?.[0] ?? "";

if (/cmd\("TYPE"\)|cmd\("TTL"\)|scan_keys_metadata_batch/.test(scanDirectSection)) {
  throw new Error("Direct SCAN page must not fetch TYPE/TTL metadata eagerly.");
}

if (/cmd\("TYPE"\)|cmd\("TTL"\)|scan_keys_metadata_batch/.test(scanClusterSection)) {
  throw new Error("Cluster SCAN page must not fetch TYPE/TTL metadata eagerly.");
}

if (!loadKeyValueSection.includes("selectedKey: enrichedSelectedKey")) {
  throw new Error("loadKeyValue must enrich selectedKey metadata after key details load.");
}

if (!loadKeyValueSection.includes("enrichRedisKeyMetadata(key, value)")) {
  throw new Error("loadKeyValue must backfill key type from fetched key details.");
}

if (!loadKeyValueSection.includes("enrichRedisKeyMetadata(item, value)")) {
  throw new Error("loadKeyValue must backfill key ttl from fetched key details.");
}

if (!storeSource.includes('strategy === "direct-small-db-cold"')) {
  throw new Error(
    "Automatic key list loading must still isolate the fast path behind the cold small-db strategy."
  );
}

console.log("Lightweight key list strategy check passed.");
