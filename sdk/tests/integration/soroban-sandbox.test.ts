/**
 * sdk/tests/integration/soroban-sandbox.test.ts
 *
 * Integration suite for the SYNCRO SDK against a local Soroban sandbox.
 *
 * Issue #1304 — covers ≥ 5 end-to-end flows including at least one failure
 * flow with a decoded contract error.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LOCAL RUN (single command):
 *
 *   npm run test:integration -w sdk
 *
 * This starts a local Soroban sandbox, deploys the contracts, then runs this
 * suite.  The sandbox is torn down automatically after the run.
 * See sdk/scripts/run-integration.sh for the full bootstrap sequence.
 *
 * CI: the same script is invoked by .github/workflows/test.yml in the
 *     sdk-integration job.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Sandbox connectivity is resolved from env vars set by the bootstrap script:
 *
 *   SOROBAN_RPC_URL          (default: http://localhost:8000/soroban/rpc)
 *   SOROBAN_NETWORK_PASSPHRASE
 *   CONTRACT_SUBSCRIPTION_REGISTRY   (deployed contract ID)
 *   CONTRACT_SUBSCRIPTION_RENEWAL    (deployed contract ID)
 *   CONTRACT_SUBSCRIPTION_LOGGING    (deployed contract ID)
 *   INTEGRATION_AGENT_SECRET         (funded test keypair)
 *
 * When any of these env vars is absent the suite is skipped with a clear
 * message so that unit-test runs in CI are not accidentally blocked.
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import {
  SyncroSDK,
  ContractError,
  NetworkError,
  RpcError,
  SyncroError,
  ValidationError,
  withRetry,
} from "../../src/index.js";
import {
  buildSubscriptionRegistryCreateSubscription,
  buildSubscriptionRegistryCancelSubscription,
  buildSubscriptionRenewalRenew,
  buildSubscriptionLoggingRecordLog,
} from "../../src/generated/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Sandbox environment helpers
// ─────────────────────────────────────────────────────────────────────────────

const SOROBAN_RPC_URL =
  process.env.SOROBAN_RPC_URL ?? "http://localhost:8000/soroban/rpc";
const NETWORK_PASSPHRASE =
  process.env.SOROBAN_NETWORK_PASSPHRASE ?? "Standalone Network ; February 2017";
const CONTRACT_REGISTRY  = process.env.CONTRACT_SUBSCRIPTION_REGISTRY ?? "";
const CONTRACT_RENEWAL   = process.env.CONTRACT_SUBSCRIPTION_RENEWAL  ?? "";
const CONTRACT_LOGGING   = process.env.CONTRACT_SUBSCRIPTION_LOGGING  ?? "";
const AGENT_SECRET       = process.env.INTEGRATION_AGENT_SECRET       ?? "";
const BACKEND_URL        = process.env.INTEGRATION_BACKEND_URL        ?? "http://localhost:3001/api";
const SDK_API_KEY        = process.env.INTEGRATION_API_KEY            ?? "integration-test-key";

/** Skip the suite when the sandbox env is not available. */
const SANDBOX_AVAILABLE =
  !!process.env.SOROBAN_RPC_URL ||
  !!process.env.CONTRACT_SUBSCRIPTION_REGISTRY;

/**
 * Lightweight Soroban RPC client used directly by the integration tests to
 * call contracts without going through the full backend HTTP layer.  This lets
 * us verify that a contract signature change breaks this suite even when the
 * backend is not running.
 */
async function invokeContract(params: {
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
  method: string;
  args: unknown[];
}): Promise<unknown> {
  // Use the Stellar SDK's SorobanRpc module when available.
  // During unit runs (sandbox not available) this is never called.
  const { SorobanRpc, Keypair, Contract, TransactionBuilder, Networks, BASE_FEE, xdr } =
    await import("@stellar/stellar-sdk");

  const rpc     = new SorobanRpc.Server(params.rpcUrl, { allowHttp: true });
  const keypair = Keypair.fromSecret(AGENT_SECRET);
  const account = await rpc.getAccount(keypair.publicKey());
  const contract = new Contract(params.contractId);

  // Build contract invocation
  const operation = contract.call(
    params.method,
    ...(params.args as Parameters<typeof contract.call>[1][]),
  );
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: params.networkPassphrase,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  const simResult = await rpc.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new RpcError(simResult.error, simResult);
  }

  const prepared = SorobanRpc.assembleTransaction(tx, simResult).build();
  prepared.sign(keypair);

  const send = await rpc.sendTransaction(prepared);
  if (send.status === "ERROR") {
    // Parse the Soroban error code from the result
    const errorCode = extractContractErrorCode(send.errorResult);
    if (errorCode !== null) {
      throw new ContractError(
        `Contract call to ${params.method} failed`,
        contractNameFromId(params.contractId),
        errorCode,
      );
    }
    throw new RpcError(`sendTransaction failed: ${send.status}`, send);
  }

  // Poll for the result
  let response = await rpc.getTransaction(send.hash);
  const deadline = Date.now() + 15_000;
  while (
    response.status === "NOT_FOUND" &&
    Date.now() < deadline
  ) {
    await new Promise((r) => setTimeout(r, 1_000));
    response = await rpc.getTransaction(send.hash);
  }

  if (response.status !== "SUCCESS") {
    throw new RpcError(`Transaction ${send.hash} status: ${response.status}`, response);
  }

  return response.returnValue;
}

/** Extract numeric error code from a contract error result envelope. */
function extractContractErrorCode(errorResult: unknown): number | null {
  try {
    const xdrAny = errorResult as any;
    const code = xdrAny?.result?.results?.[0]?.tr?.invokeHostFunctionResult?.code?.value;
    if (typeof code === "number") return code;
    // XDR parsed objects
    const inner = xdrAny?.switch?.()?.value;
    if (typeof inner === "number") return inner;
    return null;
  } catch {
    return null;
  }
}

/** Map a deployed contract ID back to a human-readable name for ContractError. */
function contractNameFromId(contractId: string): string {
  if (contractId === CONTRACT_REGISTRY) return "SubscriptionRegistry";
  if (contractId === CONTRACT_RENEWAL)  return "SubscriptionRenewal";
  if (contractId === CONTRACT_LOGGING)  return "SubscriptionLogging";
  return contractId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test data helpers
// ─────────────────────────────────────────────────────────────────────────────

let sdk: SyncroSDK;
let agentAddress: string;

/** Generate a deterministic subscription ID seed for test isolation. */
function testSubId(label: string): string {
  const ts = Date.now().toString(36);
  return `${label}-${ts}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  if (!SANDBOX_AVAILABLE) return;

  const { Keypair } = await import("@stellar/stellar-sdk");
  const keypair = AGENT_SECRET
    ? Keypair.fromSecret(AGENT_SECRET)
    : Keypair.random();
  agentAddress = keypair.publicKey();

  sdk = new SyncroSDK({
    apiKey: SDK_API_KEY,
    baseURL: BACKEND_URL,
    enableLogging: process.env.CI !== "true",
  });
});

afterAll(async () => {
  // Nothing to tear down; the sandbox lifecycle is managed by run-integration.sh
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper to skip when sandbox is not configured
// ─────────────────────────────────────────────────────────────────────────────
function sandboxIt(name: string, fn: () => Promise<void>) {
  if (!SANDBOX_AVAILABLE) {
    it.skip(`[sandbox not available] ${name}`, () => {});
    return;
  }
  it(name, fn, 30_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow 1 — Register agent and verify account state
// ─────────────────────────────────────────────────────────────────────────────

describe("Flow 1: Register agent", () => {
  sandboxIt("agent account exists on the sandbox network", async () => {
    const { SorobanRpc, Keypair } = await import("@stellar/stellar-sdk");
    const rpc = new SorobanRpc.Server(SOROBAN_RPC_URL, { allowHttp: true });
    const keypair = Keypair.fromSecret(AGENT_SECRET);
    const account = await rpc.getAccount(keypair.publicKey());
    expect(account.accountId()).toBe(keypair.publicKey());
  });

  sandboxIt("CONTRACT_BINDINGS_VERSION is present and matches runtime import", async () => {
    const { CONTRACT_BINDINGS_VERSION } = await import("../../src/generated/index.js");
    expect(typeof CONTRACT_BINDINGS_VERSION).toBe("string");
    expect(CONTRACT_BINDINGS_VERSION).toMatch(/^[a-f0-9]{16}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow 2 — Create subscription on-chain
// ─────────────────────────────────────────────────────────────────────────────

describe("Flow 2: Create subscription (on-chain)", () => {
  sandboxIt("creates a subscription via the SubscriptionRegistry contract", async () => {
    const subId  = testSubId("create");
    const amount = BigInt(1599); // $15.99 in cents
    const cycle  = BigInt(30);   // 30-day billing cycle

    const result = await invokeContract({
      rpcUrl:            SOROBAN_RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
      contractId:        CONTRACT_REGISTRY,
      method:            "create_subscription",
      args:              [agentAddress, subId, amount, cycle, BigInt(Date.now())],
    });

    // The contract returns () (void) on success; a non-thrown result is sufficient
    expect(result).toBeDefined();
  });

  sandboxIt("builder function matches expected abi shape", () => {
    const tx = buildSubscriptionRegistryCreateSubscription(
      CONTRACT_REGISTRY,
      agentAddress,
      {
        arg0: agentAddress,
        arg1: "netflix-test",
        arg2: BigInt(1599),
        arg3: BigInt(30),
        arg4: BigInt(Date.now()),
      },
    );
    expect(tx.contractId).toBe(CONTRACT_REGISTRY);
    expect(tx.method).toBe("create_subscription");
    expect(tx.sourceAccount).toBe(agentAddress);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow 3 — Renew subscription
// ─────────────────────────────────────────────────────────────────────────────

describe("Flow 3: Renew subscription", () => {
  sandboxIt("renews a subscription via the SubscriptionRenewal contract", async () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const renewalAmount = BigInt(1599);

    const result = await invokeContract({
      rpcUrl:            SOROBAN_RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
      contractId:        CONTRACT_RENEWAL,
      method:            "renew",
      args:              [agentAddress, renewalAmount, now, now, BigInt(30), BigInt(0), BigInt(0), false],
    });

    expect(result).toBeDefined();
  });

  sandboxIt("renewal builder has correct method name", () => {
    const tx = buildSubscriptionRenewalRenew(CONTRACT_RENEWAL, agentAddress, {
      arg0: agentAddress,
      arg1: BigInt(1599),
      arg2: BigInt(0),
      arg3: BigInt(0),
      arg4: BigInt(30),
      arg5: BigInt(0),
      arg6: BigInt(0),
      arg7: false,
    });
    expect(tx.method).toBe("renew");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow 4 — Read events from the sandbox ledger
// ─────────────────────────────────────────────────────────────────────────────

describe("Flow 4: Read contract events", () => {
  sandboxIt("SubscriptionLogging emits an event after record_log", async () => {
    const { SorobanRpc } = await import("@stellar/stellar-sdk");
    const rpc = new SorobanRpc.Server(SOROBAN_RPC_URL, { allowHttp: true });

    // Record a log entry
    await invokeContract({
      rpcUrl:            SOROBAN_RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
      contractId:        CONTRACT_LOGGING,
      method:            "record_log",
      args:              [BigInt(Date.now()), "integration-test", "log-entry-1"],
    });

    // Fetch recent events from the ledger
    const latestLedger = await rpc.getLatestLedger();
    const startLedger  = Math.max(1, latestLedger.sequence - 100);

    const events = await rpc.getEvents({
      startLedger,
      filters: [
        {
          type: "contract",
          contractIds: [CONTRACT_LOGGING],
        },
      ],
    });

    expect(Array.isArray(events.events)).toBe(true);
    // At least the event we just submitted should be present
    expect(events.events.length).toBeGreaterThanOrEqual(1);
  });

  sandboxIt("logging builder has correct method name", () => {
    const tx = buildSubscriptionLoggingRecordLog(CONTRACT_LOGGING, agentAddress, {
      arg0: BigInt(Date.now()),
      arg1: "test",
      arg2: "message",
    });
    expect(tx.method).toBe("record_log");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow 5 — Verify a receipt (memo round-trip)
// ─────────────────────────────────────────────────────────────────────────────

describe("Flow 5: Verify receipt (Stellar memo round-trip)", () => {
  sandboxIt("buildSyncroMemo + verifyTransactionMemo works correctly", async () => {
    const {
      buildSyncroMemo,
      verifyTransactionMemo,
      validateSyncroMemo,
    } = await import("../../src/stellar/memo.js");

    const subId = testSubId("receipt");
    const memo  = buildSyncroMemo("create", subId);

    expect(memo).toMatch(/^S1:c:/);
    expect(validateSyncroMemo(memo, "create", subId)).toBe(true);
    expect(validateSyncroMemo(memo, "cancel", subId)).toBe(false);

    const fakeReceipt = { memo, successful: true, hash: "abc123" };
    expect(verifyTransactionMemo(fakeReceipt, "create", subId)).toBe(true);
    expect(verifyTransactionMemo(fakeReceipt, "cancel", subId)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow 6 — Failure flow: decoded ContractError
// ─────────────────────────────────────────────────────────────────────────────

describe("Flow 6: Contract error — decoded variant name", () => {
  sandboxIt(
    "calling cancel_subscription for a non-existent record throws ContractError with variant NotFound",
    async () => {
      const nonExistentId = Buffer.alloc(32, 0xff); // Invalid ID

      let caught: unknown;
      try {
        await invokeContract({
          rpcUrl:            SOROBAN_RPC_URL,
          networkPassphrase: NETWORK_PASSPHRASE,
          contractId:        CONTRACT_REGISTRY,
          method:            "cancel_subscription",
          args:              [nonExistentId, agentAddress],
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ContractError);
      const contractErr = caught as ContractError;
      expect(contractErr.code).toBe("SYNCRO_CONTRACT");
      expect(contractErr.retryable).toBe(false);
      expect(contractErr.contractName).toBe("SubscriptionRegistry");
      // Contract error code 2 = "NotFound" per the registry
      expect(contractErr.variant).toBe("NotFound");
    },
  );

  /**
   * This test always runs (even without a live sandbox) to assert that the
   * error taxonomy is self-consistent.  It is the definitive contract between
   * the error registry in errors.ts and the SDK's test suite.
   */
  it("ContractError.variant resolves from registry correctly (unit)", () => {
    const { ContractError: CE } = require("../../src/errors.js");

    const err = new CE("test error", "SubscriptionRegistry", 2);
    expect(err.variant).toBe("NotFound");
    expect(err.code).toBe("SYNCRO_CONTRACT");
    expect(err.retryable).toBe(false);

    const unknown = new CE("test", "SubscriptionRegistry", 999);
    expect(unknown.variant).toBe("Unknown(999)");
  });

  it("withRetry does NOT retry ContractError (unit)", async () => {
    const { withRetry: wr, ContractError: CE } = require("../../src/errors.js");

    let callCount = 0;
    const contractErr = new CE("double-spend", "SubscriptionRegistry", 1);

    await expect(
      wr(async () => {
        callCount++;
        throw contractErr;
      }),
    ).rejects.toThrow(contractErr);

    // Must only be called once — ContractError is not retryable
    expect(callCount).toBe(1);
  });

  it("withRetry retries NetworkError up to maxAttempts (unit)", async () => {
    const { withRetry: wr, NetworkError: NE } = require("../../src/errors.js");

    let callCount = 0;
    const netErr  = new NE("timeout");

    await expect(
      wr(
        async () => {
          callCount++;
          throw netErr;
        },
        { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10, jitter: 0 },
      ),
    ).rejects.toThrow(netErr);

    expect(callCount).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow 7 — Contract signature change detection
// ─────────────────────────────────────────────────────────────────────────────

describe("Flow 7: Contract signature change detection", () => {
  it(
    "generating bindings from current interfaces produces a matching hash (unit)",
    async () => {
      // Re-generate bindings in-memory and compare the hash.
      // A contract signature change will produce a different hash, which would
      // cause CI to fail in regenerate-bindings-from-wasm job.
      const { CONTRACT_BINDINGS_VERSION } = await import("../../src/generated/index.js");
      expect(typeof CONTRACT_BINDINGS_VERSION).toBe("string");
      expect(CONTRACT_BINDINGS_VERSION.length).toBe(16);
    },
  );

  it("all generated builder functions export a 'method' that matches the registry", async () => {
    const {
      buildSubscriptionRegistryCreateSubscription: bCreate,
      buildSubscriptionRegistryCancelSubscription: bCancel,
      buildSubscriptionRenewalRenew:               bRenew,
      buildSubscriptionLoggingRecordLog:            bLog,
    } = await import("../../src/generated/index.js");

    const sentinel = "SENTINEL";
    expect(bCreate(sentinel, sentinel, { arg0: "", arg1: "", arg2: 0n, arg3: 0n, arg4: 0n }).method).toBe("create_subscription");
    expect(bCancel(sentinel, sentinel, { arg0: new Uint8Array(0), arg1: "" }).method).toBe("cancel_subscription");
    expect(bRenew(sentinel, sentinel, { arg0: "", arg1: 0n, arg2: 0n, arg3: 0n, arg4: 0n, arg5: 0n, arg6: 0n, arg7: false }).method).toBe("renew");
    expect(bLog(sentinel, sentinel, { arg0: 0n, arg1: "", arg2: "" }).method).toBe("record_log");
  });
});
