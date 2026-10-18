#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { verifyReceipt, type IndependentReceipt, type VerifyReceiptResult } from "../v3/receipt.js";

interface CliArgs {
  source: string;
  publicKeyPath: string;
  channel: string;
  nonce: string;
  json: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const map = new Map<string, string>();
  const flags = new Set<string>();
  
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    
    if (arg === "--json") {
      flags.add("json");
      continue;
    }
    
    if (arg.startsWith("--")) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for flag ${arg}`);
      }
      map.set(arg.slice(2), value);
      i++; // Skip next arg since we consumed it
    }
  }

  const source = map.get("file") || map.get("url");
  const publicKeyPath = map.get("public-key");
  const channel = map.get("channel");
  const nonce = map.get("nonce");

  if (!source) {
    throw new Error("Missing required flag: --file or --url");
  }
  if (!publicKeyPath || !channel || !nonce) {
    throw new Error(
      "Missing required flags. Required: (--file or --url), --public-key, --channel, --nonce",
    );
  }

  return { 
    source, 
    publicKeyPath, 
    channel, 
    nonce,
    json: flags.has("json")
  };
}

async function fetchReceiptFromUrl(url: string): Promise<IndependentReceipt> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch receipt: ${response.status} ${response.statusText}`);
  }
  return await response.json() as IndependentReceipt;
}

function loadReceiptFromFile(path: string): IndependentReceipt {
  const content = readFileSync(path, "utf8");
  return JSON.parse(content) as IndependentReceipt;
}

function printHumanReadable(result: VerifyReceiptResult): void {
  console.log("\nReceipt Verification Result:");
  console.log("═".repeat(50));
  
  const checks = [
    { name: "Receipt Shape", passed: !result.failures.some(f => f.check === "receipt-shape") },
    { name: "Signature", passed: !result.failures.some(f => f.check === "signature") },
    { name: "Amount", passed: !result.failures.some(f => f.check === "amount") },
    { name: "Channel", passed: !result.failures.some(f => f.check === "channel") },
    { name: "Nonce", passed: !result.failures.some(f => f.check === "nonce") },
  ];
  
  for (const check of checks) {
    const status = check.passed ? "✓ PASS" : "✗ FAIL";
    const color = check.passed ? "\x1b[32m" : "\x1b[31m";
    const reset = "\x1b[0m";
    console.log(`${color}${status}${reset} ${check.name}`);
  }
  
  console.log("═".repeat(50));
  console.log(`Overall: ${result.ok ? "\x1b[32m✓ VALID\x1b[0m" : "\x1b[31m✗ INVALID\x1b[0m"}`);
  
  if (!result.ok && result.failures.length > 0) {
    console.log("\nFailure Details:");
    for (const failure of result.failures) {
      console.log(`\n  ${failure.check}:`);
      console.log(`    Code: ${failure.code}`);
      console.log(`    Message: ${failure.message}`);
      if (failure.expected !== undefined) {
        console.log(`    Expected: ${failure.expected}`);
        console.log(`    Actual: ${failure.actual}`);
      }
    }
  }
  
  if (result.derivedAmountMinor !== undefined) {
    console.log(`\nDerived Amount: ${result.derivedAmountMinor} (minor units)`);
  }
  console.log();
}

async function main() {
  try {
    const args = parseArgs(process.argv);
    
    // Load receipt from file or URL
    const receipt = args.source.startsWith("http://") || args.source.startsWith("https://")
      ? await fetchReceiptFromUrl(args.source)
      : loadReceiptFromFile(args.source);
    
    // Load provider public key
    const providerPublicKeyPem = readFileSync(args.publicKeyPath, "utf8");
    
    // Verify the receipt
    const result = verifyReceipt({
      receipt,
      providerPublicKeyPem,
      expectedChannelId: args.channel,
      expectedNonce: args.nonce,
    });
    
    // Output results
    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      printHumanReadable(result);
    }
    
    // Exit with appropriate code
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (process.argv.includes("--json")) {
      process.stderr.write(JSON.stringify({ error: message }, null, 2) + "\n");
    } else {
      console.error(`\x1b[31mError:\x1b[0m ${message}\n`);
    }
    process.exit(1);
  }
}

main();
