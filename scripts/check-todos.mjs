#!/usr/bin/env node
/**
 * Technical debt policy checker for SYNCRO.
 *
 * Scans source files for TODO / FIXME comments and enforces that each one
 * references a GitHub issue, e.g.  // TODO(#491): migrate to new payment SDK
 *
 * - In CRITICAL_PATHS, an untracked TODO/FIXME is a hard failure (exit 1).
 * - Everywhere else, untracked TODO/FIXME is a warning only.
 * - Markdown / docs are never scanned (they describe debt, they don't create it).
 *
 * Usage:
 *   node scripts/check-todos.mjs            # scan whole repo
 *   node scripts/check-todos.mjs --warn-only  # never exit non-zero (report only)
 */

import { readFileSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// --- Configuration ---------------------------------------------------------

// Paths where untracked TODO/FIXME is a BLOCKING failure.
// These hold auth / payment / integration code. Tune to match your tree —
// prefer specific subdirs over whole app trees so the rule stays meaningful.
const CRITICAL_PATHS = [
  "backend",
  "sdk",
  "shared",
  "quota_guard",
  "client/app/api",   // API routes (auth, payments, CSP report, webhooks)
  "client/lib",       // shared client logic
  "app/api",
  "contracts",        // Soroban smart contracts — subscription/escrow/card logic
];

// File extensions we treat as source code.
const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".sql", ".rs",
]);

// Directories never scanned.
const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "coverage",
]);

// A TODO/FIXME is "tracked" when followed by (#123) — a GitHub issue ref.
// Matches:   TODO(#491):   FIXME(#491):   TODO(#491)
// Bare TODO / TODO: / FIXME without the (#nnn) ref is untracked.
const TODO_TOKEN = /\b(TODO|FIXME)\b/;
const TRACKED_TODO = /\b(TODO|FIXME)\(#\d+\)/;

// --- Helpers ---------------------------------------------------------------

function getTrackedFiles() {
  // Prefer git so we honor .gitignore; fall back to nothing if not a repo.
  try {
    const out = execSync("git ls-files", { encoding: "utf8" });
    return out.split("\n").filter(Boolean);
  } catch {
    console.error("Not a git repository (git ls-files failed).");
    process.exit(2);
  }
}

function extOf(path) {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot);
}

function isIgnored(path) {
  return path.split("/").some((seg) => IGNORED_DIRS.has(seg));
}

function isCritical(path) {
  return CRITICAL_PATHS.some(
    (p) => path === p || path.startsWith(p + "/")
  );
}

function runScan({ warnOnly = false } = {}) {
  const blocking = [];
  const warnings = [];

  for (const file of getTrackedFiles()) {
    if (isIgnored(file)) continue;
    if (file.endsWith("check-todos.mjs")) continue; // don't scan the scanner
  if (/\.test\.[^.]+$/.test(file) || file.includes(".test.")) continue; // tests may mention TODO format
    if (!SOURCE_EXTENSIONS.has(extOf(file))) continue;

    let content;
    try {
      if (statSync(file).isDirectory()) continue;
      content = readFileSync(file, "utf8");
    } catch {
      continue; // deleted / unreadable
    }

    const lines = content.split("\n");
    lines.forEach((line, i) => {
      if (!TODO_TOKEN.test(line)) return;
      if (TRACKED_TODO.test(line)) return; // properly tracked, OK

      const entry = {
        file,
        line: i + 1,
        text: line.trim().slice(0, 120),
      };
      if (isCritical(file)) blocking.push(entry);
      else warnings.push(entry);
    });
  }

  return { blocking, warnings };
}

// --- Report -----------------------------------------------------------------

function printGroup(label, entries) {
  console.log(`\n${label} (${entries.length}):`);
  for (const e of entries) {
    console.log(`  ${e.file}:${e.line}  ${e.text}`);
  }
}

function main() {
  const warnOnly = process.argv.includes("--warn-only");
  const { blocking, warnings } = runScan({ warnOnly });

  if (warnings.length) {
    printGroup("⚠️  Untracked TODO/FIXME (non-critical, warning)", warnings);
  }

  if (blocking.length) {
    printGroup("❌ Untracked TODO/FIXME in CRITICAL paths", blocking);
    console.log(
      "\nEvery TODO/FIXME in critical paths must reference a GitHub issue:\n" +
        "    // TODO(#123): short description\n" +
        "    // FIXME(#123): short description\n\n" +
        "1. Open an issue, label it `tech-debt` + a severity.\n" +
        "2. Reference its number in the comment.\n" +
        "3. Add a row to DEBT.md.\n"
    );
    if (!warnOnly) {
      process.exit(1);
    }
  }

  if (!blocking.length && !warnings.length) {
    console.log("✅ No untracked TODO/FIXME found.");
  } else if (!blocking.length) {
    console.log("\n✅ No blocking issues (critical paths are clean).");
  }
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main();
}

export {
  CRITICAL_PATHS,
  SOURCE_EXTENSIONS,
  TODO_TOKEN,
  TRACKED_TODO,
  isCritical,
  extOf,
  isIgnored,
};
