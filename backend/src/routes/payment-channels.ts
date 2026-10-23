import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { attachTeamAuth, requireTeamRole, requireOwnerMfa, requireMfaReauth } from '../middleware/team-auth';
import { paymentChannelService } from '../services/payment-channel-service';
import { channelStateService, WatchtowerError } from '../services/channel-state';
import { channelHistoryService } from '../services/channel-history';
import { redisStoreInstance } from '../lib/redis-store';
import logger from '../config/logger';

const router = Router();

// All payment channel routes require team context (authenticate is applied at app level)
router.use(attachTeamAuth);

// Real-time stream endpoint (this PR)
router.get('/stream', async (req: AuthenticatedRequest, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendSnapshot = async (): Promise<void> => {
    try {
      const channels = await paymentChannelService.listChannels(req.user!.id);
      res.write(
        `data: ${JSON.stringify({
          type: 'snapshot',
          channels,
          degradedMode: redisStoreInstance.isDegraded(),
          serverTime: new Date().toISOString(),
        })}\n\n`,
      );
    } catch (error) {
      logger.error('Failed to stream payment channel snapshot', error);
      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          message: 'Failed to refresh channel stream snapshot',
          serverTime: new Date().toISOString(),
        })}\n\n`,
      );
    }
  };

  await sendSnapshot();
  const interval = setInterval(() => {
    void sendSnapshot();
  }, 3000);

  req.on('close', () => {
    clearInterval(interval);
    res.end();
  });
});

router.get('/preferences', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const prefs = await channelStateService.getChannelPreferences(req.user!.id);
    return res.json(prefs);
  } catch (error) {
    logger.error('Failed to get channel preferences', error);
    return res.status(500).json({ error: 'Failed to get channel preferences' });
  }
});

router.get('/usage', requireTeamRole('viewer', 'operator', 'owner'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const prefs = await channelStateService.getChannelPreferences(req.user!.id);
    return res.json({ usage: prefs, role: (req as any).teamAuth.teamRole });
  } catch (error) {
    logger.error('Failed to get usage', error);
    return res.status(500).json({ error: 'Failed to get usage' });
  }
});

router.patch('/preferences', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { autoTopUp, autoTopUpAmount } = req.body as {
      autoTopUp?: boolean;
      autoTopUpAmount?: number | null;
    };
    await channelStateService.setChannelPreferences(req.user!.id, {
      autoTopUp,
      autoTopUpAmount,
    });
    const prefs = await channelStateService.getChannelPreferences(req.user!.id);
    return res.json(prefs);
  } catch (error) {
    logger.error('Failed to update channel preferences', error);
    return res.status(500).json({ error: 'Failed to update channel preferences' });
  }
});

router.post('/fund', requireTeamRole('owner'), requireMfaReauth, requireOwnerMfa(), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { amount, counterparty } = req.body;
    if (!amount || !counterparty) {
      return res.status(400).json({ error: 'Amount and counterparty required' });
    }
    return res.json({ amount, counterparty });
  } catch (error) {
    logger.error('Failed to fund channel', error);
    return res.status(500).json({ error: 'Failed to fund channel' });
  }
});

router.post('/grant-authority', requireTeamRole('owner'), requireMfaReauth, requireOwnerMfa(), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId, spendingLimit, duration } = req.body;
    if (!agentId || !spendingLimit) {
      return res.status(400).json({ error: 'Agent ID and spending limit required' });
    }
    return res.json({ agentId, spendingLimit, duration });
  } catch (error) {
    logger.error('Failed to grant spending authority', error);
    return res.status(500).json({ error: 'Failed to grant spending authority' });
  }
});

router.patch('/cap', requireTeamRole('owner'), requireMfaReauth, requireOwnerMfa(), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { newCap, agentId } = req.body;
    if (newCap === undefined) {
      return res.status(400).json({ error: 'New cap required' });
    }
    return res.json({ newCap, agentId });
  } catch (error) {
    logger.error('Failed to raise cap', error);
    return res.status(500).json({ error: 'Failed to raise cap' });
  }
});

router.patch('/payout-address', requireTeamRole('owner'), requireMfaReauth, requireOwnerMfa(), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { payoutAddress } = req.body;
    if (!payoutAddress) {
      return res.status(400).json({ error: 'Payout address required' });
    }
    return res.json({ payoutAddress });
  } catch (error) {
    logger.error('Failed to change payout address', error);
    return res.status(500).json({ error: 'Failed to change payout address' });
  }
});

router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const channels = await paymentChannelService.listChannels(req.user!.id);
    return res.json(channels);
  } catch (error) {
    logger.error('Failed to list payment channels', error);
    return res.status(500).json({ error: 'Failed to list payment channels' });
  }
});

router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const channel = await paymentChannelService.getChannel(req.user!.id, req.params.id);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    return res.json(channel);
  } catch (error) {
    logger.error('Failed to get payment channel', error);
    return res.status(500).json({ error: 'Failed to get payment channel' });
  }
});

router.get('/:id/history', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const history = await channelHistoryService.getHistory(req.user!.id, req.params.id);
    if (!history) return res.status(404).json({ error: 'Channel not found' });
    return res.json(history);
  } catch (error) {
    logger.error('Failed to get payment channel history', error);
    return res.status(500).json({ error: 'Failed to get payment channel history' });
  }
});

router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { depositAmount, counterparty } = req.body as {
      depositAmount?: string | number;
      counterparty?: string;
    };
    const amount = Number(depositAmount);
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'depositAmount must be a positive number' });
    }
    const channel = await paymentChannelService.openChannel(
      req.user!.id,
      amount,
      counterparty,
    );
    return res.status(201).json(channel);
  } catch (error) {
    logger.error('Failed to open payment channel', error);
    return res.status(500).json({ error: 'Failed to open payment channel' });
  }
});

router.post('/:id/topup', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const amount = Number((req.body as { amount?: string | number }).amount);
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }
    const channel = await paymentChannelService.topUp(req.user!.id, req.params.id, amount);
    return res.json(channel);
  } catch (error) {
    logger.error('Failed to top up channel', error);
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Top-up failed' });
  }
});

router.post('/:id/close', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { unilateral } = req.body as { unilateral?: boolean };
    const channel = await paymentChannelService.initiateClose(
      req.user!.id,
      req.params.id,
      unilateral ?? false,
    );
    return res.json(channel);
  } catch (error) {
    logger.error('Failed to close channel', error);
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Close failed' });
  }
});

router.post('/agents', requireTeamRole('operator', 'owner'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentName, pubKey, cap } = req.body;
    if (!agentName || !pubKey) {
      return res.status(400).json({ error: 'Agent name and public key required' });
    }
    return res.json({ agentName, pubKey, cap });
  } catch (error) {
    logger.error('Failed to register agent', error);
    return res.status(500).json({ error: 'Failed to register agent' });
  }
});

router.get('/:id/watchtowers', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const watchtowers = await channelStateService.listWatchtowers(req.user!.id, req.params.id);
    return res.json({ watchtowers });
  } catch (error) {
    logger.error('Failed to list watchtowers', error);
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to list watchtowers' });
  }
});

router.post('/:id/watchtowers', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { watchtower, bounty } = req.body as { watchtower?: string; bounty?: number };
    if (!watchtower || typeof watchtower !== 'string') {
      return res.status(400).json({ error: 'watchtower is required' });
    }

    const watchtowers = await channelStateService.registerWatchtower(
      req.user!.id,
      req.params.id,
      watchtower,
      Number(bounty ?? 0),
    );
    return res.status(201).json({ watchtowers });
  } catch (error) {
    if (error instanceof WatchtowerError) {
      return res.status(400).json({ error: error.message, code: error.code });
    }
    logger.error('Failed to register watchtower', error);
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to register watchtower' });
  }
});

router.delete('/:id/watchtowers/:watchtower', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const watchtowers = await channelStateService.deregisterWatchtower(
      req.user!.id,
      req.params.id,
      req.params.watchtower,
    );
    return res.json({ watchtowers });
  } catch (error) {
    if (error instanceof WatchtowerError) {
      return res.status(400).json({ error: error.message, code: error.code });
    }
    logger.error('Failed to deregister watchtower', error);
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to deregister watchtower' });
  }
});

export default router;
