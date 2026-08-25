import crypto from 'crypto';
import { supabase } from '../config/database';
import logger from '../config/logger';

const DOMAIN_SEPARATOR = 'syncro:audit:v1';

const EVENT_TYPE_BYTE: Record<string, number> = {
  reminder_sent: 0x00,
  approval: 0x01,
  renewal: 0x02,
  failure: 0x03,
  retry: 0x04,
  cancellation: 0x05,
  gift_card_attached: 0x06,
  subscription_create: 0x10,
  subscription_update: 0x11,
  subscription_delete: 0x12,
  subscription_cancel: 0x13,
  subscription_pause: 0x14,
  subscription_unpause: 0x15,
};

export class CommitmentStorageService {
  private getEncryptionKey(): Buffer {
    const keyHex = process.env.COMMITMENT_ENCRYPTION_KEY;
    if (!keyHex) {
      throw new Error('COMMITMENT_ENCRYPTION_KEY environment variable is required');
    }
    return Buffer.from(keyHex, 'hex');
  }

  generateBlindingFactor(): Buffer {
    return crypto.randomBytes(32);
  }

  computeEventDataHash(eventData: Record<string, unknown>): Buffer {
    const serialized = JSON.stringify(eventData, Object.keys(eventData).sort());
    return crypto.createHash('sha256').update(serialized, 'utf-8').digest();
  }

  computeCommitmentHash(
    eventType: string,
    eventDataHash: Buffer,
    blindingFactor: Buffer,
  ): Buffer {
    const eventTypeByte = this.resolveEventTypeByte(eventType);
    const eventTypeBuf = Buffer.alloc(4);
    eventTypeBuf.writeUInt32BE(eventTypeByte, 0);

    const payload = Buffer.concat([
      Buffer.from(DOMAIN_SEPARATOR, 'utf-8'),
      eventTypeBuf,
      eventDataHash,
      blindingFactor,
    ]);

    return crypto.createHash('sha256').update(payload).digest();
  }

  resolveEventTypeByte(eventType: string): number {
    const byte = EVENT_TYPE_BYTE[eventType];
    if (byte === undefined) {
      logger.warn(`Unknown event type "${eventType}", defaulting to 0xFF`);
      return 0xff;
    }
    return byte;
  }

  encryptBlindingFactor(blindingFactor: Buffer): { iv: string; ciphertext: string; authTag: string } {
    const key = this.getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(blindingFactor), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      iv: iv.toString('hex'),
      ciphertext: encrypted.toString('hex'),
      authTag: authTag.toString('hex'),
    };
  }

  decryptBlindingFactor(
    encrypted: { iv: string; ciphertext: string; authTag: string },
  ): Buffer {
    const key = this.getEncryptionKey();
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(encrypted.iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(encrypted.authTag, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'hex')),
      decipher.final(),
    ]);
    return decrypted;
  }

  async storeCommitment(params: {
    userId: string;
    commitmentHash: Buffer;
    commitmentIndex: number | null;
    blindingFactor: Buffer;
    eventType: string;
    eventData: Record<string, unknown>;
  }): Promise<{ id: string } | null> {
    const encrypted = this.encryptBlindingFactor(params.blindingFactor);

    const encryptedPayload = JSON.stringify({
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      ciphertext: encrypted.ciphertext,
    });

    const { data, error } = await supabase
      .from('commitment_blinding_factors')
      .insert({
        user_id: params.userId,
        commitment_hash: params.commitmentHash,
        commitment_index: params.commitmentIndex ?? -1,
        blinding_factor: Buffer.from(encryptedPayload, 'utf-8'),
        event_type: params.eventType,
        event_data: params.eventData,
      })
      .select('id')
      .single();

    if (error) {
      logger.error('Failed to store commitment blinding factor:', error);
      return null;
    }

    return data as { id: string };
  }

  async updateCommitmentIndex(dbId: string, commitmentIndex: number): Promise<boolean> {
    const { error } = await supabase
      .from('commitment_blinding_factors')
      .update({ commitment_index: commitmentIndex })
      .eq('id', dbId);

    if (error) {
      logger.error(`Failed to update commitment index for ${dbId}:`, error);
      return false;
    }
    return true;
  }

  async createAndStoreCommitment(params: {
    userId: string;
    eventType: string;
    eventData: Record<string, unknown>;
  }): Promise<{
    commitmentHash: Buffer;
    blindingFactor: Buffer;
    eventDataHash: Buffer;
    dbId: string | null;
  }> {
    const blindingFactor = this.generateBlindingFactor();
    const eventDataHash = this.computeEventDataHash(params.eventData);
    const commitmentHash = this.computeCommitmentHash(
      params.eventType,
      eventDataHash,
      blindingFactor,
    );

    const dbRecord = await this.storeCommitment({
      userId: params.userId,
      commitmentHash,
      commitmentIndex: null,
      blindingFactor,
      eventType: params.eventType,
      eventData: params.eventData,
    });

    return {
      commitmentHash,
      blindingFactor,
      eventDataHash,
      dbId: dbRecord?.id ?? null,
    };
  }

  /**
   * Archive pruned log entries off-chain after on-chain `prune_logs` succeeds.
   * Stores enough metadata to rebuild Merkle inclusion proofs for evicted entries.
   */
  async archivePrunedLogs(params: {
    userId: string;
    subscriptionId: string;
    entries: Array<{
      logIndex: number;
      leafHash: Buffer;
      eventType: string;
      eventData: Record<string, unknown>;
      timestamp: number;
    }>;
    merkleRoot: Buffer;
    rootStartIndex: number;
    rootEndIndex: number;
  }): Promise<{ archived: number }> {
    if (params.entries.length === 0) {
      return { archived: 0 };
    }

    const rows = params.entries.map((entry) => ({
      user_id: params.userId,
      subscription_id: params.subscriptionId,
      log_index: entry.logIndex,
      leaf_hash: entry.leafHash,
      event_type: entry.eventType,
      event_data: entry.eventData,
      logged_at: new Date(entry.timestamp * 1000).toISOString(),
      merkle_root: params.merkleRoot,
      merkle_start_index: params.rootStartIndex,
      merkle_end_index: params.rootEndIndex,
    }));

    const { error } = await supabase.from('archived_subscription_logs').insert(rows);

    if (error) {
      logger.error('Failed to archive pruned subscription logs:', error);
      throw new Error(`Failed to archive pruned logs: ${error.message}`);
    }

    return { archived: rows.length };
  }

  /**
   * Fetch archived log leaf data for Merkle proof reconstruction.
   */
  async getArchivedLogLeaf(
    subscriptionId: string,
    logIndex: number,
  ): Promise<{ leafHash: Buffer; eventData: Record<string, unknown> } | null> {
    const { data, error } = await supabase
      .from('archived_subscription_logs')
      .select('leaf_hash, event_data')
      .eq('subscription_id', subscriptionId)
      .eq('log_index', logIndex)
      .maybeSingle();

    if (error) {
      logger.error('Failed to fetch archived log leaf:', error);
      throw new Error(`Failed to fetch archived log: ${error.message}`);
    }

    if (!data) {
      return null;
    }

    return {
      leafHash: Buffer.from(data.leaf_hash),
      eventData: data.event_data as Record<string, unknown>,
    };
  }
}

export const commitmentStorageService = new CommitmentStorageService();
