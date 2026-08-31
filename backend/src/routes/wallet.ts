import { Router, Response } from 'express';
import * as stellarSdk from '@stellar/stellar-sdk';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { supabase } from '../config/database';
import logger from '../config/logger';
import { emitSecurityEvent } from '../services/audit-service';

type WalletVerificationMetadata = {
  verified: boolean;
  publicKey: string;
  verifiedAt: string;
};

const VERIFICATION_SOFT_EXPIRY_DAYS = 365;

const router = Router();

router.use(authenticate);

/**
 * POST /api/wallet/verify
 * Verify Stellar wallet ownership and persist verification status
 * both in the dedicated wallet_verifications table and user_metadata.
 *
 * Re-verification rules:
 *   1. Same user + same key → updates the existing record (verified_at, signature).
 *   2. Same user + different key → appended as a new row; previous key remains valid
 *      unless explicitly revoked.
 *   3. Verifications older than 365 days SHOULD be re-challenged (soft expiry).
 */
router.post('/verify', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { publicKey, message, signature } = req.body as {
      publicKey?: string;
      message?: string;
      signature?: string;
    };

    if (!publicKey || !message || !signature) {
      return res.status(400).json({
        verified: false,
        error: 'Missing required fields: publicKey, message, and signature are required',
      });
    }

    if (!stellarSdk.StrKey.isValidEd25519PublicKey(publicKey)) {
      return res.status(400).json({
        verified: false,
        error: 'Invalid Stellar public key format',
      });
    }

    let isValid = false;
    try {
      const keypair = stellarSdk.Keypair.fromPublicKey(publicKey);
      const messageBuffer = Buffer.from(message, 'utf8');
      const signatureBuffer = Buffer.from(signature, 'base64');

      // Ed25519 signatures must be exactly 64 bytes.
      if (signatureBuffer.length !== 64) {
        return res.status(401).json({
          verified: false,
          error: 'Invalid signature - verification failed',
        });
      }

      isValid = keypair.verify(messageBuffer, signatureBuffer);
    } catch (verifyError) {
      logger.warn('Wallet signature verification failed:', verifyError);
      return res.status(401).json({
        verified: false,
        error: 'Signature verification failed',
      });
    }

    if (!isValid) {
      return res.status(401).json({
        verified: false,
        error: 'Invalid signature - verification failed',
      });
    }

    const userId = req.user!.id;

    // Persist verification to the dedicated wallet_verifications table
    const { error: dbError } = await supabase
      .from('wallet_verifications')
      .upsert(
        {
          user_id: userId,
          public_key: publicKey,
          message,
          signature,
          verified_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id, public_key',
          ignoreDuplicates: false,
        },
      );

    if (dbError) {
      logger.error('Error storing wallet verification in database:', dbError);
      // Fall back to user_metadata only
    }

    // Also store in user_metadata for backward compatibility
    const { data: currentUserData, error: currentUserError } = await supabase.auth.admin.getUserById(userId);

    if (currentUserError) {
      logger.error('Error loading user for wallet verification:', currentUserError);
      return res.status(500).json({
        verified: false,
        error: 'Failed to persist wallet verification',
      });
    }

    const existingMetadata =
      currentUserData.user?.user_metadata && typeof currentUserData.user.user_metadata === 'object'
        ? currentUserData.user.user_metadata
        : {};

    const walletVerification: WalletVerificationMetadata = {
      verified: true,
      publicKey,
      verifiedAt: new Date().toISOString(),
    };

    const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
      user_metadata: {
        ...existingMetadata,
        wallet_verification: walletVerification,
      },
    });

    if (updateError) {
      logger.error('Error storing wallet verification in metadata:', updateError);
    }

    // Emit structured security event for the verification
    await emitSecurityEvent('auth.unauthorized_access', {
      severity: 'low',
      actorId: userId,
      resourceType: 'wallet',
      resourceId: publicKey,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
      reason: 'Wallet verification completed',
      details: { verifiedAt: walletVerification.verifiedAt },
    });

    return res.json({
      verified: true,
      publicKey,
      message: 'Wallet successfully verified',
    });
  } catch (error) {
    logger.error('Wallet verification error:', error);
    return res.status(500).json({
      verified: false,
      error: 'Internal server error during verification',
    });
  }
});

/**
 * GET /api/wallet/status
 * Return authenticated user's wallet verification status.
 * Checks the dedicated wallet_verifications table first, falls back to user_metadata.
 * Reports soft expiry for verifications older than VERIFICATION_SOFT_EXPIRY_DAYS.
 */
router.get('/status', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    // Check the dedicated table first
    const { data: dbVerifications, error: dbError } = await supabase
      .from('wallet_verifications')
      .select('*')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .order('verified_at', { ascending: false })
      .limit(1);

    if (dbError) {
      logger.error('Error fetching wallet verifications from DB:', dbError);
    }

    const dbRecord = dbVerifications?.[0];
    const now = new Date();
    let verified = false;
    let publicKey: string | null = null;
    let verifiedAt: string | null = null;
    let needsReVerification = false;

    if (dbRecord) {
      verified = true;
      publicKey = dbRecord.public_key;
      verifiedAt = dbRecord.verified_at;
      const verificationAge = (now.getTime() - new Date(dbRecord.verified_at).getTime()) / (1000 * 86400);
      needsReVerification = verificationAge > VERIFICATION_SOFT_EXPIRY_DAYS;
    } else {
      // Fall back to user_metadata for backward compatibility
      const { data, error } = await supabase.auth.admin.getUserById(userId);

      if (error) {
        logger.error('Error fetching wallet status:', error);
        return res.status(500).json({
          verified: false,
          publicKey: null,
          error: 'Failed to fetch wallet status',
        });
      }

      const metadata = data.user?.user_metadata as { wallet_verification?: WalletVerificationMetadata } | undefined;
      const walletVerification = metadata?.wallet_verification;

      if (walletVerification?.verified && walletVerification.publicKey) {
        verified = true;
        publicKey = walletVerification.publicKey;
        verifiedAt = walletVerification.verifiedAt;
        const verificationAge = (now.getTime() - new Date(walletVerification.verifiedAt).getTime()) / (1000 * 86400);
        needsReVerification = verificationAge > VERIFICATION_SOFT_EXPIRY_DAYS;
      }
    }

    return res.json({
      verified,
      publicKey,
      verifiedAt,
      needsReVerification: needsReVerification || undefined,
      reVerificationAfterDays: needsReVerification ? VERIFICATION_SOFT_EXPIRY_DAYS : undefined,
    });
  } catch (error) {
    logger.error('Wallet status error:', error);
    return res.status(500).json({
      verified: false,
      publicKey: null,
      error: 'Internal server error while fetching wallet status',
    });
  }
});

/**
 * POST /api/wallet/revoke
 * Revoke a wallet verification for the authenticated user.
 */
router.post('/revoke', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { publicKey, reason } = req.body as {
      publicKey?: string;
      reason?: string;
    };

    if (!publicKey) {
      return res.status(400).json({
        success: false,
        error: 'publicKey is required',
      });
    }

    // Revoke in the dedicated table
    const { error: revokeError } = await supabase
      .from('wallet_verifications')
      .update({
        revoked_at: new Date().toISOString(),
        revoked_by: userId,
      })
      .eq('user_id', userId)
      .eq('public_key', publicKey)
      .is('revoked_at', null);

    if (revokeError) {
      logger.error('Error revoking wallet verification:', revokeError);
      return res.status(500).json({
        success: false,
        error: 'Failed to revoke wallet verification',
      });
    }

    // Log the revocation
    await supabase.from('wallet_verification_revocations').insert({
      user_id: userId,
      public_key: publicKey,
      reason: reason || 'User requested revocation',
      revoked_by: userId,
    });

    // Emit structured security event
    await emitSecurityEvent('auth.unauthorized_access', {
      severity: 'low',
      actorId: userId,
      resourceType: 'wallet',
      resourceId: publicKey,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
      reason: reason || 'Wallet verification revoked by user',
    });

    return res.json({
      success: true,
      message: 'Wallet verification revoked',
    });
  } catch (error) {
    logger.error('Wallet revocation error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error while revoking wallet verification',
    });
  }
});

export default router;
