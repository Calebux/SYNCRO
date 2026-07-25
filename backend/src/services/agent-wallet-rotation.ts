/**
 * agent-wallet-rotation.ts
 *
 * Manages the rotation lifecycle for pipeline agent wallets.
 *
 * Implements Issue #862 — Privacy: Implement address rotation for agent wallets.
 *
 * Responsibilities:
 *  1. Read / write rotation state from `agent_wallet_rotations` table.
 *  2. Decide whether a rotation is due based on AGENT_ROTATION_SCHEDULE.
 *  3. Drain funds from the old address to the new address on Stellar testnet/mainnet.
 *  4. Commit the new address index to the database after successful drain.
 *  5. Expose the current active keypair for each agent so the rest of the
 *     system can call it without knowing the index.
 *
 * Rotation schedules supported:
 *   - "per-task"  — new address every time getActiveKeypair() is called
 *   - "daily"     — rotate once per calendar day (UTC)
 *   - "weekly"    — rotate once per calendar week (ISO week, UTC)
 *   - "manual"    — never auto-rotate; only via explicit triggerRotation()
 *
 * The schedule is read from AGENT_ROTATION_SCHEDULE env var (default: "daily").
 */

import {
  Keypair,
  Networks,
  TransactionBuilder,
  Operation,
  Asset,
  Memo,
} from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';
import { supabase } from '../config/database';
import logger from '../config/logger';
import {
  AgentHDWallet,
  AgentName,
  AGENT_NAMES,
  DerivedKeypair,
} from './agent-hd-wallet';
import { getBlockchainFlags, resolveStellarNetwork } from '../../../shared/blockchain-flags';

// ─── Types ────────────────────────────────────────────────────────────────────

export type RotationSchedule = 'per-task' | 'daily' | 'weekly' | 'manual';

export interface AgentRotationState {
  agentName:       AgentName;
  currentIndex:    number;
  publicKey:       string;
  lastRotatedAt:   string | null;
  rotationCount:   number;
  schedule:        RotationSchedule;
}

export interface RotationResult {
  agentName:        AgentName;
  previousIndex:    number;
  previousPublicKey: string;
  newIndex:         number;
  newPublicKey:     string;
  drainTxHash:      string | null;
  rotatedAt:        string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveSchedule(): RotationSchedule {
  const raw = (process.env.AGENT_ROTATION_SCHEDULE ?? 'daily').toLowerCase();
  if (['per-task', 'daily', 'weekly', 'manual'].includes(raw)) {
    return raw as RotationSchedule;
  }
  logger.warn(
    `[AgentWalletRotation] Unknown AGENT_ROTATION_SCHEDULE="${raw}", defaulting to "daily".`,
  );
  return 'daily';
}

function isRotationDue(lastRotatedAt: string | null, schedule: RotationSchedule): boolean {
  if (schedule === 'per-task') return true;
  if (schedule === 'manual')   return false;
  if (!lastRotatedAt)          return true; // never rotated → rotate now

  const last = new Date(lastRotatedAt);
  const now  = new Date();

  if (schedule === 'daily') {
    // Due if last rotation was on a different UTC calendar day
    return (
      last.getUTCFullYear() !== now.getUTCFullYear() ||
      last.getUTCMonth()    !== now.getUTCMonth()    ||
      last.getUTCDate()     !== now.getUTCDate()
    );
  }

  if (schedule === 'weekly') {
    // Due if last rotation was in a different ISO week
    const getISOWeek = (d: Date): number => {
      const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
      const dayOfWeek = jan4.getUTCDay() || 7;
      const weekStart = new Date(jan4);
      weekStart.setUTCDate(jan4.getUTCDate() - (dayOfWeek - 1));
      const diff = d.getTime() - weekStart.getTime();
      return Math.floor(diff / (7 * 24 * 3600 * 1000)) + 1;
    };
    return (
      last.getUTCFullYear() !== now.getUTCFullYear() ||
      getISOWeek(last) !== getISOWeek(now)
    );
  }

  return false;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class AgentWalletRotationService {
  private readonly schedule: RotationSchedule;

  /** In-memory cache of active keypairs (avoids re-deriving on every call for non-per-task modes). */
  private activeKeypairCache: Map<AgentName, DerivedKeypair> = new Map();

  constructor() {
    this.schedule = resolveSchedule();
    logger.info(`[AgentWalletRotation] Rotation schedule: ${this.schedule}`);
  }

  // ── Database helpers ────────────────────────────────────────────────────────

  /**
   * Loads the current rotation state for all agents from the DB.
   * Inserts a genesis row (index 0) if a row doesn't exist yet.
   */
  async loadAllStates(): Promise<AgentRotationState[]> {
    const { data, error } = await supabase
      .from('agent_wallet_rotations')
      .select('*')
      .in('agent_name', AGENT_NAMES);

    if (error) {
      throw new Error(`[AgentWalletRotation] Failed to load rotation states: ${error.message}`);
    }

    const existingByName = new Map(
      (data ?? []).map((row: any) => [row.agent_name as AgentName, row]),
    );

    const states: AgentRotationState[] = [];

    for (const agentName of AGENT_NAMES) {
      if (existingByName.has(agentName)) {
        const row = existingByName.get(agentName)!;
        states.push({
          agentName:     agentName,
          currentIndex:  row.current_index,
          publicKey:     row.public_key,
          lastRotatedAt: row.last_rotated_at,
          rotationCount: row.rotation_count,
          schedule:      this.schedule,
        });
      } else {
        // Bootstrap: derive genesis keypair and insert row
        const genesis = await AgentHDWallet.deriveKeypair(agentName, 0);
        const { error: insertErr } = await supabase
          .from('agent_wallet_rotations')
          .insert({
            agent_name:     agentName,
            current_index:  0,
            public_key:     genesis.publicKey,
            last_rotated_at: null,
            rotation_count: 0,
          });

        if (insertErr) {
          throw new Error(
            `[AgentWalletRotation] Failed to bootstrap agent "${agentName}": ${insertErr.message}`,
          );
        }

        // Record genesis address in history
        await this.recordHistory(agentName, 0, genesis.publicKey, null, 'genesis');

        states.push({
          agentName,
          currentIndex:  0,
          publicKey:     genesis.publicKey,
          lastRotatedAt: null,
          rotationCount: 0,
          schedule:      this.schedule,
        });

        logger.info(`[AgentWalletRotation] Bootstrapped genesis address for agent "${agentName}"`, {
          publicKey: genesis.publicKey,
        });
      }
    }

    return states;
  }

  private async loadState(agentName: AgentName): Promise<AgentRotationState | null> {
    const { data, error } = await supabase
      .from('agent_wallet_rotations')
      .select('*')
      .eq('agent_name', agentName)
      .single();

    if (error && error.code === 'PGRST116') return null; // not found
    if (error) throw new Error(`[AgentWalletRotation] DB error: ${error.message}`);

    return {
      agentName,
      currentIndex:  data.current_index,
      publicKey:     data.public_key,
      lastRotatedAt: data.last_rotated_at,
      rotationCount: data.rotation_count,
      schedule:      this.schedule,
    };
  }

  private async updateState(
    agentName: AgentName,
    newIndex: number,
    newPublicKey: string,
    now: string,
    rotationCount: number,
  ): Promise<void> {
    const { error } = await supabase
      .from('agent_wallet_rotations')
      .update({
        current_index:   newIndex,
        public_key:      newPublicKey,
        last_rotated_at: now,
        rotation_count:  rotationCount,
        updated_at:      now,
      })
      .eq('agent_name', agentName);

    if (error) {
      throw new Error(
        `[AgentWalletRotation] Failed to update state for agent "${agentName}": ${error.message}`,
      );
    }
  }

  private async recordHistory(
    agentName: AgentName,
    addressIndex: number,
    publicKey: string,
    drainTxHash: string | null,
    reason: string,
  ): Promise<void> {
    const { error } = await supabase.from('agent_wallet_history').insert({
      agent_name:    agentName,
      address_index: addressIndex,
      public_key:    publicKey,
      drain_tx_hash: drainTxHash,
      reason,
      recorded_at:   new Date().toISOString(),
    });

    if (error) {
      // Non-fatal — log and continue
      logger.warn('[AgentWalletRotation] Failed to record address history', {
        agentName,
        addressIndex,
        error: error.message,
      });
    }
  }

  // ── Drain logic ─────────────────────────────────────────────────────────────

  /**
   * Drains all native XLM from `fromKeypair` to `toPublicKey`.
   *
   * The operation leaves the minimum reserve (1 XLM = 10_000_000 stroops)
   * plus transaction fee in the source account so the account stays alive
   * if it has no sub-entries (base reserve = 1 XLM on testnet/mainnet).
   *
   * Returns the transaction hash, or null if:
   *  - ENABLE_BLOCKCHAIN is false
   *  - The source account balance is at or below the reserve + fee
   *  - The source account doesn't exist on chain yet (fresh genesis)
   */
  private async drainAddress(
    fromKeypair: Keypair,
    toPublicKey: string,
  ): Promise<string | null> {
    const flags = getBlockchainFlags();
    if (!flags.blockchainEnabled) {
      logger.info('[AgentWalletRotation] Blockchain disabled — skipping drain');
      return null;
    }

    const rpcUrl = process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org';
    const network = resolveStellarNetwork();
    const passphrase =
      process.env.STELLAR_NETWORK_PASSPHRASE ??
      (network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET);

    try {
      const rpc = new SorobanRpc.Server(rpcUrl);
      let account: Awaited<ReturnType<typeof rpc.getAccount>>;

      try {
        account = await rpc.getAccount(fromKeypair.publicKey());
      } catch {
        // Account does not exist on chain (never funded) — nothing to drain
        logger.info('[AgentWalletRotation] Source account not found on chain — skipping drain', {
          fromPublicKey: fromKeypair.publicKey(),
        });
        return null;
      }

      // Fetch current balance from Horizon-like account data
      const balanceEntry = (account as any).balances?.find(
        (b: any) => b.asset_type === 'native',
      );
      const balanceStr: string = balanceEntry?.balance ?? '0';
      const balanceLumens = parseFloat(balanceStr);

      // Minimum: 1 XLM base reserve + 0.00001 XLM fee
      const FEE_LUMENS       = 0.00001;
      const RESERVE_LUMENS   = 1.0;
      const MIN_LUMENS       = RESERVE_LUMENS + FEE_LUMENS;

      if (balanceLumens <= MIN_LUMENS) {
        logger.info('[AgentWalletRotation] Insufficient balance to drain', {
          fromPublicKey: fromKeypair.publicKey(),
          balanceLumens,
        });
        return null;
      }

      const sendLumens = balanceLumens - MIN_LUMENS;
      // Convert to stroops string (Stellar uses integer stroops; 1 XLM = 10_000_000 stroops)
      const sendAmount = sendLumens.toFixed(7);

      const tx = new TransactionBuilder(account, {
        fee:              '100',
        networkPassphrase: passphrase,
      })
        .addOperation(
          Operation.payment({
            destination: toPublicKey,
            asset:       Asset.native(),
            amount:      sendAmount,
          }),
        )
        .addMemo(Memo.text('agent-wallet-rotation'))
        .setTimeout(30)
        .build();

      tx.sign(fromKeypair);

      const result = await rpc.sendTransaction(tx);
      if (result.status === 'ERROR') {
        throw new Error(`Drain tx failed: ${result.errorResult}`);
      }

      logger.info('[AgentWalletRotation] Drain transaction submitted', {
        fromPublicKey: fromKeypair.publicKey(),
        toPublicKey,
        sendAmount,
        txHash: result.hash,
      });

      return result.hash;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('[AgentWalletRotation] Drain failed (non-fatal — rotation continues)', {
        fromPublicKey: fromKeypair.publicKey(),
        error: msg,
      });
      // Non-fatal: we record a null drain hash and continue the rotation
      return null;
    }
  }

  // ── Core rotation logic ─────────────────────────────────────────────────────

  /**
   * Rotates a single agent to the next address index.
   * Returns null if no rotation is due (based on schedule) and `force` is false.
   */
  async triggerRotation(
    agentName: AgentName,
    force = false,
  ): Promise<RotationResult | null> {
    let state = await this.loadState(agentName);

    if (!state) {
      // Bootstrap if no row exists
      await this.loadAllStates();
      state = await this.loadState(agentName);
      if (!state) {
        throw new Error(`[AgentWalletRotation] Could not bootstrap agent "${agentName}"`);
      }
    }

    if (!force && !isRotationDue(state.lastRotatedAt, this.schedule)) {
      logger.debug('[AgentWalletRotation] Rotation not due', { agentName, schedule: this.schedule });
      return null;
    }

    const previousIndex    = state.currentIndex;
    const previousPubKey   = state.publicKey;
    const newIndex         = previousIndex + 1;
    const newRotationCount = state.rotationCount + 1;

    logger.info('[AgentWalletRotation] Rotating agent wallet', {
      agentName,
      previousIndex,
      newIndex,
    });

    const [previousDerived, newDerived] = await Promise.all([
      AgentHDWallet.deriveKeypair(agentName, previousIndex),
      AgentHDWallet.deriveKeypair(agentName, newIndex),
    ]);

    // Drain old address → new address
    const drainTxHash = await this.drainAddress(
      previousDerived.keypair,
      newDerived.publicKey,
    );

    const rotatedAt = new Date().toISOString();

    // Persist new state (rotation_count incremented atomically in same query)
    await this.updateState(agentName, newIndex, newDerived.publicKey, rotatedAt, newRotationCount);

    // Record address history
    await this.recordHistory(
      agentName,
      newIndex,
      newDerived.publicKey,
      drainTxHash,
      this.schedule,
    );

    // Invalidate in-memory cache
    this.activeKeypairCache.delete(agentName);

    const result: RotationResult = {
      agentName,
      previousIndex,
      previousPublicKey: previousPubKey,
      newIndex,
      newPublicKey: newDerived.publicKey,
      drainTxHash,
      rotatedAt,
    };

    logger.info('[AgentWalletRotation] Rotation complete', {
      agentName,
      previousPublicKey: previousPubKey,
      newPublicKey: newDerived.publicKey,
      drainTxHash,
    });

    return result;
  }

  /**
   * Rotates all agents in parallel.
   * Failures for individual agents are logged but don't abort others.
   */
  async rotateAll(force = false): Promise<RotationResult[]> {
    const results = await Promise.allSettled(
      AGENT_NAMES.map((name) => this.triggerRotation(name, force)),
    );

    const successful: RotationResult[] = [];
    for (const [i, result] of results.entries()) {
      if (result.status === 'fulfilled' && result.value) {
        successful.push(result.value);
      } else if (result.status === 'rejected') {
        logger.error('[AgentWalletRotation] Rotation failed for agent', {
          agentName: AGENT_NAMES[i],
          error: result.reason?.message ?? String(result.reason),
        });
      }
    }

    return successful;
  }

  // ── Active keypair accessor ─────────────────────────────────────────────────

  /**
   * Returns the active keypair for the given agent, rotating first if due.
   *
   * This is the primary method callers (blockchain-service, etc.) should use
   * instead of reading SCOUT_SECRET_KEY / LEDGER_SECRET_KEY directly.
   */
  async getActiveKeypair(agentName: AgentName): Promise<DerivedKeypair> {
    // per-task: always rotate before use (never cache)
    if (this.schedule === 'per-task') {
      await this.triggerRotation(agentName);
      const state = await this.loadState(agentName);
      if (!state) throw new Error(`[AgentWalletRotation] No state for agent "${agentName}"`);
      return AgentHDWallet.deriveKeypair(agentName, state.currentIndex);
    }

    // Check if rotation is due and update cache
    const cached = this.activeKeypairCache.get(agentName);
    const state  = await this.loadState(agentName);

    if (!state) {
      await this.loadAllStates();
      return this.getActiveKeypair(agentName); // retry after bootstrap
    }

    // Rotate if due
    if (isRotationDue(state.lastRotatedAt, this.schedule)) {
      const result = await this.triggerRotation(agentName);
      const fresh = await AgentHDWallet.deriveKeypair(agentName, result!.newIndex);
      this.activeKeypairCache.set(agentName, fresh);
      return fresh;
    }

    // Serve from cache if available
    if (cached && cached.addressIndex === state.currentIndex) {
      return cached;
    }

    // Derive and cache
    const derived = await AgentHDWallet.deriveKeypair(agentName, state.currentIndex);
    this.activeKeypairCache.set(agentName, derived);
    return derived;
  }

  /**
   * Returns the rotation history for a given agent (most recent first).
   */
  async getHistory(agentName: AgentName, limit = 50) {
    const { data, error } = await supabase
      .from('agent_wallet_history')
      .select('*')
      .eq('agent_name', agentName)
      .order('recorded_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(
        `[AgentWalletRotation] Failed to fetch history for "${agentName}": ${error.message}`,
      );
    }

    return data ?? [];
  }

  /**
   * Returns the current rotation states for all agents.
   */
  async getAllStates(): Promise<AgentRotationState[]> {
    return this.loadAllStates();
  }
}

export const agentWalletRotationService = new AgentWalletRotationService();
