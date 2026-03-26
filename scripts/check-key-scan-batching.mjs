import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve("src-tauri/src/commands/keys.rs"), "utf8");
const scanDirectSection =
  source.match(/async fn scan_direct_keys_page[\s\S]*?Ok\(RedisKeysScanPageResponse/s)?.[0] ??
  "";
const scanClusterSection =
  source.match(/async fn scan_cluster_keys_page[\s\S]*?Ok\(RedisKeysScanPageResponse/s)?.[0] ??
  "";

if (/cmd\("TYPE"\)|cmd\("TTL"\)|scan_keys_metadata_batch/.test(scanDirectSection)) {
  throw new Error("Direct SCAN page must not fetch TYPE/TTL metadata eagerly.");
}

if (/cmd\("TYPE"\)|cmd\("TTL"\)|scan_keys_metadata_batch/.test(scanClusterSection)) {
  throw new Error("Cluster SCAN page must not fetch TYPE/TTL metadata eagerly.");
}

console.log("Key scan lightweight strategy check passed.");
