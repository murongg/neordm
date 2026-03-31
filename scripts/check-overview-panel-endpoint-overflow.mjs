import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve("src/components/RedisOverviewPanel.tsx"),
  "utf8"
);

const endpointBadgeMatch = source.match(
  /<span className="([^"]+)">\s*\{getRedisConnectionEndpointLabel\(activeConnection\)\}\s*<\/span>/
);

if (!endpointBadgeMatch) {
  throw new Error("Could not find the overview endpoint badge.");
}

const className = endpointBadgeMatch[1];

if (!/\bmax-w-full\b/.test(className)) {
  throw new Error(
    `Overview endpoint badge must cap width with max-w-full. Found: ${className}`
  );
}

if (!/\btruncate\b/.test(className)) {
  throw new Error(
    `Overview endpoint badge must truncate long connection endpoints. Found: ${className}`
  );
}

console.log("Overview endpoint overflow check passed.");
