import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve("src/store/useRedisWorkspaceState.ts"),
  "utf8"
);
const selectConnectionSection =
  source.match(/selectConnection: async[\s\S]*?openNewConnectionModal:/)?.[0] ?? "";
const saveConnectionSection =
  source.match(/saveConnection: async[\s\S]*?deleteConnection:/)?.[0] ?? "";
const refreshKeysSection =
  source.match(/refreshKeys: async[\s\S]*?refreshKeyValue:/)?.[0] ?? "";
const refreshKeyValueSection =
  source.match(/refreshKeyValue: async[\s\S]*?clearSelectedKey:/)?.[0] ?? "";

if (!source.includes("panelTab: \"overview\"")) {
  throw new Error('Workspace state must default panelTab to "overview".');
}

if (!selectConnectionSection.includes('panelTab: "overview"')) {
  throw new Error("Selecting a connection must switch to the overview tab.");
}

if (!saveConnectionSection.includes('panelTab: "overview"')) {
  throw new Error("Saving a new connection must land on the overview tab.");
}

if (refreshKeysSection.includes("panelTab:")) {
  throw new Error("refreshKeys must not force the active panel tab.");
}

if (refreshKeyValueSection.includes("panelTab:")) {
  throw new Error("refreshKeyValue must not force the active panel tab.");
}

if (!source.includes("loadOverview: async")) {
  throw new Error("Workspace store must expose loadOverview.");
}

if (!source.includes("refreshOverview: async")) {
  throw new Error("Workspace store must expose refreshOverview.");
}

console.log("Overview workspace behavior check passed.");
