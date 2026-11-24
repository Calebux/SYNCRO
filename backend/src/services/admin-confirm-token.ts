import crypto from 'crypto';
import { redis } from '../config/redis';
import logger from '../config/logger';

const TOKEN_TTL_SECONDS = 15 * 60;
const TOKEN_PREFIX = 'syncro:admin:confirm:';

export interface ConfirmTokenPayload {
  actionId: string;
  operatorId: string;
  actionType: string;
  wouldAffect: Record<string, unknown>;
  reversible: boolean;
  reverseAction?: string | null;
  expiresAt: number;
}

function tokenKey(nonce: string): string {
  return `${TOKEN_PREFIX}${nonce}`;
}

export async function issueConfirmToken(params: {
  actionType: string;
  operatorId: string;
  wouldAffect: Record<string, unknown>;
  reversible: boolean;
  reverseAction?: string | null;
}): Promise<{ confirmToken: string; expiresAt: number; actionId: string }> {
  const nonce = crypto.randomBytes(24).toString('hex');
  const actionId = crypto.randomBytes(12).toString('hex');
  const expiresAt = Date.now() + TOKEN_TTL_SECONDS * 1000;

  const payload: ConfirmTokenPayload = {
    actionId,
    operatorId: params.operatorId,
    actionType: params.actionType,
    wouldAffect: params.wouldAffect,
    reversible: params.reversible,
    reverseAction: params.reverseAction ?? null,
    expiresAt,
  };

  const digest = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        actionId,
        operatorId: params.operatorId,
        actionType: params.actionType,
        wouldAffect: params.wouldAffect,
        nonce,
      })
    )
    .digest('hex');

  const confirmToken = `${nonce}.${digest}`;

  if (redis) {
    try {
      await redis.setEx(
        tokenKey(nonce),
        TOKEN_TTL_SECONDS,
        JSON.stringify(payload)
      );
    } catch (error) {
      logger.warn('[confirm-token] Redis write failed, falling back to stateless verify', { error });
    }
  }

  return { confirmToken, expiresAt, actionId };
}

export async function verifyConfirmToken(params: {
  confirmToken: string;
  operatorId: string;
  actionType: string;
  submittedWouldAffect: Record<string, unknown>;
}): Promise<{
  valid: boolean;
  reason?: 'expired' | 'invalid' | 'mismatch';
  payload?: ConfirmTokenPayload;
}> {
  const [nonce, digestClaim] = params.confirmToken.split('.');
  if (!nonce || !digestClaim) {
    return { valid: false, reason: 'invalid' };
  }

  let stored: ConfirmTokenPayload | null = null;
  if (redis) {
    try {
      const raw = await redis.get(tokenKey(nonce));
      if (raw) stored = JSON.parse(raw) as ConfirmTokenPayload;
    } catch (error) {
      logger.warn('[confirm-token] Redis read failed', { error });
    }
  }

  if (stored) {
    if (stored.expiresAt < Date.now()) {
      return { valid: false, reason: 'expired' };
    }
    if (stored.operatorId !== params.operatorId) {
      return { valid: false, reason: 'mismatch' };
    }
    if (stored.actionType !== params.actionType) {
      return { valid: false, reason: 'mismatch' };
    }
    return { valid: true, payload: stored };
  }

  const expectedDigest = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        actionId: nonce,
        operatorId: params.operatorId,
        actionType: params.actionType,
        wouldAffect: params.submittedWouldAffect,
        nonce,
      })
    )
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(digestClaim), Buffer.from(expectedDigest))) {
    return { valid: false, reason: 'mismatch' };
  }

  return { valid: true };
}
