import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import logger from '../config/logger';
import { stealthScanner } from '../services/stealth-scanner';
import { emitSecurityEvent } from '../services/audit-service';

const router = Router();

router.use(authenticate);

/**
 * POST /api/privacy/stealth/recover
 * Initiates stealth payment recovery from Stellar ledger using viewing key
 * 
 * This endpoint reconstructs a user's stealth payment history by:
 * 1. Loading the user's viewing key and stealth meta address
 * 2. Deriving all possible stealth addresses from subscriptions
 * 3. Scanning Stellar ledger for payments to those addresses
 * 4. Returning recovered payment history
 * 
 * Response is streamed as server-sent events (SSE) for progress updates
 */
router.post('/stealth/recover', (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;

  try {
    // Log recovery attempt
    emitSecurityEvent(userId, 'stealth_recovery_initiated', {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    }).catch(err => logger.error('Failed to log security event', { error: err }));

    // Set up SSE (Server-Sent Events) for progress streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Send initial connection confirmation
    res.write('data: {"type":"connected","message":"Recovery stream connected"}\n\n');

    // Execute scan asynchronously without blocking response
    (async () => {
      try {
        const payments = await stealthScanner.scanHistoricalLedger(userId, '', (progress) => {
          // Stream progress updates to client
          res.write(
            `data: ${JSON.stringify({
              type: 'progress',
              ...progress,
            })}\n\n`
          );
        });

        // Send final results
        res.write(
          `data: ${JSON.stringify({
            type: 'complete',
            payments,
            count: payments.length,
          })}\n\n`
        );

        res.end();
      } catch (error) {
        logger.error('Stealth recovery error', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });

        res.write(
          `data: ${JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : 'Recovery failed',
          })}\n\n`
        );

        res.end();
      }
    })();
  } catch (error) {
    logger.error('Stealth recovery endpoint error', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'Recovery initialization failed',
    });
  }
});

/**
 * GET /api/privacy/stealth/status
 * Check if user has stealth payments configured
 */
router.get('/stealth/status', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const { data: profile } = await (req.app.locals.supabase || require('../config/database').supabase)
      .from('profiles')
      .select('stealth_meta_address, stellar_public_key')
      .eq('id', userId)
      .single();

    res.json({
      configured: !!profile?.stealth_meta_address,
      hasPublicKey: !!profile?.stellar_public_key,
    });
  } catch (error) {
    logger.error('Stealth status check error', {
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
      error: 'Status check failed',
    });
  }
});

export default router;
