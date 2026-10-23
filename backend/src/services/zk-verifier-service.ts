import { supabase } from '../config/database';
import logger from '../config/logger';
import { verifyPaymentCommitment } from '../../../shared/src/crypto/payment-commitment';

// Nullifiers are valid proofs of a one-time event; keep them for 2 years then archive.
const NULLIFIER_TTL_DAYS = 730;

// A valid hex-encoded SHA-256 commitment or nullifier is exactly 64 chars.
const HEX64_RE = /^[0-9a-f]{64}$/;

// Base64-encoded proof minimum/maximum byte lengths (before decode).
// Minimum: a compact JSON payload; maximum guards against DoS via giant strings.
const PROOF_MIN_LEN = 64;
const PROOF_MAX_LEN = 8192;

export interface VerifyAndStoreInput {
  proof: string;
  nullifier: string;
  commitment: string;
  amount: bigint;
  userId: string;
  serviceId: string;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

export class ZkVerifierService {
  /** Full server-side verification pipeline: format → double-spend → crypto. */
  async verifyAndStore(input: VerifyAndStoreInput): Promise<VerifyResult> {
    const formatErr = this.validateFormat(input);
    if (formatErr) return { ok: false, reason: formatErr };

    const spent = await this.isNullifierSpent(input.nullifier);
    if (spent) return { ok: false, reason: 'nullifier already spent' };

    const valid = this.verifyProofCrypto(input);
    if (!valid) return { ok: false, reason: 'invalid proof' };

    await this.storeNullifier(input.nullifier, input.userId, input.serviceId);
    return { ok: true };
  }

  validateFormat(input: Pick<VerifyAndStoreInput, 'proof' | 'nullifier' | 'commitment'>): string | null {
    if (input.proof.length < PROOF_MIN_LEN || input.proof.length > PROOF_MAX_LEN) {
      return `proof length out of range [${PROOF_MIN_LEN}, ${PROOF_MAX_LEN}]`;
    }

    if (!HEX64_RE.test(input.nullifier)) {
      return 'nullifier must be 64 hex chars (SHA-256)';
    }

    if (!HEX64_RE.test(input.commitment)) {
      return 'commitment must be 64 hex chars (SHA-256)';
    }

    return null;
  }

  async isNullifierSpent(nullifier: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('zk_nullifiers')
      .select('nullifier')
      .eq('nullifier', nullifier)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (error) {
      logger.error('zk_nullifiers lookup failed:', error);
      // Fail closed — treat unknown as spent to avoid double-spend on DB errors.
      return true;
    }

    return data !== null;
  }

  private verifyProofCrypto(input: VerifyAndStoreInput): boolean {
    try {
      const decoded = JSON.parse(atob(input.proof)) as {
        commitment: string;
        nullifier: string;
        blindingFactor: string;
        metadata: string;
      };

      // Reject if the proof payload fields don't match the declared public inputs
      // (malleability: someone could swap in a different commitment after the fact).
      if (decoded.commitment !== input.commitment || decoded.nullifier !== input.nullifier) {
        return false;
      }

      return verifyPaymentCommitment(input.amount, {
        version: 1,
        commitment: decoded.commitment,
        blindingFactor: decoded.blindingFactor,
        nullifier: decoded.nullifier,
        metadata: decoded.metadata,
        amountCommitment: decoded.commitment,
        amountBlindingFactor: decoded.blindingFactor,
      });
    } catch {
      return false;
    }
  }

  private async storeNullifier(nullifier: string, userId: string, serviceId: string): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + NULLIFIER_TTL_DAYS);

    const { error } = await supabase.from('zk_nullifiers').insert({
      nullifier,
      user_id: userId,
      service_id: serviceId,
      expires_at: expiresAt.toISOString(),
    });

    if (error) {
      logger.error('Failed to store nullifier:', error);
      throw error;
    }
  }

  /** Prune rows past their TTL. Call from a nightly cron. */
  async archiveExpired(): Promise<number> {
    const { data, error } = await supabase
      .from('zk_nullifiers')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .select('nullifier');

    if (error) {
      logger.error('Failed to archive expired nullifiers:', error);
      return 0;
    }

    const count = data?.length ?? 0;
    if (count > 0) logger.info(`Archived ${count} expired zk nullifiers`);
    return count;
  }
}

export const zkVerifierService = new ZkVerifierService();
