#!/usr/bin/env node
/**
 * One-command local bootstrap.
 *
 *   npm run bootstrap
 *
 * Installs workspace deps, copies env templates, generates placeholder
 * secrets, builds @syncro/shared, and brings up the v3 local stack
 * (Postgres, Redis, Soroban RPC, mock provider) via Docker Compose.
 */
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

function run(cmd, opts = {}) {
  console.log(`\n→ ${cmd}`);
  execSync(cmd, { stdio: "inherit", env: process.env, ...opts });
}

function has(bin) {
  return spawnSync("bash", ["-lc", `command -v ${bin}`], { encoding: "utf8" }).status === 0;
}

function copyEnv(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`skip missing template ${path.relative(root, src)}`);
    return;
  }
  if (fs.existsSync(dest)) {
    console.log(`keep existing ${path.relative(root, dest)}`);
    return;
  }
  fs.copyFileSync(src, dest);
  console.log(`created ${path.relative(root, dest)} from template`);
}

function fillSecret(file, key) {
  if (!fs.existsSync(file)) return;
  let text = fs.readFileSync(file, "utf8");
  const re = new RegExp(`^${key}=.*$`, "m");
  const placeholder = `${key}=your_`;
  if (re.test(text) && text.match(re)[0].includes("your_")) {
    const value = crypto.randomBytes(32).toString("hex");
    text = text.replace(re, `${key}=${value}`);
    fs.writeFileSync(file, text);
    console.log(`generated ${key} in ${path.relative(root, file)}`);
  }
  void placeholder;
}

console.log("SYNCRO bootstrap");

run("npm install --legacy-peer-deps --ignore-scripts");

if (fs.existsSync(path.join(root, "shared/package.json"))) {
  try {
    run("npm run build -w shared");
  } catch {
    console.warn("shared workspace build skipped (package may not define build)");
  }
}

copyEnv(path.join(root, "backend/.env.example"), path.join(root, "backend/.env"));
copyEnv(path.join(root, "client/.env.example"), path.join(root, "client/.env.local"));
for (const f of ["backend/.env", "client/.env.local"]) {
  fillSecret(path.join(root, f), "JWT_SECRET");
  fillSecret(path.join(root, f), "ADMIN_API_KEY");
  fillSecret(path.join(root, f), "ENCRYPTION_KEY");
}

if (has("docker") && has("docker compose")) {
  try {
    run("docker compose up -d");
    // Wait for postgres to be healthy before seeding
    run("docker compose run --rm seed || true");
  } catch (err) {
    console.warn("v3 stack start/seed skipped:", err.message || err);
  }
} else {
  console.warn("Docker or Docker Compose not found — skip v3 stack. Run `npm run doctor`.");
}

console.log("\nBootstrap complete. Next:");
console.log("  npm run doctor          # verify toolchains");
console.log("  npm run dev -w backend  # API on :3001");
console.log("  npm run dev -w client   # app on :3000");
