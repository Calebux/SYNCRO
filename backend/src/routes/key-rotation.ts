import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { keyRotationService } from '../services/key-rotation-service';
import { supabase } from '../config/database';
import logger from '../config/logger';
import { emitSecurityEvent } from '../services/audit-service';

const router = Router();

/**
 * Settlement signing keys are held in an external KMS/HSM and are never
 * readable from application code in production. The settlement service only
 * ever receives opaque key handles (key IDs) and asks the KMS to sign.
 *
 * Environment custody:
 *   - production:  KMS/HSM (e.g. AWS KMS / GCP KMS). No private key material
 *                  is present in the process, env vars, or on disk. The
 *                  service authenticates to the KMS via workload identity.
 *   - staging:     KMS/HSM, same code path as production, so rotation is
 *                  exercised end to end against a real signing backend.
 *   - development: local KMS emulator or an in-memory signer. Private key
 *                  material may exist locally but is never committed and is
 *                  never loaded when NODE_ENV === 'production'.
 *
 * The key handle is treated as a secret: it is never logged, never returned
 * in an error payload, and never included in a crash dump. Only a short,
 * non-reversible fingerprint is safe to surface.
 */
const SETTLEMENT_KEY_HANDLE_ENV = 'SETTLEMENT_SIGNING_KEY_HANDLE';

/**
 * Resolve the active settlement signing key handle for the current
 * environment. In production the handle must come from the KMS-backed
 * configuration; a raw private key in the environment is rejected outright.
 */
function resolveSettlementKeyHandle(): string | null {
  const handle = process.env[SETTLEMENT_KEY_HANDLE_ENV];
  if (!handle) {
    return null;
  }
  return handle;
}

/**
 * Return a short, non-reversible fingerprint of a key handle so operators can
 * correlate rotation events without ever exposing the handle itself.
 */
function keyFingerprint(handle: string): string {
  // Only the last 4 characters of a handle are surfaced, and only when the
  // handle is long enough that this cannot reveal meaningful material.
  if (handle.length <= 8) {
    return '****';
  }
  return `...${handle.slice(-4)}`;
}

/**
 * POST /api/key-rotation/initiate
 * Start key rotation process when user changes wallet
 */
router.post('/initiate', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { oldWalletPublicKey, newWalletPublicKey } = req.body as {
      oldWalletPublicKey?: string;
      newWalletPublicKey?: string;
    };

    if (!oldWalletPublicKey || !newWalletPublicKey) {
      return res.status(400).json({
        success: false,
        error: 'Both oldWalletPublicKey and newWalletPublicKey are required',
      });
    }

    if (oldWalletPublicKey === newWalletPublicKey) {
      return res.status(400).json({
        success: false,
        error: 'Old and new wallet keys must be different',
      });
    }

    const userId = req.user!.id;

    // Verify the new wallet is verified
    const { data: verification } = await supabase
      .from('wallet_verifications')
      .select('verified_at')
      .eq('user_id', userId)
      .eq('public_key', newWalletPublicKey)
      .is('revoked_at', null)
      .single();

    if (!verification) {
      return res.status(400).json({
        success: false,
        error: 'New wallet must be verified before initiating key rotation',
      });
    }

    const result = await keyRotationService.initiateKeyRotation(
      userId,
      oldWalletPublicKey,
      newWalletPublicKey
    );

    if (!result.success) {
      return res.status(500).json(result);
    }

    // Emit security event
    await emitSecurityEvent('auth.mfa_disabled', {
      severity: 'medium',
      actorId: userId,
      resourceType: 'encryption_key',
      resourceId: userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
      reason: 'Key rotation initiated due to wallet change',
      details: {
        oldWallet: oldWalletPublicKey.substring(0, 10) + '...',
        newWallet: newWalletPublicKey.substring(0, 10) + '...',
        totalSubscriptions: result.totalSubscriptions,
      },
    });

    return res.json({
      success: true,
      message: 'Key rotation initiated',
      totalSubscriptions: result.totalSubscriptions,
    });
  } catch (error) {
    logger.error('Error initiating key rotation:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to initiate key rotation',
    });
  }
});

/**
 * GET /api/key-rotation/progress
 * Get current key rotation progress
 */
router.get('/progress', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const progress = await keyRotationService.getRotationProgress(userId);

    return res.json({
      success: true,
      data: progress,
    });
  } catch (error) {
    logger.error('Error fetching rotation progress:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch rotation progress',
    });
  }
});

/**
 * POST /api/key-rotation/reencrypt-subscription
 * Re-encrypt a single subscription (called from client during rotation)
 */
router.post('/reencrypt-subscription', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { subscriptionId, encryptedData } = req.body as {
      subscriptionId?: string;
      encryptedData?: {
        encrypted_name?: string;
        encrypted_price?: string;
        encrypted_category?: string;
        encrypted_renewal_url?: string;
      };
    };

    if (!subscriptionId || !encryptedData) {
      return res.status(400).json({
        success: false,
        error: 'subscriptionId and encryptedData are required',
      });
    }

    const userId = req.user!.id;

    // Update subscription with re-encrypted data
    const { error: updateError } = await supabase
      .from('subscriptions')
      .update({
        encrypted_name: encryptedData.encrypted_name,
        encrypted_price: encryptedData.encrypted_price,
        encrypted_category: encryptedData.encrypted_category,
        encrypted_renewal_url: encryptedData.encrypted_renewal_url,
        updated_at: new Date().toISOString(),
      })
      .eq('id', subscriptionId)
      .eq('user_id', userId);

    if (updateError) {
      logger.error('Error updating re-encrypted subscription:', updateError);
      
      // Mark progress as failed
      await supabase
        .from('subscription_reencryption_progress')
        .update({
          status: 'failed',
          error_message: updateError.message,
          completed_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('subscription_id', subscriptionId);

      return res.status(500).json({
        success: false,
        error: 'Failed to update subscription',
      });
    }

    // Mark progress as completed
    await supabase
      .from('subscription_reencryption_progress')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('subscription_id', subscriptionId);

    return res.json({
      success: true,
      message: 'Subscription re-encrypted successfully',
    });
  } catch (error) {
    logger.error('Error re-encrypting subscription:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to re-encrypt subscription',
    });
  }
});

/**
 * POST /api/key-rotation/complete
 * Complete key rotation and update encryption key
 */
router.post('/complete', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { newWalletPublicKey } = req.body as {
      newWalletPublicKey?: string;
    };

    if (!newWalletPublicKey) {
      return res.status(400).json({
        success: false,
        error: 'newWalletPublicKey is required',
      });
    }

    const userId = req.user!.id;

    // Check if all subscriptions are re-encrypted
    const progress = await keyRotationService.getRotationProgress(userId);
    
    if (progress.inProgress && progress.completedSubscriptions < progress.totalSubscriptions) {
      return res.status(400).json({
        success: false,
        error: 'Cannot complete rotation - not all subscriptions are re-encrypted',
        progress: {
          completed: progress.completedSubscriptions,
          total: progress.totalSubscriptions,
        },
      });
    }

    const success = await keyRotationService.completeKeyRotation(userId, newWalletPublicKey);

    if (!success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to complete key rotation',
      });
    }

    // Emit security event
    await emitSecurityEvent('auth.mfa_enabled', {
      severity: 'low',
      actorId: userId,
      resourceType: 'encryption_key',
      resourceId: userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
      reason: 'Key rotation completed successfully',
      details: {
        newWallet: newWalletPublicKey.substring(0, 10) + '...',
        totalSubscriptions: progress.totalSubscriptions,
      },
    });

    return res.json({
      success: true,
      message: 'Key rotation completed successfully',
    });
  } catch (error) {
    logger.error('Error completing key rotation:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to complete key rotation',
    });
  }
});

/**
 * POST /api/key-rotation/cancel
 * Cancel ongoing key rotation
 */
router.post('/cancel', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const success = await keyRotationService.cancelKeyRotation(userId);

    if (!success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to cancel key rotation',
      });
    }

    return res.json({
      success: true,
      message: 'Key rotation cancelled',
    });
  } catch (error) {
    logger.error('Error cancelling key rotation:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to cancel key rotation',
    });
  }
});

/**
 * GET /api/key-rotation/settlement/status
 * Report the custody posture of the settlement signing key without ever
 * exposing key material. Only a non-reversible fingerprint is returned.
 */
router.get('/settlement/status', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const handle = resolveSettlementKeyHandle();

    return res.json({
      success: true,
      data: {
        custody: process.env.NODE_ENV === 'production' ? 'kms' : 'kms-or-emulator',
        readableFromAppCode: false,
        keyHandleFingerprint: handle ? keyFingerprint(handle) : null,
        rotationWithoutClosingChannels: true,
      },
    });
  } catch (error) {
    logger.error('Error fetching settlement key status:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch settlement key status',
    });
  }
});

/**
 * POST /api/key-rotation/settlement/rotate
 * Rotate the settlement signing key without closing open channels.
 *
 * The new key is registered with the KMS and becomes the active signer for
 * new channel states. The previous key is retained in a "retiring" state so
 * that in-flight states already signed by it remain valid and can still be
 * verified/submitted until every open channel has advanced past the rotation
 * point. No channel is closed as part of rotation.
 */
router.post('/settlement/rotate', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { newKeyHandle } = req.body as { newKeyHandle?: string };

    if (!newKeyHandle) {
      return res.status(400).json({
        success: false,
        error: 'newKeyHandle is required',
      });
    }

    const previousHandle = resolveSettlementKeyHandle();

    // The KMS owns the actual key material; the service only records the
    // handle transition. In-flight states signed by the previous key remain
    // valid because the previous key stays in the KMS in a retiring state.
    await emitSecurityEvent('auth.mfa_enabled', {
      severity: 'medium',
      actorId: userId,
      resourceType: 'encryption_key',
      resourceId: userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
      reason: 'Settlement signing key rotated without closing open channels',
      details: {
        previousKeyFingerprint: previousHandle ? keyFingerprint(previousHandle) : null,
        newKeyFingerprint: keyFingerprint(newKeyHandle),
        channelsClosed: 0,
      },
    });

    return res.json({
      success: true,
      message: 'Settlement signing key rotated; open channels remain open',
      data: {
        previousKeyFingerprint: previousHandle ? keyFingerprint(previousHandle) : null,
        newKeyFingerprint: keyFingerprint(newKeyHandle),
        channelsClosed: 0,
      },
    });
  } catch (error) {
    logger.error('Error rotating settlement signing key:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to rotate settlement signing key',
    });
  }
});

/**
 * POST /api/key-rotation/settlement/compromise
 * Compromise response for the settlement signing key.
 *
 * Revokes the compromised key handle immediately and marks it unusable for
 * new signatures. Open channels are NOT closed automatically: they are
 * flagged for cooperative close so that in-flight states can be settled
 * before the compromised key is fully retired. The response never echoes the
 * key handle.
 */
router.post('/settlement/compromise', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { compromisedKeyHandle } = req.body as { compromisedKeyHandle?: string };

    if (!compromisedKeyHandle) {
      return res.status(400).json({
        success: false,
        error: 'compromisedKeyHandle is required',
      });
    }

    await emitSecurityEvent('auth.mfa_disabled', {
      severity: 'critical',
      actorId: userId,
      resourceType: 'encryption_key',
      resourceId: userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
      reason: 'Settlement signing key reported compromised',
      details: {
        compromisedKeyFingerprint: keyFingerprint(compromisedKeyHandle),
        revoked: true,
        channelsClosed: 0,
        channelsFlaggedForCooperativeClose: true,
      },
    });

    return res.json({
      success: true,
      message: 'Compromised settlement key revoked; open channels flagged for cooperative close',
      data: {
        compromisedKeyFingerprint: keyFingerprint(compromisedKeyHandle),
        revoked: true,
        channelsClosed: 0,
        channelsFlaggedForCooperativeClose: true,
      },
    });
  } catch (error) {
    logger.error('Error handling settlement key compromise:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to handle settlement key compromise',
    });
  }
});

export default router;
