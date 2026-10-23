#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { verifyReceipt, type IndependentReceipt } from "../v3/receipt.js";

interface CliArgs {
  receiptPath: string;
  publicKeyPath: string;
  channel: string;
  nonce: string;
}

function parseArgs(argv: string[]): CliArgs {
  const map = new Map<string, string>();
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(
        "Usage: syncro-verify-receipt --receipt <path> --public-key <path> --channel <id> --nonce <nonce>",
      );
    }
    map.set(key.slice(2), value);
  }

  const receiptPath = map.get("receipt");
  const publicKeyPath = map.get("public-key");
  const channel = map.get("channel");
  const nonce = map.get("nonce");

  if (!receiptPath || !publicKeyPath || !channel || !nonce) {
    throw new Error(
      "Missing required flags. Required: --receipt --public-key --channel --nonce",
    );
  }

  return { receiptPath, publicKeyPath, channel, nonce };
}

function main() {
  const args = parseArgs(process.argv);
  const receipt = JSON.parse(readFileSync(args.receiptPath, "utf8")) as IndependentReceipt;
  const providerPublicKeyPem = readFileSync(args.publicKeyPath, "utf8");

  const result = verifyReceipt({
    receipt,
    providerPublicKeyPem,
    expectedChannelId: args.channel,
    expectedNonce: args.nonce,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 1);
}

main();
