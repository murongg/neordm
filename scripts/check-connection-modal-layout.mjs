import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve("src/components/ConnectionModal.tsx"),
  "utf8"
);

const scrollAreaPattern =
  /<div className="([^"]*\bflex-1\b[^"]*\boverflow-y-auto\b[^"]*\bpx-5\b[^"]*\bpy-4\b[^"]*)">/;

const match = source.match(scrollAreaPattern);

if (!match) {
  throw new Error("Could not find ConnectionModal scroll area className.");
}

const className = match[1];

if (!/\bmin-h-0\b/.test(className)) {
  throw new Error(
    `ConnectionModal scroll area must include min-h-0 to avoid clipping the status alert. Found: ${className}`
  );
}

console.log("ConnectionModal layout check passed.");
