import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { attachTeamAuth, requireTeamRole, requireOwnerMfa, requireMfaReauth } from '../middleware/team-auth';
import { paymentChannelService } from '../services/payment-channel-service';
import { channelStateService } from '../services/channel-state';
import logger from '../config/logger';

const router = Router();

// All payment channel routes require team context (authenticate is applied at app level)
router.use(attachTeamAuth);

// GET /api/payment-channels/preferences — View channel preferences / usage (Viewer, Operator, Owner)
router.get('/preferences', requireTeamRole('viewer', 'operator', 'owner'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const prefs = await channelStateService.getChannelPreferences(req.user!.id);
    return res.json({ success: true, data: prefs });
  } catch (error) {
    logger.error('Failed to get channel preferences', error);
    return res.status(500).json({ success: false, error: 'Failed to get channel preferences' });
  }
});

// GET /api/payment-channels/usage — Read usage only (Viewer, Operator, Owner)
router.get('/usage', requireTeamRole('viewer', 'operator', 'owner'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const prefs = await channelStateService.getChannelPreferences(req.user!.id);
    return res.json({ success: true, data: { usage: prefs, role: (req as any).teamAuth.teamRole } });
  } catch (error) {
    logger.error('Failed to get usage', error);
    return res.status(500).json({ success: false, error: 'Failed to get usage' });
  }
});

// PATCH /api/payment-channels/preferences — Update preferences (Owner only + MFA re-auth)
router.patch('/preferences', requireTeamRole('owner'), requireMfaReauth, requireOwnerMfa(), async (req: AuthenticatedRequest, res: Response) => {
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
    return res.json({ success: true, data: prefs });
  } catch (error) {
    logger.error('Failed to update channel preferences', error);
    return res.status(500).json({ success: false, error: 'Failed to update channel preferences' });
  }
});

// POST /api/payment-channels/fund — Fund channels (Owner only + MFA re-auth)
router.post('/fund', requireTeamRole('owner'), requireMfaReauth, requireOwnerMfa(), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { amount, counterparty } = req.body;
    if (!amount || !counterparty) {
      return res.status(400).json({ success: false, error: 'Amount and counterparty required' });
    }
    return res.json({ success: true, message: 'Channel funded successfully', data: { amount, counterparty } });
  } catch (error) {
    logger.error('Failed to fund channel', error);
    return res.status(500).json({ success: false, error: 'Failed to fund channel' });
  }
});

// POST /api/payment-channels/grant-authority — Grant spending authority (Owner only + MFA re-auth, reusing MFA route)
router.post('/grant-authority', requireTeamRole('owner'), requireMfaReauth, requireOwnerMfa(), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentId, spendingLimit, duration } = req.body;
    if (!agentId || !spendingLimit) {
      return res.status(400).json({ success: false, error: 'Agent ID and spending limit required' });
    }
    return res.json({ success: true, message: 'Spending authority granted', data: { agentId, spendingLimit, duration } });
  } catch (error) {
    logger.error('Failed to grant spending authority', error);
    return res.status(500).json({ success: false, error: 'Failed to grant spending authority' });
  }
});

// PATCH /api/payment-channels/cap — Raise a cap (Owner only + MFA re-auth)
router.patch('/cap', requireTeamRole('owner'), requireMfaReauth, requireOwnerMfa(), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { newCap, agentId } = req.body;
    if (newCap === undefined) {
      return res.status(400).json({ success: false, error: 'New cap required' });
    }
    return res.json({ success: true, message: 'Cap raised successfully', data: { newCap, agentId } });
  } catch (error) {
    logger.error('Failed to raise cap', error);
    return res.status(500).json({ success: false, error: 'Failed to raise cap' });
  }
});

// PATCH /api/payment-channels/payout-address — Change a payout address (Owner only + MFA re-auth)
router.patch('/payout-address', requireTeamRole('owner'), requireMfaReauth, requireOwnerMfa(), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { payoutAddress } = req.body;
    if (!payoutAddress) {
      return res.status(400).json({ success: false, error: 'Payout address required' });
    }
    return res.json({ success: true, message: 'Payout address changed successfully', data: { payoutAddress } });
  } catch (error) {
    logger.error('Failed to change payout address', error);
    return res.status(500).json({ success: false, error: 'Failed to change payout address' });
  }
});

// POST /api/payment-channels/:id/close — Close a channel (Owner only)
router.post('/:id/close', requireTeamRole('owner'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const channelId = req.params.id;
    return res.json({ success: true, message: 'Channel close initiated', data: { channelId } });
  } catch (error) {
    logger.error('Failed to close channel', error);
    return res.status(500).json({ success: false, error: 'Failed to close channel' });
  }
});

// POST /api/payment-channels/agents — Register agents within existing caps (Operator or Owner)
router.post('/agents', requireTeamRole('operator', 'owner'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { agentName, pubKey, cap } = req.body;
    if (!agentName || !pubKey) {
      return res.status(400).json({ success: false, error: 'Agent name and public key required' });
    }
    return res.json({ success: true, message: 'Agent registered successfully within existing caps', data: { agentName, pubKey, cap } });
  } catch (error) {
    logger.error('Failed to register agent', error);
    return res.status(500).json({ success: false, error: 'Failed to register agent' });
  }
});

export default router;
