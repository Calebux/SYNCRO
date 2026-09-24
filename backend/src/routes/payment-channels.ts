import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { paymentChannelService } from '../services/payment-channel-service';
import { channelStateService, WatchtowerError } from '../services/channel-state';
import { redisStoreInstance } from '../lib/redis-store';
import logger from '../config/logger';

const router = Router();

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
