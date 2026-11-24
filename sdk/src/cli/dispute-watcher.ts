#!/usr/bin/env node
/**
 * Consumer-side dispute watcher — CLI entry point (issue #1796).
 *
 * Runs `watchChannels` as a long-running daemon process. Exits on SIGINT /
 * SIGTERM, waiting for the current poll tick to finish cleanly.
 *
 * Usage
 * ─────
 *   node dispute-watcher.js \
 *     --contract  CCHANNEL_CONTRACT_ID   \
 *     --caller    GCONSUMER_PUBLIC_KEY   \
 *     --channels  1,2,3                 \
 *     --poll      10000                 \
 *     --alert     300                   \
 *     --rpc       https://soroban-rpc.example.com
 *
 * Flags
 * ─────
 *   --contract    Soroban contract ID of the payment-channel contract (required)
 *   --caller      Consumer's Stellar public key (required)
 *   --channels    Comma-separated list of channel IDs to watch (required)
 *   --poll        Poll interval in ms (default: 10000)
 *   --alert       Alert threshold in seconds (default: 300)
 *   --rpc         Soroban RPC endpoint URL (required)
 *   --json        Emit structured JSON log lines instead of human-readable output
 *
 * The daemon expects the channel state store and signer to be provided via
 * environment variables:
 *
 *   SYNCRO_STATE_STORE_PATH   Path to a JSON file acting as the state store.
 *                             Each key is a channel ID, the value is the latest
 *                             signed state object.
 *
 *   SYNCRO_SPENDING_KEY       Consumer's Ed25519 private key PEM, used to sign
 *                             dispute submissions.
 *
 * In production, replace the file-based store and key-from-env signer with
 * implementations backed by a database and a hardware security module.
 */

import { readFileSync, existsSync } from "node:fs";
import { createSign } from "node:crypto";
import {
  watchChannels,
  type ChannelStateStore,
  type DisputeSigner,
  type SignedChannelState,
  type ChannelInvocation,
  type ChannelTransport,
} from "../channels/index.js";

// ─── Argument parsing ─────────────────────────────────────────────────────────

interface CliArgs {
  contractId: string;
  caller: string;
  channelIds: bigint[];
  pollIntervalMs: number;
  alertThresholdSeconds: bigint;
  rpcUrl: string;
  json: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const map = new Map<string, string>();
  const flags = new Set<string>();

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === "--json") { flags.add("json"); continue; }
    if (arg.startsWith("--")) {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      map.set(arg.slice(2), value);
      i++;
    }
  }

  const contract  = map.get("contract");
  const caller    = map.get("caller");
  const channels  = map.get("channels");
  const rpc       = map.get("rpc");

  if (!contract) throw new Error("--contract is required");
  if (!caller)   throw new Error("--caller is required");
  if (!channels) throw new Error("--channels is required");
  if (!rpc)      throw new Error("--rpc is required");

  return {
    contractId:            contract,
    caller,
    channelIds:            channels.split(",").map((s) => BigInt(s.trim())),
    pollIntervalMs:        Number(map.get("poll") ?? "10000"),
    alertThresholdSeconds: BigInt(map.get("alert") ?? "300"),
    rpcUrl:                rpc,
    json:                  flags.has("json"),
  };
}

// ─── Logging ──────────────────────────────────────────────────────────────────

function makeLog(json: boolean) {
  return function log(level: "info" | "warn" | "error", msg: string, data?: object): void {
    const ts = new Date().toISOString();
    if (json) {
      process.stdout.write(JSON.stringify({ ts, level, msg, ...data }) + "\n");
    } else {
      const prefix = level === "error" ? "\x1b[31m[ERR]\x1b[0m"
                   : level === "warn"  ? "\x1b[33m[WRN]\x1b[0m"
                   :                    "\x1b[32m[INF]\x1b[0m";
      const suffix = data ? "  " + JSON.stringify(data) : "";
      console.log(`${ts} ${prefix} ${msg}${suffix}`);
    }
  };
}

// ─── File-backed state store ──────────────────────────────────────────────────

function makeFileStore(path: string): ChannelStateStore {
  function load(): Record<string, SignedChannelState> {
    if (!existsSync(path)) return {};
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Record<string, SignedChannelState>;
    } catch {
      return {};
    }
  }

  return {
    getLatest(channelId: bigint): SignedChannelState | null {
      const data = load();
      const entry = data[channelId.toString()];
      if (!entry) return null;
      // Deserialise bigint fields that JSON stores as strings
      return {
        ...entry,
        channelId: BigInt(entry.channelId),
        sequence:  BigInt(entry.sequence),
        balanceA:  BigInt(entry.balanceA),
        balanceB:  BigInt(entry.balanceB),
      };
    },
  };
}

// ─── Ed25519 signer ───────────────────────────────────────────────────────────

function makeEnvSigner(): DisputeSigner {
  const pem = process.env["SYNCRO_SPENDING_KEY"];
  if (!pem) throw new Error("SYNCRO_SPENDING_KEY environment variable is required");

  return {
    sign(state: SignedChannelState): string {
      // If the stored state already carries a valid signature, reuse it.
      if (state.signature) return state.signature;
      const payload = JSON.stringify({
        channelId: state.channelId.toString(),
        sequence:  state.sequence.toString(),
        balanceA:  state.balanceA.toString(),
        balanceB:  state.balanceB.toString(),
      });
      const s = createSign("SHA256");
      s.update(payload);
      return s.sign(pem, "hex");
    },
  };
}

// ─── Minimal RPC transport stub ───────────────────────────────────────────────
// In production this would be replaced by a full Soroban RPC transport that
// serialises XDR arguments and submits transactions. This stub is intentionally
// minimal so the CLI compiles without a Soroban SDK dependency.

function makeRpcTransport(rpcUrl: string, log: ReturnType<typeof makeLog>): ChannelTransport {
  return {
    async invoke(call: ChannelInvocation): Promise<unknown> {
      log("info", `Transport invoke: ${call.method}`, { channelId: String(call.args["channel_id"]) });
      // Real implementation: encode call.args as XDR, submit via Soroban RPC.
      throw new Error(
        `RPC transport invoke not implemented. ` +
        `Connect a real Soroban transport to ${rpcUrl} and implement XDR encoding.`,
      );
    },
    async read(call: ChannelInvocation): Promise<unknown> {
      log("info", `Transport read: ${call.method}`, { channelId: String(call.args["channel_id"]) });
      // Real implementation: simulateTransaction / getLedgerEntry.
      throw new Error(
        `RPC transport read not implemented. ` +
        `Connect a real Soroban transport to ${rpcUrl}.`,
      );
    },
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv);
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exit(1);
  }

  const log = makeLog(args.json);

  log("info", "Dispute watcher starting", {
    contractId: args.contractId,
    channels:   args.channelIds.map(String),
    pollMs:     args.pollIntervalMs,
    alertSecs:  String(args.alertThresholdSeconds),
  });

  const storePath = process.env["SYNCRO_STATE_STORE_PATH"] ?? "channel-states.json";
  const store     = makeFileStore(storePath);
  const signer    = makeEnvSigner();
  const transport = makeRpcTransport(args.rpcUrl, log);

  const handle = watchChannels({
    channelIds:            args.channelIds,
    contractId:            args.contractId,
    caller:                args.caller,
    store,
    signer,
    transport,
    pollIntervalMs:        args.pollIntervalMs,
    alertThresholdSeconds: args.alertThresholdSeconds,

    onDisputeSubmitted(ev) {
      log("warn", "Dispute submitted — stale close detected and countered", {
        channelId:    String(ev.channelId),
        staleAt:      String(ev.stalSequence),
        ourSequence:  String(ev.ourSequence),
      });
    },

    onDeadlineApproaching(ev) {
      log("warn", "Challenge window closing soon", {
        channelId:        String(ev.channelId),
        disputeDeadline:  String(ev.disputeDeadline),
        remainingSecs:    String(ev.remainingSeconds),
        alreadyDisputed:  ev.alreadyDisputed,
      });
    },

    onDisputeError(ev) {
      log("error", "Dispute submission failed", {
        channelId: String(ev.channelId),
        error:     String(ev.error),
      });
    },
  });

  async function shutdown(signal: string): Promise<void> {
    log("info", `Received ${signal}, shutting down…`);
    handle.stop();
    await handle.stopped;
    log("info", "Dispute watcher stopped cleanly");
    process.exit(0);
  }

  process.on("SIGINT",  () => { void shutdown("SIGINT"); });
  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });

  // Keep the process alive until stopped.
  await handle.stopped;
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${String(err)}\n`);
  process.exit(1);
});
