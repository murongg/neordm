import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve("src/components/key-browser/LoadMoreSection.tsx"),
  "utf8"
);

if (!source.includes("isLoadingMore ? (")) {
  throw new Error("LoadMoreSection should render a dedicated loading state action.");
}

if (!source.includes("onClick={onStopLoadingMore}")) {
  throw new Error("Stop loading button is missing.");
}

if (!source.includes("cursor-pointer bg-transparent p-0")) {
  throw new Error("Stop loading button should use a text-style class.");
}

if (!source.includes("flex items-center gap-3")) {
  throw new Error("LoadMoreSection should keep summary and actions in a compact row.");
}

console.log("Load more stop style check passed.");
