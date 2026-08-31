/**
 * agent-wallets.ts
 *
 * Admin-only REST endpoints for managing and monitoring pipeline agent wallet rotation.
 *
 * Issue #862 — Privacy: Implement address rotation for agent wallets.
 *
 * All endpoints require the ADMIN_API_KEY header (same as other admin routes).
 *
 * Routes:
 *   GET  /api/admin/agent-wallets              — list current state for all agents
 *   GET  /api/admin/agent-wallets/:agent        — state + history for one agent
 *   POST /api/admin/agent-wallets/rotate        — trigger rotation for all agents
 *   POST /api/admin/agent-wallets/:agent/rotate — trigger rotation for one agent
 */

import { Router, Request, Response } from 'express';
import { adminAuth } from '../middleware/admin';
import {
  agentWalletRotationService,
  AgentWalletRotationService,
} from '../services/agent-wallet-rotation';
import { AgentName, AGENT_NAMES } from '../services/agent-hd-wallet';
import logger from '../config/logger';

const router = Router();

// All routes require admin authentication
router.use(adminAuth);

/**
 * @swagger
 * /api/admin/agent-wallets:
 *   get:
 *     summary: List rotation state for all pipeline agents
 *     tags: [AgentWallets]
 *     security:
 *       - adminKey: []
 *     responses:
 *       200:
 *         description: Current rotation states
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const states = await agentWalletRotationService.getAllStates();
    return res.json({ agents: states });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[AgentWallets] Failed to fetch states', { error: msg });
    return res.status(500).json({ error: msg });
  }
});

/**
 * @swagger
 * /api/admin/agent-wallets/{agent}:
 *   get:
 *     summary: Get rotation state and address history for a single agent
 *     tags: [AgentWallets]
 *     security:
 *       - adminKey: []
 *     parameters:
 *       - in: path
 *         name: agent
 *         required: true
 *         schema:
 *           type: string
 *           enum: [scout, ledger, signal, scribe, executor]
 */
router.get('/:agent', async (req: Request, res: Response) => {
  const agentName = req.params.agent?.toLowerCase() as AgentName;

  if (!AGENT_NAMES.includes(agentName)) {
    return res.status(400).json({
      error: `Unknown agent "${agentName}". Valid agents: ${AGENT_NAMES.join(', ')}`,
    });
  }

  try {
    const [states, history] = await Promise.all([
      agentWalletRotationService.getAllStates(),
      agentWalletRotationService.getHistory(agentName, 100),
    ]);

    const state = states.find((s) => s.agentName === agentName);
    return res.json({ state, history });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[AgentWallets] Failed to fetch agent state', { agentName, error: msg });
    return res.status(500).json({ error: msg });
  }
});

/**
 * @swagger
 * /api/admin/agent-wallets/rotate:
 *   post:
 *     summary: Force-rotate all pipeline agent wallets immediately
 *     tags: [AgentWallets]
 *     security:
 *       - adminKey: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               force:
 *                 type: boolean
 *                 description: Force rotation even if schedule says it's not due
 *                 default: true
 */
router.post('/rotate', async (req: Request, res: Response) => {
  const force: boolean = req.body?.force !== false; // default true
  try {
    const results = await agentWalletRotationService.rotateAll(force);
    return res.json({
      rotated: results.length,
      results,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[AgentWallets] Bulk rotation failed', { error: msg });
    return res.status(500).json({ error: msg });
  }
});

/**
 * @swagger
 * /api/admin/agent-wallets/{agent}/rotate:
 *   post:
 *     summary: Force-rotate a single pipeline agent wallet
 *     tags: [AgentWallets]
 *     security:
 *       - adminKey: []
 *     parameters:
 *       - in: path
 *         name: agent
 *         required: true
 *         schema:
 *           type: string
 *           enum: [scout, ledger, signal, scribe, executor]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               force:
 *                 type: boolean
 *                 default: true
 */
router.post('/:agent/rotate', async (req: Request, res: Response) => {
  const agentName = req.params.agent?.toLowerCase() as AgentName;

  if (!AGENT_NAMES.includes(agentName)) {
    return res.status(400).json({
      error: `Unknown agent "${agentName}". Valid agents: ${AGENT_NAMES.join(', ')}`,
    });
  }

  const force: boolean = req.body?.force !== false;

  try {
    const result = await agentWalletRotationService.triggerRotation(agentName, force);
    if (!result) {
      return res.json({
        rotated: false,
        message: 'Rotation not due based on current schedule. Pass force=true to override.',
      });
    }
    return res.json({ rotated: true, result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[AgentWallets] Single agent rotation failed', { agentName, error: msg });
    return res.status(500).json({ error: msg });
  }
});

export default router;
