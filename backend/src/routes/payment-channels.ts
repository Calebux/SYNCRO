import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { paymentChannelService } from '../services/payment-channel-service';
import { channelStateService } from '../services/channel-state';
import logger from '../config/logger';

const router = Router();

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

export default router;
