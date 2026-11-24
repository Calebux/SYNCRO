#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const sdkRoot = path.resolve(__dirname, "..");
const generatedPath = path.join(sdkRoot, "src", "generated", "gateway-errors.ts");
const taxonomyPath = path.resolve(sdkRoot, "..", "backend", "src", "errors", "gateway-taxonomy.json");
const generated = fs.readFileSync(generatedPath, "utf8");

const taxonomyRaw = fs.readFileSync(taxonomyPath, "utf8");
const expectedHash = crypto.createHash("sha256").update(taxonomyRaw).digest("hex");

if (!generated.includes(`Taxonomy hash: ${expectedHash}`)) {
  process.stderr.write(
    "Gateway taxonomy drift detected. Run `npm run generate:gateway-errors -w sdk` and commit generated output.\n",
  );
  process.exit(1);
}

const taxonomy = JSON.parse(taxonomyRaw);
const missingCodes = taxonomy.errors
  .map((entry) => entry.code)
  .filter((code) => !generated.includes(`'${code}'`));

if (missingCodes.length > 0) {
  process.stderr.write(`Generated gateway errors are missing: ${missingCodes.join(", ")}\n`);
  process.exit(1);
}

process.stdout.write("Gateway taxonomy check passed.\n");
