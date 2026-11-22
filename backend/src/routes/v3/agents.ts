import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { meterReservationTracker } from '../../services/v3/gateway-lifecycle';
import { createSessionChallengeLimiter } from '../../middleware/rate-limit-factory';
import { AgentConsoleError, AgentConsoleService, CALL_TYPES, agentConsoleService } from '../../v3/agent-console-service';
import { AgentWalletSponsorshipService, agentWalletSponsorshipService } from '../../services/agent-wallet-sponsorship-service';

const callTypeId = z.enum(['llm:call', 'compute:run', 'data:read']);
const registerSchema = z.object({ publicKey:z.string().min(1).optional(), label:z.string().max(40).nullable().optional() });
const authoritySchema = z.object({ scopeIds:z.array(callTypeId).min(1), amount:z.number().positive().max(1_000_000), period:z.enum(['day','week','month']) });
const applySchema = authoritySchema.extend({ statement:z.string().min(1), signature:z.string().min(1), reauthToken:z.string().min(1).nullable().optional() });
const sessionSchema = z.object({ challengeId:z.string().min(1), publicKey:z.string().min(1), signature:z.string().min(1) });
const reauthSchema = z.object({ challengeId:z.string().min(1), signature:z.string().min(1), statement:z.string().min(1) });
interface PrincipalRequest extends Request { principalPublicKey?: string }
function inFlightCount(publicKey:string) { return meterReservationTracker.listOpenForAgent(publicKey).length; }
function agentIdFrom(value:string|string[]|undefined) { return Array.isArray(value) ? value[0] ?? '' : value ?? ''; }
function sendError(res:Response,error:unknown) {
  if (error instanceof AgentConsoleError) return res.status(error.status).json({ error:error.code, message:error.message });
  return res.status(500).json({ error:'failed', message:'Something went wrong.' });
}
function sendValidation(res:Response,error:z.ZodError) {
  return res.status(400).json({ error:'invalid_request', message:error.issues[0]?.message || 'Check the request and try again.' });
}
export function createAgentConsoleRouter(
  service:AgentConsoleService=agentConsoleService,
  walletService:AgentWalletSponsorshipService=agentWalletSponsorshipService,
):Router {
  const router=Router();
  function requireSession(req:PrincipalRequest,res:Response,next:NextFunction):void {
    const header=req.header('authorization') || '', token=header.startsWith('Bearer ') ? header.slice(7) : '';
    try { req.principalPublicKey=service.verifySession(token); next(); } catch(error) { sendError(res,error); }
  }
  router.post('/session/challenge',createSessionChallengeLimiter(),(req,res)=>{
    const key=req.body?.publicKey;
    if(typeof key!=='string'||!key) return res.status(400).json({error:'invalid_public_key',message:'Enter a Stellar public key. It starts with G.'});
    try { return res.json({data:service.createSessionChallenge(key)}); } catch(error) { return sendError(res,error); }
  });
  router.post('/session',createSessionChallengeLimiter(),(req,res)=>{
    const parsed=sessionSchema.safeParse(req.body); if(!parsed.success) return sendValidation(res,parsed.error);
    try { return res.json({data:service.openSession(parsed.data)}); } catch(error) { return sendError(res,error); }
  });
  router.get('/',requireSession,(req:PrincipalRequest,res)=>{
    return res.json({data:{callTypes:CALL_TYPES,agents:service.listAgents(req.principalPublicKey!,inFlightCount)}});
  });
  router.post('/',requireSession,async(req:PrincipalRequest,res)=>{
    const parsed=registerSchema.safeParse(req.body); if(!parsed.success) return sendValidation(res,parsed.error);
    let createdKey:string|null=null;
    try {
      let publicKey=parsed.data.publicKey;
      let wallet:null|{publicKey:string;sponsorshipStatus:'active';transactionHash:string}=null;
      if(walletService.enabled) {
        wallet=await walletService.createAgentWallet(req.principalPublicKey!);
        publicKey=wallet.publicKey; createdKey=publicKey;
      } else if(!publicKey) {
        return res.status(400).json({error:'invalid_request',message:'publicKey is required while managed sponsored accounts are disabled.'});
      }
      const agent=service.registerAgent(req.principalPublicKey!,{publicKey:publicKey!,label:parsed.data.label});
      return res.status(201).json({data:{...agent,...(wallet?{wallet:{custody:'managed',reserveSponsorship:wallet.sponsorshipStatus,transactionHash:wallet.transactionHash}}:{})}});
    } catch(error) {
      if(createdKey) { try { await walletService.reclaimSponsoredAccount(createdKey); } catch { /* retryable record remains */ } }
      return sendError(res,error);
    }
  });
  router.post('/reauth/challenge',requireSession,(req:PrincipalRequest,res)=>{
    try { return res.json({data:service.createReauthChallenge(req.principalPublicKey!)}); } catch(error) { return sendError(res,error); }
  });
  router.post('/reauth',requireSession,(req:PrincipalRequest,res)=>{
    const parsed=reauthSchema.safeParse(req.body); if(!parsed.success) return sendValidation(res,parsed.error);
    try { return res.json({data:service.completeReauth(req.principalPublicKey!,parsed.data)}); } catch(error) { return sendError(res,error); }
  });
  router.post('/:agentId/authority/preview',requireSession,(req:PrincipalRequest,res)=>{
    const parsed=authoritySchema.safeParse(req.body); if(!parsed.success) return sendValidation(res,parsed.error);
    try { return res.json({data:service.previewAuthority(req.principalPublicKey!,agentIdFrom(req.params.agentId),parsed.data)}); } catch(error) { return sendError(res,error); }
  });
  router.post('/:agentId/authority',requireSession,(req:PrincipalRequest,res)=>{
    const parsed=applySchema.safeParse(req.body); if(!parsed.success) return sendValidation(res,parsed.error);
    try { return res.json({data:service.applyAuthority(req.principalPublicKey!,agentIdFrom(req.params.agentId),parsed.data,inFlightCount)}); } catch(error) { return sendError(res,error); }
  });
  router.post('/:agentId/revoke',requireSession,async(req:PrincipalRequest,res)=>{
    try {
      const agent=service.revokeAgent(req.principalPublicKey!,agentIdFrom(req.params.agentId),inFlightCount);
      if(!walletService.enabled) return res.json({data:agent});
      try {
        const reclaimed=await walletService.reclaimSponsoredAccount(agent.publicKey);
        return res.json({data:{...agent,reserveReclamation:reclaimed?'reclaimed':'not_sponsored'}});
      } catch {
        return res.status(202).json({data:{...agent,reserveReclamation:'pending'}});
      }
    } catch(error) { return sendError(res,error); }
  });
  router.get('/principal-budget',requireSession,(req:PrincipalRequest,res)=>{
    try { return res.json({data:service.principalBudget(req.principalPublicKey!)}); } catch(error) { return sendError(res,error); }
  });
  router.post('/principal-budget',requireSession,(req:PrincipalRequest,res)=>{
    const parsed=z.object({amount:z.number().positive().max(1_000_000)}).safeParse(req.body);
    if(!parsed.success) return sendValidation(res,parsed.error);
    try { return res.json({data:service.setPrincipalDailyLimit(req.principalPublicKey!,parsed.data.amount)}); } catch(error) { return sendError(res,error); }
  });
  return router;
}
export default createAgentConsoleRouter();
