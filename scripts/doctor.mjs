#!/usr/bin/env node
/**
 * Report missing local-dev prerequisites with actionable install hints.
 *
 *   npm run doctor
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PINNED_NODE = "20";
const PINNED_RUST = "1.91.0";
const PINNED_SOROBAN = "23.0.0";

const missing = [];
const ok = [];

function which(bin) {
  const r = spawnSync("bash", ["-lc", `command -v ${bin}`], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
}

function ver(cmd) {
  const r = spawnSync("bash", ["-lc", cmd], { encoding: "utf8" });
  return (r.stdout || r.stderr || "").trim().split("\n")[0];
}

function exec(cmd) {
  const r = spawnSync("bash", ["-lc", cmd], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout?.trim() || "", stderr: r.stderr?.trim() || "" };
}

function check(name, bin, hint, versionCmd, expectPrefix) {
  const found = which(bin);
  if (!found) {
    missing.push(`${name} is not installed. ${hint}`);
    return;
  }
  const v = versionCmd ? ver(versionCmd) : found;
  if (expectPrefix && v && !v.includes(expectPrefix)) {
    missing.push(`${name} is ${v}, expected ${expectPrefix}. ${hint}`);
    return;
  }
  ok.push(`${name}: ${v || found}`);
}

check("Node.js", "node", "Install Node 20 from https://nodejs.org or `nvm install 20`.", "node -v", `v${PINNED_NODE}`);
check("npm", "npm", "npm ships with Node 20.", "npm -v");
check("Rust", "rustc", `Install Rust ${PINNED_RUST} via rustup (see rust-toolchain.toml).`, "rustc --version", PINNED_RUST.split(".")[0] + "." + PINNED_RUST.split(".")[1]);
check("Cargo", "cargo", "Cargo ships with rustup.", "cargo --version");
check(
  "Soroban/Stellar CLI",
  "soroban",
  `cargo install --locked --version ${PINNED_SOROBAN} soroban-cli`,
  "soroban version || stellar version",
);
if (!which("soroban") && which("stellar")) {
  ok.push(`Stellar CLI: ${ver("stellar version")}`);
  // remove the soroban miss if stellar is present
  const idx = missing.findIndex((m) => m.startsWith("Soroban"));
  if (idx >= 0) missing.splice(idx, 1);
}
check("Docker", "docker", "Install Docker Desktop / engine. Required for the v3 local stack.", "docker --version");
check("Docker Compose", "docker compose", "Bundled with Docker Desktop; install separately on Linux.", "docker compose version");

// Check if Docker daemon is running
if (which("docker")) {
  const dockerInfo = exec("docker info 2>&1");
  if (dockerInfo.status !== 0 || dockerInfo.stderr.includes("Cannot connect")) {
    missing.push("Docker daemon is not running. Start Docker Desktop or run: sudo systemctl start docker");
  } else {
    ok.push("Docker daemon: running");
  }
}

// Check wasm32-unknown-unknown target
if (which("rustup")) {
  const targets = exec("rustup target list --installed");
  if (targets.status === 0 && targets.stdout.includes("wasm32-unknown-unknown")) {
    ok.push("Rust target wasm32-unknown-unknown: installed");
  } else {
    missing.push("Rust target wasm32-unknown-unknown is not installed. Add with: rustup target add wasm32-unknown-unknown");
  }
}

// Check for ports in use (common dev ports)
const ports = [3000, 5432, 6379, 8080];
for (const port of ports) {
  const check = exec(`lsof -i :${port} -sTCP:LISTEN -t 2>/dev/null || netstat -tuln 2>/dev/null | grep :${port}`);
  if (check.stdout) {
    missing.push(`Port ${port} is already in use. Stop the process or change the port configuration.`);
  }
}

const redis = which("redis-server") || which("redis-cli");
if (!redis) {
  ok.push("Redis: optional (not found) — Docker Compose provides Redis for the v3 stack");
} else {
  ok.push(`Redis: ${redis}`);
}

const envFiles = [
  ["backend/.env.example", "required template"],
  ["backend/.env", "copy with: npm run bootstrap"],
  ["docker-compose.yml", "v3 stack definition"],
];
for (const [rel, hint] of envFiles) {
  const p = path.join(root, rel);
  if (fs.existsSync(p)) ok.push(`file ${rel}`);
  else if (rel.endsWith(".example")) missing.push(`Missing ${rel} (${hint})`);
  else ok.push(`file ${rel}: absent (bootstrap will create it)`);
}

console.log("SYNCRO doctor\n");
for (const line of ok) console.log(`  ok   ${line}`);
if (missing.length) {
  console.log("");
  for (const line of missing) console.log(`  miss ${line}`);
  console.log(`\n${missing.length} issue(s). Fix the items above, then re-run npm run doctor.`);
  process.exit(1);
}
console.log("\nAll required prerequisites are present.");
