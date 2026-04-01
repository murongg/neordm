import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const constantsSource = readFileSync(resolve("src/lib/openai/constants.ts"), "utf8");
const toolsSource = readFileSync(resolve("src/lib/openai/tools.ts"), "utf8");
const redisSource = readFileSync(resolve("src/lib/redis.ts"), "utf8");

if (!constantsSource.includes('runLuaScript: "runLuaScript"')) {
  throw new Error("AI_TOOL_NAMES must register runLuaScript.");
}

if (!toolsSource.includes("const LUA_SCRIPT_PARAMETERS = Type.Object(")) {
  throw new Error("Lua tool parameter schema must exist.");
}

if (!toolsSource.includes("name: AI_TOOL_NAMES.runLuaScript")) {
  throw new Error("createAssistantTools must expose runLuaScript.");
}

if (!toolsSource.includes("case AI_TOOL_NAMES.runLuaScript")) {
  throw new Error("executeAssistantToolCall must dispatch runLuaScript.");
}

if (!toolsSource.includes("request.confirmDangerousCommand")) {
  throw new Error("runLuaScript must request user confirmation.");
}

if (!toolsSource.includes("runRedisLuaScript(")) {
  throw new Error("runLuaScript must call the frontend Redis Lua helper.");
}

if (!redisSource.includes("export async function runRedisLuaScript(")) {
  throw new Error("redis.ts must export runRedisLuaScript.");
}

console.log("AI Lua tool check passed.");
