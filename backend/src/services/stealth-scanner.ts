import logger from '../config/logger';
import { supabase, databaseRepository, databaseRepository } from '../config/database';
import { detectStealthDestination, deriveEphemeralStealthAddress } from '@syncro/shared/crypto';
import {
  decodeStealthMemo,
  extractStealthPubkeyFromTx,
  isStealthMemo,
} from '@syncro/shared/stealth-derive';
import type { StealthPaymentRecord } from '@syncro/shared';
import { getScanCursor, setScanCursor } from '../lib/scan-cursor-store';
import { secretProvider } from './secret-provider';
import { decrypt } from '../utils/encryption';

export interface HorizonPaymentOp {
  type: string;
  destination?: string;
  amount?: string;
  asset_type?: string;
}

export interface HorizonTransaction {
  id: string;
  hash: string;
  ledger: number;
  created_at: string;
  paging_token?: string;
  memo_type?: string;
  memo?: string;
  memo_return?: string;
  _embedded?: { operations?: HorizonPaymentOp[] };
}

export interface StealthScanResult {
  detected: number;
  scanned: number;
  cursor: string | null;
}

/**
 * Progress event emitted during scanning
 */
export interface ScanProgress {
  stage: 'initializing' | 'scanning_ledger' | 'deriving_addresses' | 'verifying_payments' | 'complete';
  currentIndex: number;
  totalItems: number;
  recoveredPayments: number;
  message: string;
}

/**
 * Recovered payment from Stellar ledger
 */
export interface RecoveredPayment {
  stealthAddress: string;
  ephemeralPubkey: string;
  amount: number;
  ledger: number;
  timestamp: string;
  transactionHash: string;
  source: 'ledger_scan';
}

/**
 * Scans for payments to derived stealth addresses so users can audit
 * their own payment history without exposing wallet↔merchant links on-chain.
 */
export class StealthScanner {
  private horizonUrl(): string {
    return (
      process.env.HORIZON_URL ??
      process.env.STELLAR_HORIZON_URL ??
      'https://horizon-testnet.stellar.org'
    );
  }

  /**
   * Scan Stellar ledger for payments to derived stealth addresses.
   * Viewing key is resolved server-side and never exposed to clients.
   */
  async scanLedgerForUser(userId: string): Promise<StealthScanResult> {
    const keys = await this.resolveViewingKeys(userId);
    if (!keys) return { detected: 0, scanned: 0, cursor: null };

    const cursor = await getScanCursor(userId);
    const txs = await this.fetchTransactions(cursor ?? undefined);
    let detected = 0;

    for (const tx of txs) {
      const payment = this.scanTransactionForStealth(tx, keys);
      if (payment) {
        const stored = await this.storeStealthPayment(payment, userId);
        if (stored) detected++;
      }
    }

    const nextCursor =
      txs.length > 0 ? txs[txs.length - 1]!.paging_token ?? null : cursor;
    if (nextCursor) {
      await setScanCursor(userId, nextCursor);
    }

    return { detected, scanned: txs.length, cursor: nextCursor };
  }

  scanTransactionForStealth(
    tx: HorizonTransaction,
    keys: { viewPrivateKey: string; spendPublicKey: string },
  ): Omit<StealthPaymentRecord, 'subscriptionId' | 'approvalId' | 'cycleId'> | null {
    const memoType = tx.memo_type ?? 'none';
    const memoValue = tx.memo_return ?? tx.memo ?? '';
    if (!isStealthMemo(memoType, memoValue)) return null;

    let ephemeralPubkey: string;
    try {
      ephemeralPubkey = decodeStealthMemo(memoValue);
    } catch {
      const fromTx = extractStealthPubkeyFromTx({
        memo: { type: memoType, value: memoValue },
      });
      if (!fromTx) return null;
      ephemeralPubkey = fromTx;
    }

    let stealthAddresses: string[];
    try {
      if (ephemeralPubkey.length === 64) {
        stealthAddresses = ['02', '03'].map((prefix) =>
          detectStealthDestination(keys.viewPrivateKey, keys.spendPublicKey, prefix + ephemeralPubkey),
        );
      } else {
        stealthAddresses = [
          detectStealthDestination(keys.viewPrivateKey, keys.spendPublicKey, ephemeralPubkey),
        ];
      }
    } catch (err) {
      logger.warn('Stealth destination derivation failed', {
        txHash: tx.hash,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    const ops = tx._embedded?.operations ?? [];
    const paymentOp = ops.find(
      (op) => op.type === 'payment' && stealthAddresses.includes(op.destination ?? ''),
    );
    if (!paymentOp) return null;

    const stealthAddress = paymentOp.destination!;

    return {
      stealthAddress,
      ephemeralPubkey,
      amount: Number.parseFloat(paymentOp.amount ?? '0'),
      createdAt: tx.created_at,
      transactionHash: tx.hash,
    };
  }

  async storeStealthPayment(
    record: Omit<StealthPaymentRecord, 'subscriptionId' | 'approvalId' | 'cycleId'> & {
      asset?: string;
      ledger?: number;
    },
    userId: string,
  ): Promise<boolean> {
    const { error } = await databaseRepository.from('stealth_payments').insert({
      user_id: userId,
      transaction_hash: record.transactionHash,
      ephemeral_pubkey: record.ephemeralPubkey,
      recipient_address: record.stealthAddress,
      amount: record.amount,
      asset: record.asset ?? 'XLM',
      ledger: record.ledger ?? 0,
      timestamp: record.createdAt,
    });

    if (error) {
      if (error.code === '23505') return false;
      logger.warn('Failed to store stealth payment', { error: error.message });
      return false;
    }
    return true;
  }

  async getUserStealthPayments(userId: string, limit = 100): Promise<StealthPaymentRecord[]> {
    const { data, error } = await databaseRepository
      .from('stealth_payments')
      .select('*')
      .eq('user_id', userId)
      .order('detected_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return (data ?? []).map((row) => ({
      subscriptionId: '',
      approvalId: '',
      cycleId: '',
      stealthAddress: row.recipient_address as string,
      ephemeralPubkey: row.ephemeral_pubkey as string,
      amount: Number(row.amount),
      createdAt: row.timestamp as string,
      transactionHash: row.transaction_hash as string,
    }));
  }

  /**
   * Scans database records for stealth payments
   */
  async scanForPayments(userId: string): Promise<StealthPaymentRecord[]> {
    const onChain = await this.getUserStealthPayments(userId);
    if (onChain.length > 0) return onChain;

    const { data: profile } = await databaseRepository
      .from('profiles')
      .select('stealth_meta_address')
      .eq('id', userId)
      .single();

    const metaRaw = profile?.stealth_meta_address as string | null;
    if (!metaRaw) return [];

    const parts = metaRaw.replace('syncro:stealth:v1:', '').split(':');
    if (parts.length !== 2) return [];

    const [spendPubkey, viewPubkey] = parts;
    const metaAddress = { spendPublicKey: spendPubkey, viewPublicKey: viewPubkey };

    const { data: subs } = await databaseRepository
      .from('subscriptions')
      .select('id')
      .eq('user_id', userId);

    const records: StealthPaymentRecord[] = [];

    for (const sub of subs ?? []) {
      const { data: logs } = await databaseRepository
        .from('renewal_logs')
        .select('approval_id, transaction_hash, created_at')
        .eq('subscription_id', sub.id)
        .eq('status', 'success')
        .not('stealth_address', 'is', null);

      for (const log of logs ?? []) {
        const cycleId = `${sub.id}:${log.approval_id ?? '0'}`;
        try {
          const { ephemeralPubkey, stealthAddress } = deriveEphemeralStealthAddress(
            metaAddress,
            cycleId,
          );
          records.push({
            subscriptionId: sub.id,
            approvalId: String(log.approval_id ?? ''),
            stealthAddress,
            ephemeralPubkey,
            amount: 0,
            cycleId,
            createdAt: log.created_at,
            transactionHash: log.transaction_hash ?? undefined,
          });
        } catch (err) {
          logger.warn('Stealth scan derivation failed', {
            subscriptionId: sub.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return records;
  }

  /**
   * Performs full historical ledger scan for stealth payments
   */
  async scanHistoricalLedger(
    userId: string,
    viewingKey: string,
    onProgress?: (progress: ScanProgress) => void,
  ): Promise<RecoveredPayment[]> {
    const emitProgress = (
      stage: ScanProgress['stage'],
      current: number,
      total: number,
      msg: string,
      recovered: number = 0,
    ) => {
      if (onProgress) {
        onProgress({
          stage,
          currentIndex: current,
          totalItems: total,
          recoveredPayments: recovered,
          message: msg,
        });
      }
      logger.info(`Stealth recovery [${stage}]: ${msg}`, { userId, current, total, recovered });
    };

    try {
      emitProgress('initializing', 0, 1, 'Loading user stealth configuration...');

      const { data: profile } = await databaseRepository
        .from('profiles')
        .select('stealth_meta_address, stellar_public_key')
        .eq('id', userId)
        .single();

      if (!profile?.stealth_meta_address) {
        throw new Error('User has no stealth meta address configured');
      }

      const metaRaw = profile.stealth_meta_address as string;
      const parts = metaRaw.replace('syncro:stealth:v1:', '').split(':');
      if (parts.length !== 2) {
        throw new Error('Invalid stealth meta address format');
      }

      const [spendPubkey, viewPubkey] = parts;
      const metaAddress = { spendPublicKey: spendPubkey, viewPublicKey: viewPubkey };

      emitProgress('scanning_ledger', 0, 1, 'Fetching subscription history...');

      const { data: subs } = await databaseRepository
        .from('subscriptions')
        .select('id, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      const subscriptions = subs ?? [];
      emitProgress(
        'scanning_ledger',
        1,
        subscriptions.length,
        `Found ${subscriptions.length} subscriptions. Scanning ledger...`,
        0,
      );

      const recovered: RecoveredPayment[] = [];

      for (let i = 0; i < subscriptions.length; i++) {
        const sub = subscriptions[i];
        emitProgress(
          'deriving_addresses',
          i,
          subscriptions.length,
          `Deriving addresses for subscription ${i + 1}/${subscriptions.length}...`,
          recovered.length,
        );

        const { data: renewals } = await databaseRepository
          .from('renewal_logs')
          .select('approval_id, created_at, status')
          .eq('subscription_id', sub.id)
          .eq('status', 'success')
          .order('created_at', { ascending: true });

        for (const renewal of renewals ?? []) {
          const cycleId = `${sub.id}:${renewal.approval_id ?? '0'}`;
          try {
            const { ephemeralPubkey, stealthAddress } = deriveEphemeralStealthAddress(
              metaAddress,
              cycleId,
            );

            recovered.push({
              stealthAddress,
              ephemeralPubkey,
              amount: 0,
              ledger: 0,
              timestamp: renewal.created_at,
              transactionHash: '',
              source: 'ledger_scan',
            });
          } catch (err) {
            logger.warn('Failed to derive stealth address during recovery', {
              subscriptionId: sub.id,
              cycleId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      emitProgress(
        'verifying_payments',
        subscriptions.length,
        subscriptions.length,
        `Verifying ${recovered.length} recovered payments...`,
        recovered.length,
      );

      emitProgress(
        'complete',
        subscriptions.length,
        subscriptions.length,
        `Recovery complete! Recovered ${recovered.length} payments.`,
        recovered.length,
      );

      return recovered;
    } catch (error) {
      logger.error('Stealth recovery scan failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async resolveViewingKeys(
    userId: string,
  ): Promise<{ viewPrivateKey: string; spendPublicKey: string } | null> {
    const envView = await secretProvider.getSecret('STEALTH_VIEW_PRIVKEY');
    const envSpend = process.env.STEALTH_SPEND_PUBKEY;
    if (envView && envSpend) {
      return { viewPrivateKey: envView, spendPublicKey: envSpend };
    }

    const { data: profile } = await databaseRepository
      .from('profiles')
      .select('stealth_meta_address, stealth_view_key_encrypted')
      .eq('id', userId)
      .single();

    const raw = profile?.stealth_meta_address as string | null;
    if (!raw?.startsWith('syncro:stealth:v1:')) return null;

    const [spend, viewPub] = raw.replace('syncro:stealth:v1:', '').split(':');
    const encrypted = profile?.stealth_view_key_encrypted as string | null;
    if (!spend || !viewPub || !encrypted) return null;

    try {
      const viewPrivateKey = decrypt(encrypted);
      return { viewPrivateKey, spendPublicKey: spend };
    } catch {
      return null;
    }
  }

  private async fetchTransactions(cursor?: string): Promise<HorizonTransaction[]> {
    const limit = Number(process.env.STEALTH_SCAN_BATCH_SIZE ?? 50);
    const url = new URL(`${this.horizonUrl()}/transactions`);
    url.searchParams.set('order', 'asc');
    url.searchParams.set('limit', String(limit));
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`Horizon request failed: ${res.status}`);
    }

    const body = (await res.json()) as { _embedded?: { records?: HorizonTransaction[] } };
    return body._embedded?.records ?? [];
  }
}

export const stealthScanner = new StealthScanner();
