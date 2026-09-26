import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { meterReservationTracker } from '../../services/v3/gateway-lifecycle';
import {
  AgentConsoleError,
  AgentConsoleService,
  CALL_TYPES,
  agentConsoleService,
} from '../../v3/agent-console-service';

const callTypeId = z.enum(['llm:call', 'compute:run', 'data:read']);

const registerSchema = z.object({
  publicKey: z.string().min(1),
  label: z.string().max(40).nullable().optional(),
});

const authoritySchema = z.object({
  scopeIds: z.array(callTypeId).min(1),
  amount: z.number().positive().max(1_000_000),
  period: z.enum(['day', 'week', 'month']),
});

const applySchema = authoritySchema.extend({
  statement: z.string().min(1),
  signature: z.string().min(1),
  reauthToken: z.string().min(1).nullable().optional(),
});

const sessionSchema = z.object({
  challengeId: z.string().min(1),
  publicKey: z.string().min(1),
  signature: z.string().min(1),
});

const reauthSchema = z.object({
  challengeId: z.string().min(1),
  signature: z.string().min(1),
  statement: z.string().min(1),
});

interface PrincipalRequest extends Request {
  principalPublicKey?: string;
}

function inFlightCount(publicKey: string): number {
  return meterReservationTracker.listOpenForAgent(publicKey).length;
}

function agentIdFrom(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function sendError(res: Response, error: unknown): Response {
  if (error instanceof AgentConsoleError) {
    return res.status(error.status).json({ error: error.code, message: error.message });
  }
  return res.status(500).json({ error: 'failed', message: 'Something went wrong.' });
}

function sendValidation(res: Response, error: z.ZodError): Response {
  const issue = error.issues[0];
  return res.status(400).json({
    error: 'invalid_request',
    message: issue?.message || 'Check the spending details and try again.',
  });
}

export function createAgentConsoleRouter(service: AgentConsoleService = agentConsoleService): Router {
  const router = Router();

  function requireSession(req: PrincipalRequest, res: Response, next: NextFunction): void {
    const header = req.header('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    try {
      req.principalPublicKey = service.verifySession(token);
      next();
    } catch (error) {
      sendError(res, error);
    }
  }

  router.post('/session/challenge', (req, res) => {
    const publicKey = req.body?.publicKey;
    if (typeof publicKey !== 'string' || publicKey.length === 0) {
      return res.status(400).json({ error: 'invalid_public_key', message: 'Enter a Stellar public key. It starts with G.' });
    }
    try {
      return res.json({ data: service.createSessionChallenge(publicKey) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/session', (req, res) => {
    const parsed = sessionSchema.safeParse(req.body);
    if (!parsed.success) return sendValidation(res, parsed.error);
    try {
      return res.json({ data: service.openSession(parsed.data) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/', requireSession, (req: PrincipalRequest, res) => {
    const agents = service.listAgents(req.principalPublicKey!, inFlightCount);
    return res.json({ data: { callTypes: CALL_TYPES, agents } });
  });

  router.post('/', requireSession, (req: PrincipalRequest, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return sendValidation(res, parsed.error);
    try {
      const agent = service.registerAgent(req.principalPublicKey!, parsed.data);
      return res.status(201).json({ data: agent });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/reauth/challenge', requireSession, (req: PrincipalRequest, res) => {
    try {
      return res.json({ data: service.createReauthChallenge(req.principalPublicKey!) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/reauth', requireSession, (req: PrincipalRequest, res) => {
    const parsed = reauthSchema.safeParse(req.body);
    if (!parsed.success) return sendValidation(res, parsed.error);
    try {
      return res.json({ data: service.completeReauth(req.principalPublicKey!, parsed.data) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/:agentId/authority/preview', requireSession, (req: PrincipalRequest, res) => {
    const parsed = authoritySchema.safeParse(req.body);
    if (!parsed.success) return sendValidation(res, parsed.error);
    try {
      return res.json({
        data: service.previewAuthority(req.principalPublicKey!, agentIdFrom(req.params.agentId), parsed.data),
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/:agentId/authority', requireSession, (req: PrincipalRequest, res) => {
    const parsed = applySchema.safeParse(req.body);
    if (!parsed.success) return sendValidation(res, parsed.error);
    try {
      const agent = service.applyAuthority(req.principalPublicKey!, agentIdFrom(req.params.agentId), parsed.data, inFlightCount);
      return res.json({ data: agent });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/:agentId/revoke', requireSession, (req: PrincipalRequest, res) => {
    try {
      const agent = service.revokeAgent(req.principalPublicKey!, agentIdFrom(req.params.agentId), inFlightCount);
      return res.json({ data: agent });
    } catch (error) {
      return sendError(res, error);
    }
  });

  return router;
}

export default createAgentConsoleRouter();
