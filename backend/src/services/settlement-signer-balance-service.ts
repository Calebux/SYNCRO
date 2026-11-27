import logger from '../config/logger';
import { env } from '../config/env';
import { SorobanRpc, Keypair } from '@stellar/stellar-sdk';
import { resolveStellarNetwork } from '../../../shared/blockchain-flags';

export interface SettlementSignerBalanceResult {
  balance: number | null;
  accountId: string;
  fetchedAt: string;
}

/**
 * Queries the Stellar network for the settlement signer's XLM balance.
 *
 * Uses the Horizon/Soroban RPC REST endpoint. The signer
 * account is identified by the secret key configured in
 * `SETTLEMENT_SIGNER_SECRET_KEY`; the public key is derived locally so
 * no private key is ever transmitted.
 */
export class SettlementSignerBalanceService {
  private rpc: SorobanRpc;
  private networkPassphrase: string;

  constructor() {
    const stellarNetwork = env.STELLAR_NETWORK ?? 'testnet';
    const resolved = resolveStellarNetwork(stellarNetwork);
    this.rpc = new SorobanRpc.Server(resolved.horizonUrl);
    this.networkPassphrase = resolved.networkPassphrase;
  }

  /**
   * Returns the settlement signer's XLM balance in XLM (not stroops).
   * Returns null when the signer is not configured or the account cannot be found.
   */
  async getSignerBalance(): Promise<SettlementSignerBalanceResult> {
    const secretKey = env.SETTLEMENT_SIGNER_SECRET_KEY;
    if (!secretKey) {
      logger.warn('[SettlementSignerBalance] SETTLEMENT_SIGNER_SECRET_KEY not configured — balance check skipped');
      return { balance: null, accountId: '', fetchedAt: new Date().toISOString() };
    }

    const keypair = Keypair.fromSecret(secretKey);
    const accountId = keypair.publicKey();

    try {
      const account = await this.rpc.getAccount(accountId);
      const balance = account.balances.find((b) => b.asset_type === 'native');
      const stroops = balance ? BigInt(balance.balance) : 0n;
      // Convert stroops to XLM (divide by 10^7)
      const xlm = Number(stroops) / 10_000_000;
      return { balance: xlm, accountId, fetchedAt: new Date().toISOString() };
    } catch (error) {
      logger.error('[SettlementSignerBalance] Failed to fetch signer balance:', {
        accountId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { balance: null, accountId, fetchedAt: new Date().toISOString() };
    }
  }
}

export const settlementSignerBalanceService = new SettlementSignerBalanceService();
