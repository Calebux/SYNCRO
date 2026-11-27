#!/usr/bin/env node
/**
 * Fail if git conflict markers are present in tracked source files.
 * Used by Husky pre-commit and CI parity workflow.
 */

import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const MARKERS = /^(<<<<<<< |=======($| )|>>>>>>> )/;
const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".md", ".yml", ".yaml", ".css", ".sql", ".rs",
]);
const IGNORED = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage"]);

function files() {
  try {
    return execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    console.error("git ls-files failed");
    process.exit(2);
  }
}

function ext(path) {
  const i = path.lastIndexOf(".");
  return i === -1 ? "" : path.slice(i);
}

const hits = [];

for (const file of files()) {
  if (file.split("/").some((s) => IGNORED.has(s))) continue;
  if (!SOURCE_EXTENSIONS.has(ext(file))) continue;
  if (file.endsWith("check-conflict-markers.mjs")) continue;
  // Lockfiles are regenerated; skip preexisting merge noise there
  if (file.endsWith("package-lock.json") || file.endsWith("yarn.lock") || file.endsWith("pnpm-lock.yaml")) continue;

  let content;
  try {
    if (statSync(file).isDirectory()) continue;
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  content.split("\n").forEach((line, i) => {
    if (MARKERS.test(line)) {
      hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 80)}`);
    }
  });
}

if (hits.length) {
  console.error("❌ Conflict markers found:\n" + hits.map((h) => `  ${h}`).join("\n"));
  process.exit(1);
}

console.log("✅ No conflict markers found.");
