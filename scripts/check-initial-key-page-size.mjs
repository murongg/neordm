import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve("src/store/useRedisWorkspaceState.ts"),
  "utf8"
);
const loadKeysSection = source.match(/loadKeys: async[\s\S]*?loadMoreKeys: async/s)?.[0] ?? "";

if (!source.includes("function getInitialKeyScanPageSize(")) {
  throw new Error("Missing getInitialKeyScanPageSize helper.");
}

if (
  loadKeysSection.includes(
    "pageSize: parsePositiveInt(appSettings.general.maxKeys, 10_000)"
  )
) {
  throw new Error("Initial key loading still uses maxKeys directly as page size.");
}

if (
  !loadKeysSection.includes(
    "pageSize: getInitialKeyScanPageSize(appSettings.general.maxKeys)"
  )
) {
  throw new Error("loadKeys must use getInitialKeyScanPageSize for the first page.");
}

if (!source.includes("pageSize: parsePositiveInt(appSettings.general.maxKeys, 10_000)")) {
  throw new Error("loadMoreKeys should continue using the configured maxKeys page size.");
}

console.log("Initial key page size check passed.");
