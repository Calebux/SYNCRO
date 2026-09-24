#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const sdkRoot = path.resolve(__dirname, "..");
const generatedPath = path.join(sdkRoot, "src", "generated", "gateway-errors.ts");
const backupPath = path.join(sdkRoot, "src", "generated", ".gateway-errors.backup.ts");

const before = fs.existsSync(generatedPath) ? fs.readFileSync(generatedPath, "utf8") : "";

if (before) {
  fs.writeFileSync(backupPath, before);
}

const result = spawnSync("node", [path.join(__dirname, "generate-gateway-errors.cjs")], {
  cwd: sdkRoot,
  encoding: "utf8",
});

if (result.status !== 0) {
  process.stderr.write(result.stderr || "Failed to regenerate gateway errors.\n");
  process.exit(result.status ?? 1);
}

const after = fs.readFileSync(generatedPath, "utf8");
const changed = before !== after;

if (before) {
  fs.writeFileSync(generatedPath, before);
  fs.unlinkSync(backupPath);
}

if (changed) {
  process.stderr.write(
    "Gateway taxonomy drift detected. Run `npm run generate:gateway-errors -w sdk` and commit generated output.\n",
  );
  process.exit(1);
}

process.stdout.write("Gateway taxonomy check passed.\n");
