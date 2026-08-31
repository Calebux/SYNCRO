/**
 * Gas Predictor – Stellar/Soroban fee estimation service.
 *
 * Fetches live fee stats from the Stellar RPC endpoint and estimates
 * transaction costs. Alerts users when network congestion makes a tx
 * prohibitively expensive.
 *
 * Usage:
 *   const estimate = await gasPredictor.estimateSorobanTx({
 *     instructions: 1_000_000,
 *     readBytes: 200,
 *     writeBytes: 50,
 *   });
 *   if (estimate.congestion === 'high') { …warn user… }
 */

import { RpcClient } from '../../shared/src/rpc-client';

export type CongestionLevel = "low" | "medium" | "high" | "severe";

export interface FeeStats {
  lastLedger: number;
  lastLedgerBaseFee: string; // stroops
  ledgerCapacityUsage: number; // 0.0 – 1.0
  feeCharged: {
    max: string;
    min: string;
    mode: string;
    p10: string;
    p50: string;
    p80: string;
    p90: string;
    p95: string;
    p99: string;
  };
  maxFee: {
    max: string;
    min: string;
    mode: string;
    p10: string;
    p50: string;
    p80: string;
    p90: string;
    p95: string;
    p99: string;
  };
}

export interface SorobanResourceEstimate {
  /** Estimated CPU instructions (default 1_000_000) */
  instructions?: number;
  /** Estimated ledger read bytes (default 200) */
  readBytes?: number;
  /** Estimated ledger write bytes (default 50) */
  writeBytes?: number;
  /** Estimated read ledger entries (default 5) */
  readEntries?: number;
  /** Estimated write ledger entries (default 2) */
  writeEntries?: number;
  /** Transaction size in bytes (default 300) */
  txSizeBytes?: number;
}

export interface GasEstimate {
  /** Total estimated fee in XLM (e.g. 0.05) */
  totalXlm: number;
  /** Base network fee component in XLM */
  baseFeeXlm: number;
  /** Soroban resource fee component in XLM */
  resourceFeeXlm: number;
  /** Congestion level derived from ledger capacity usage */
  congestion: CongestionLevel;
  /** Human-readable warning message (empty when congestion is low) */
  warning: string;
  /** Raw fee stats from the network */
  stats: FeeStats;
  /** Whether the estimate exceeds the user-defined threshold */
  exceedsThreshold: boolean;
}

const STROOPS_PER_XLM = 10_000_000;

/** Default RPC endpoints by network. */
const RPC_ENDPOINTS: Record<string, string> = {
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://soroban-rpc.creit.tech", // public community RPC
  futurenet: "https://rpc-futurenet.stellar.org",
};

/** Resource costs in stroops (approximate, based on current network config). */
const RESOURCE_UNIT_COSTS = {
  instructions: 0.000_001, // per instruction
  readByte: 0.000_5, // per byte read
  writeByte: 0.001, // per byte written
  readEntry: 0.01, // per entry read
  writeEntry: 0.05, // per entry written
  txByte: 0.000_1, // per tx byte
};

class GasPredictorService {
  private cache: { stats: FeeStats; fetchedAt: number } | null = null;
  private readonly CACHE_TTL_MS = 15_000; // 15 seconds
  private thresholdXlm = 0.5; // default alert threshold
  private rpcClient: RpcClient;

  constructor() {
    this.rpcClient = new RpcClient({
      maxRetries: 3,
      baseRetryDelayMs: 500,
      timeoutMs: 10000,
      circuitBreakerThreshold: 3,
      circuitBreakerResetTimeoutMs: 15000,
    });
  }

  /** Set the alert threshold in XLM. */
  setThreshold(xlm: number): void {
    this.thresholdXlm = Math.max(0, xlm);
  }

  getThreshold(): number {
    return this.thresholdXlm;
  }

  private getRpcUrl(): string {
    const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? '';
    const isProduction = process.env.NODE_ENV === 'production';

    // In production, NEXT_PUBLIC_SOROBAN_RPC_URL must be explicitly set.
    // We never silently fall back to the testnet RPC in a production build.
    if (isProduction && !process.env.NEXT_PUBLIC_SOROBAN_RPC_URL) {
      throw new Error(
        '[gas-predictor] NEXT_PUBLIC_SOROBAN_RPC_URL must be set in production. ' +
          'Refusing to fall back to the testnet RPC endpoint.',
      );
    }

    return (
      process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ??
      RPC_ENDPOINTS[network] ??
      RPC_ENDPOINTS.testnet
    );
  }

  /**
   * Fetch live fee stats from the Stellar RPC.
   * Uses a short-lived in-memory cache to avoid hammering the endpoint.
   */
  async fetchFeeStats(): Promise<FeeStats> {
    const now = Date.now();
    if (this.cache && now - this.cache.fetchedAt < this.CACHE_TTL_MS) {
      return this.cache.stats;
    }

    const rpcUrl = this.getRpcUrl();

    const response = await this.rpcClient.fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getFeeStats",
        params: [],
      }),
    });

    if (!response.ok) {
      throw new Error(`RPC error: ${response.status} ${response.statusText}`);
    }

    const json = await response.json();
    if (json.error) {
      throw new Error(`RPC error: ${json.error.message}`);
    }

    const result = json.result;
    const stats: FeeStats = {
      lastLedger: result.last_ledger,
      lastLedgerBaseFee: result.last_ledger_base_fee,
      ledgerCapacityUsage: result.ledger_capacity_usage,
      feeCharged: {
        max: result.fee_charged.max,
        min: result.fee_charged.min,
        mode: result.fee_charged.mode,
        p10: result.fee_charged.p10,
        p50: result.fee_charged.p50,
        p80: result.fee_charged.p80,
        p90: result.fee_charged.p90,
        p95: result.fee_charged.p95,
        p99: result.fee_charged.p99,
      },
      maxFee: {
        max: result.max_fee.max,
        min: result.max_fee.min,
        mode: result.max_fee.mode,
        p10: result.max_fee.p10,
        p50: result.max_fee.p50,
        p80: result.max_fee.p80,
        p90: result.max_fee.p90,
        p95: result.max_fee.p95,
        p99: result.max_fee.p99,
      },
    };

    this.cache = { stats, fetchedAt: now };
    return stats;
  }

  /**
   * Derive congestion level from ledger capacity usage.
   */
  private getCongestion(capacityUsage: number): CongestionLevel {
    if (capacityUsage >= 0.95) return "severe";
    if (capacityUsage >= 0.8) return "high";
    if (capacityUsage >= 0.5) return "medium";
    return "low";
  }

  /**
   * Build a human-readable warning based on congestion and cost.
   */
  private buildWarning(
    congestion: CongestionLevel,
    totalXlm: number,
    exceedsThreshold: boolean,
  ): string {
    if (congestion === "low" && !exceedsThreshold) return "";

    const parts: string[] = [];
    if (congestion === "high") {
      parts.push("Network congestion is high. Fees are elevated.");
    } else if (congestion === "severe") {
      parts.push(
        "Network is severely congested. Consider waiting for fees to drop.",
      );
    }
    if (exceedsThreshold) {
      parts.push(
        `Estimated cost (${totalXlm.toFixed(4)} XLM) exceeds your alert threshold (${this.thresholdXlm.toFixed(4)} XLM).`,
      );
    }
    return parts.join(" ");
  }

  /**
   * Estimate the cost of a Soroban smart-contract transaction.
   *
   * @param resources – Approximate resource consumption of the tx.
   * @returns A `GasEstimate` with total cost, congestion level, and warning.
   */
  async estimateSorobanTx(
    resources: SorobanResourceEstimate = {},
  ): Promise<GasEstimate> {
    const stats = await this.fetchFeeStats();

    const {
      instructions = 1_000_000,
      readBytes = 200,
      writeBytes = 50,
      readEntries = 5,
      writeEntries = 2,
      txSizeBytes = 300,
    } = resources;

    // Base fee (network minimum, adjusted for congestion)
    const baseFeeStroops = parseInt(stats.lastLedgerBaseFee, 10) || 100;
    const congestionMultiplier =
      stats.ledgerCapacityUsage >= 0.9
        ? 4
        : stats.ledgerCapacityUsage >= 0.75
          ? 2.5
          : stats.ledgerCapacityUsage >= 0.5
            ? 1.5
            : 1;

    const adjustedBaseFee = Math.round(baseFeeStroops * congestionMultiplier);

    // Resource fee (approximate Soroban resource pricing)
    const resourceFeeStroops = Math.round(
      instructions * RESOURCE_UNIT_COSTS.instructions +
        readBytes * RESOURCE_UNIT_COSTS.readByte +
        writeBytes * RESOURCE_UNIT_COSTS.writeByte +
        readEntries * RESOURCE_UNIT_COSTS.readEntry +
        writeEntries * RESOURCE_UNIT_COSTS.writeEntry +
        txSizeBytes * RESOURCE_UNIT_COSTS.txByte,
    );

    const totalStroops = adjustedBaseFee + resourceFeeStroops;
    const baseFeeXlm = adjustedBaseFee / STROOPS_PER_XLM;
    const resourceFeeXlm = resourceFeeStroops / STROOPS_PER_XLM;
    const totalXlm = totalStroops / STROOPS_PER_XLM;

    const congestion = this.getCongestion(stats.ledgerCapacityUsage);
    const exceedsThreshold = totalXlm > this.thresholdXlm;
    const warning = this.buildWarning(congestion, totalXlm, exceedsThreshold);

    return {
      totalXlm,
      baseFeeXlm,
      resourceFeeXlm,
      congestion,
      warning,
      stats,
      exceedsThreshold,
    };
  }

  /**
   * Estimate a simple Stellar payment transaction (no smart contract).
   * Much cheaper than Soroban txs.
   */
  async estimatePaymentTx(): Promise<GasEstimate> {
    const stats = await this.fetchFeeStats();

    const baseFeeStroops = parseInt(stats.lastLedgerBaseFee, 10) || 100;
    const congestionMultiplier =
      stats.ledgerCapacityUsage >= 0.9
        ? 3
        : stats.ledgerCapacityUsage >= 0.75
          ? 2
          : stats.ledgerCapacityUsage >= 0.5
            ? 1.2
            : 1;

    const totalStroops = Math.round(baseFeeStroops * congestionMultiplier);
    const totalXlm = totalStroops / STROOPS_PER_XLM;
    const congestion = this.getCongestion(stats.ledgerCapacityUsage);
    const exceedsThreshold = totalXlm > this.thresholdXlm;
    const warning = this.buildWarning(congestion, totalXlm, exceedsThreshold);

    return {
      totalXlm,
      baseFeeXlm: totalXlm,
      resourceFeeXlm: 0,
      congestion,
      warning,
      stats,
      exceedsThreshold,
    };
  }
}

export const gasPredictor = new GasPredictorService();
