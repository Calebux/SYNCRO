#!/usr/bin/env node
/**
 * Negative-path coverage check.
 *
 * Every public contract entrypoint must have:
 *   - neg_{fn}_unauthorized
 *   - neg_{fn}_wrong_state
 * in that crate's tests, and a matching row in contracts/README.md
 * between the NEGATIVE-PATH-MATRIX markers.
 *
 * Token-transferring crates must also contain a test whose name includes
 * `malicious_token_reentrancy`.
 *
 * Exit 1 if a new entrypoint is missing negative tests or the README
 * matrix is stale.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACTS_ROOT = path.resolve(__dirname, "../contracts");
const README = path.resolve(__dirname, "../README.md");

const TOKEN_TRANSFER_CRATES = new Set([
  "payment-channel",
  "escrow",
  "allowance",
  "payment-adapter",
  "payment-splitter",
  "recurring_allowance",
  "subscription_renewal",
  "subscription_refund",
]);

function stripTestModules(src) {
  let out = src.replace(/#\[cfg\(test\)\]\s*mod\s+\w+\s*;/g, "");
  const marker = "#[cfg(test)]";
  let idx = out.indexOf(marker);
  while (idx !== -1) {
    const modIdx = out.indexOf("mod ", idx);
    if (modIdx === -1 || modIdx - idx > 80) break;
    const brace = out.indexOf("{", modIdx);
    if (brace === -1) break;
    let depth = 0;
    let end = brace;
    for (let i = brace; i < out.length; i++) {
      if (out[i] === "{") depth++;
      else if (out[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    out = out.slice(0, idx) + out.slice(end);
    idx = out.indexOf(marker);
  }
  return out;
}

function publicFns(libSrc) {
  const src = stripTestModules(libSrc);
  const fns = [];
  const re = /pub fn ([a-z][a-z0-9_]*)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    if (!fns.includes(m[1])) fns.push(m[1]);
  }
  return fns;
}

function collectTests(dir) {
  const names = [];
  if (!fs.existsSync(dir)) return names;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) names.push(...collectTests(p));
    else if (entry.name.endsWith(".rs")) {
      const text = fs.readFileSync(p, "utf8");
      for (const m of text.matchAll(/fn\s+(neg_[a-z0-9_]+|malicious_token_reentrancy[a-z0-9_]*)\s*\(/g)) {
        names.push(m[1]);
      }
    }
  }
  return names;
}

function parseReadmeMatrix(readme) {
  const start = "<!-- BEGIN NEGATIVE-PATH-MATRIX -->";
  const end = "<!-- END NEGATIVE-PATH-MATRIX -->";
  const a = readme.indexOf(start);
  const b = readme.indexOf(end);
  if (a === -1 || b === -1) return null;
  const block = readme.slice(a + start.length, b);
  const rows = new Set();
  for (const line of block.split("\n")) {
    const m = line.match(/\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/);
    if (m) rows.add(`${m[1]}::${m[2]}`);
  }
  return rows;
}

const crates = fs
  .readdirSync(CONTRACTS_ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(CONTRACTS_ROOT, d.name, "src/lib.rs")))
  .map((d) => d.name)
  .sort();

const missing = [];
const matrixExpected = [];
let readme = "";
try {
  readme = fs.readFileSync(README, "utf8");
} catch {
  missing.push("contracts/README.md is missing");
}
const matrixRows = readme ? parseReadmeMatrix(readme) : null;
if (readme && matrixRows === null) {
  missing.push("contracts/README.md is missing NEGATIVE-PATH-MATRIX markers");
}

for (const crate of crates) {
  const lib = fs.readFileSync(path.join(CONTRACTS_ROOT, crate, "src/lib.rs"), "utf8");
  const fns = publicFns(lib);
  const tests = collectTests(path.join(CONTRACTS_ROOT, crate, "src"));
  const testSet = new Set(tests);

  for (const fn of fns) {
    matrixExpected.push(`${crate}::${fn}`);
    if (!testSet.has(`neg_${fn}_unauthorized`)) {
      missing.push(`${crate}: missing neg_${fn}_unauthorized`);
    }
    if (!testSet.has(`neg_${fn}_wrong_state`)) {
      missing.push(`${crate}: missing neg_${fn}_wrong_state`);
    }
    if (matrixRows && !matrixRows.has(`${crate}::${fn}`)) {
      missing.push(`${crate}: ${fn} not listed in README negative-path matrix`);
    }
  }

  if (TOKEN_TRANSFER_CRATES.has(crate)) {
    const hasReentrancy = tests.some((t) => t.includes("malicious_token_reentrancy"));
    if (!hasReentrancy) {
      missing.push(`${crate}: missing malicious_token_reentrancy test`);
    }
  }
}

if (matrixRows) {
  for (const row of matrixRows) {
    if (!matrixExpected.includes(row)) {
      missing.push(`README matrix lists removed entrypoint ${row}`);
    }
  }
}

if (missing.length) {
  console.error("Negative-path coverage check failed:\n");
  for (const line of missing) console.error("  - " + line);
  console.error(`\n${missing.length} issue(s). Add the named tests and keep contracts/README.md in sync.`);
  process.exit(1);
}

console.log(`Negative-path coverage OK — ${matrixExpected.length} entrypoints across ${crates.length} contracts.`);
