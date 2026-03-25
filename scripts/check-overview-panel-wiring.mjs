import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appSource = readFileSync(resolve("src/App.tsx"), "utf8");
const topbarSource = readFileSync(
  resolve("src/components/WorkspaceTopbarPanel.tsx"),
  "utf8"
);
const paletteSource = readFileSync(
  resolve("src/components/CommandPalette.tsx"),
  "utf8"
);

if (!appSource.includes('loadRedisOverviewPanel = () => import("./components/RedisOverviewPanel")')) {
  throw new Error("App must lazy-load RedisOverviewPanel.");
}

if (!appSource.includes("refreshOverview()")) {
  throw new Error("Workspace refresh flow must include refreshOverview.");
}

if (!topbarSource.includes('workspace.setPanelTab("overview")')) {
  throw new Error("Topbar must expose an overview tab trigger.");
}

if (!topbarSource.includes("messages.app.tabs.overview")) {
  throw new Error("Topbar must render the localized overview label.");
}

if (!paletteSource.includes('id: "action:panel-overview"')) {
  throw new Error("Command palette must expose the overview panel action.");
}

console.log("Overview panel wiring check passed.");
