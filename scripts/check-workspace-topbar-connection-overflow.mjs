import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve("src/components/WorkspaceTopbarPanel.tsx"),
  "utf8"
);

if (!source.includes("getRedisConnectionCompactEndpointLabel")) {
  throw new Error("Workspace topbar must use a compact endpoint label.");
}

if (!source.includes('title={getRedisConnectionEndpointLabel(activeConnection)}')) {
  throw new Error("Workspace topbar must keep the full endpoint in a title attribute.");
}

if (!source.includes('className="text-[10px] font-mono truncate"')) {
  throw new Error("Workspace topbar endpoint text must truncate when horizontal space is tight.");
}

console.log("Workspace topbar connection overflow check passed.");
