import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve("src/components/RedisOverviewPanel.tsx"),
  "utf8"
);

if (!source.includes("export const RedisOverviewPanel")) {
  throw new Error("Missing RedisOverviewPanel component export.");
}

if (!source.includes("refreshOverview")) {
  throw new Error("RedisOverviewPanel must support manual refresh.");
}

if (!source.includes("overviewErrorMessage")) {
  throw new Error("RedisOverviewPanel must render overview error state.");
}

if (!source.includes("overview")) {
  throw new Error("RedisOverviewPanel must render overview metrics.");
}

console.log("Overview panel UI check passed.");
