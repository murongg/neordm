import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const typeSource = readFileSync(resolve("src/types/index.ts"), "utf8");
const redisSource = readFileSync(resolve("src/lib/redis.ts"), "utf8");

if (!typeSource.includes('export type PanelTab = "overview"')) {
  throw new Error('PanelTab must include "overview" as the default workspace tab.');
}

if (!typeSource.includes("export interface RedisOverviewMetrics")) {
  throw new Error("Missing RedisOverviewMetrics type.");
}

if (!redisSource.includes("export async function getRedisOverviewMetrics(")) {
  throw new Error("Missing getRedisOverviewMetrics API wrapper.");
}

if (!redisSource.includes('invoke("get_redis_overview_metrics"')) {
  throw new Error("getRedisOverviewMetrics must invoke the backend overview command.");
}

console.log("Overview API wiring check passed.");
