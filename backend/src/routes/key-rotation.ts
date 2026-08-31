import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { keyRotationService } from '../services/key-rotation-service';
import { supabase } from '../config/database';
import logger from '../config/logger';
import { emitSecurityEvent } from '../services/audit-service';

const router = Router();

router.use(authenticate);

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
      message: 'Key rotation canceled',
    });
  } catch (error) {
    logger.error('Error canceling key rotation:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to cancel key rotation',
    });
  }
});

export default router;
