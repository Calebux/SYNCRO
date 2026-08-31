import * as crypto from 'node:crypto';

/** SYNCRO memo format version. */
export const SYNCRO_MEMO_VERSION = 'v1' as const;

/** Compact memo type codes (single character). */
export type SyncroMemoTypeCode =
  | 'c' // subscription create
  | 'u' // subscription update
  | 'd' // subscription delete
  | 'x' // subscription cancel
  | 'p' // subscription pause
  | 'r' // subscription unpause/resume
  | 'm' // reminder log
  | 'g' // gift card attached
  | 'k'; // commitment record

export interface SyncroMemoParts {
  version: typeof SYNCRO_MEMO_VERSION;
  type: SyncroMemoTypeCode;
  subscriptionIdHash: string;
}

export interface ParsedSyncroMemo extends SyncroMemoParts {
  raw: string;
  legacy: boolean;
}

const MEMO_PATTERN = /^S1:([cudxprmgk]):([a-f0-9]{12})$/;

const TYPE_CODE_MAP: Record<string, SyncroMemoTypeCode> = {
  create: 'c',
  update: 'u',
  delete: 'd',
  cancel: 'x',
  pause: 'p',
  unpause: 'r',
  reminder: 'm',
  gift_card: 'g',
  commitment: 'k',
};

export type SyncroMemoOperation =
  | 'create'
  | 'update'
  | 'delete'
  | 'cancel'
  | 'pause'
  | 'unpause'
  | 'reminder'
  | 'gift_card'
  | 'commitment';

/**
 * Hash a subscription ID for memo inclusion (first 12 hex chars of SHA-256).
 */
export function hashSubscriptionId(subscriptionId: string): string {
  return crypto.createHash('sha256').update(subscriptionId).digest('hex').slice(0, 12);
}

/**
 * Build a standardized SYNCRO Stellar memo.
 *
 * Format: `S1:<type>:<subscriptionIdHash>`
 * Example: `S1:c:a1b2c3d4e5f6`
 */
export function buildSyncroMemo(
  operation: SyncroMemoOperation,
  subscriptionId: string,
): string {
  const type = TYPE_CODE_MAP[operation];
  if (!type) {
    throw new Error(`Unsupported memo operation: ${operation}`);
  }
  if (!subscriptionId) {
    throw new Error('subscriptionId is required to build a SYNCRO memo');
  }

  const subscriptionIdHash = hashSubscriptionId(subscriptionId);
  return `S1:${type}:${subscriptionIdHash}`;
}

/**
 * Parse a SYNCRO memo. Returns null when the memo is not SYNCRO-formatted.
 */
export function parseSyncroMemo(memo: string | null | undefined): ParsedSyncroMemo | null {
  if (!memo) {
    return null;
  }

  const trimmed = memo.trim();
  const match = trimmed.match(MEMO_PATTERN);
  if (!match) {
    return {
      version: SYNCRO_MEMO_VERSION,
      type: 'c',
      subscriptionIdHash: '',
      raw: trimmed,
      legacy: true,
    };
  }

  return {
    version: SYNCRO_MEMO_VERSION,
    type: match[1] as SyncroMemoTypeCode,
    subscriptionIdHash: match[2] as string,
    raw: trimmed,
    legacy: false,
  };
}

/**
 * Validate that a memo matches the expected operation and subscription ID.
 */
export function validateSyncroMemo(
  memo: string | null | undefined,
  operation: SyncroMemoOperation,
  subscriptionId: string,
): boolean {
  const parsed = parseSyncroMemo(memo);
  if (!parsed || parsed.legacy) {
    return false;
  }

  const expectedType = TYPE_CODE_MAP[operation];
  const expectedHash = hashSubscriptionId(subscriptionId);

  return parsed.type === expectedType && parsed.subscriptionIdHash === expectedHash;
}

export interface StellarTransactionReceipt {
  memo?: string | null;
  successful?: boolean;
  hash?: string;
}

/**
 * Verify a transaction receipt contains the expected standardized memo.
 */
export function verifyTransactionMemo(
  receipt: StellarTransactionReceipt,
  operation: SyncroMemoOperation,
  subscriptionId: string,
): boolean {
  if (receipt.successful === false) {
    return false;
  }

  return validateSyncroMemo(receipt.memo ?? null, operation, subscriptionId);
}

export function resolveMemoOperationFromSubscriptionAction(
  operation: 'create' | 'update' | 'delete' | 'cancel' | 'pause' | 'unpause',
): SyncroMemoOperation {
  return operation;
}

export function resolveMemoOperationFromMethod(method: string): SyncroMemoOperation | null {
  if (method.includes('subscription_create') || method === 'subscription_create') return 'create';
  if (method.includes('subscription_update') || method === 'subscription_update') return 'update';
  if (method.includes('subscription_delete') || method === 'subscription_delete') return 'delete';
  if (method.includes('subscription_cancel') || method === 'subscription_cancel') return 'cancel';
  if (method.includes('subscription_pause') || method === 'subscription_pause') return 'pause';
  if (method.includes('subscription_unpause') || method === 'subscription_unpause') return 'unpause';
  if (method.includes('log_reminder') || method === 'log_reminder') return 'reminder';
  if (method.includes('gift_card_attached') || method === 'gift_card_attached') return 'gift_card';
  if (method.includes('record_commitment') || method === 'record_commitment') return 'commitment';
  return null;
}
