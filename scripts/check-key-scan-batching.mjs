import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve("src-tauri/src/commands/keys.rs"), "utf8");

if (!source.includes("async fn scan_keys_metadata_batch(")) {
  throw new Error("Missing scan_keys_metadata_batch helper in keys.rs.");
}

const batchedCallsites = source.match(/scan_keys_metadata_batch\(/g) ?? [];

if (batchedCallsites.length < 3) {
  throw new Error(
    `Expected batched metadata helper definition plus scan callsites, found ${batchedCallsites.length}.`
  );
}

if (source.includes("scan_key_metadata(&mut connection, key")) {
  throw new Error("Found per-key metadata loading in SCAN path.");
}

console.log("Key scan batching check passed.");
